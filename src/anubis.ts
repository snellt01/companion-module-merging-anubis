// Keeps a copy of the Anubis's state: join the CometD feed, read the whole
// state with one GET, then apply every change the feed pushes. Starts again
// from the top whenever the connection fails. Writes (from writes.ts) go
// out at most once per control every 50 ms, and are checked against what
// comes back.

import { BayeuxListener, type BayeuxMessage } from './bayeux.js'
import { AnubisModel } from './model.js'
import { applyChange, type Json, type JsonObject } from './tree.js'
import type { Write } from './writes.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AnubisEvents {
	log(level: LogLevel, message: string): void
	status(status: 'connecting' | 'ok' | 'failed', message?: string): void
	/** The whole state was (re)read */
	loaded(model: AnubisModel): void
	/** One or more changes were applied */
	changed(model: AnubisModel): void
}

export interface AnubisOptions {
	/** Base URL, e.g. http://192.0.2.10 */
	url: string
	retryMs?: number
	/** How long to wait for a write to come back (default 2 s) */
	confirmMs?: number
}

type Change = { path: string; value: Json }

// Like the web UI: one publish per control every 50 ms, latest value wins.
const MIN_INTERVAL_MS = 50

function isChange(data: unknown): data is Change {
	return typeof data === 'object' && data !== null && typeof (data as Change).path === 'string'
}

export class AnubisConnection {
	private tree: JsonObject | null = null
	private running = false
	private listener: BayeuxListener | null = null
	// Changes that arrive while the state is being read; applied after it.
	private early: Change[] | null = null
	private flushPending = false
	private wake: (() => void) | null = null
	// Joined, state read and current: writes may go
	private ready = false
	private lastSent = new Map<string, number>()
	private queued = new Map<string, Write>()
	private watchers = new Set<() => void>()

	constructor(
		private readonly options: AnubisOptions,
		private readonly events: AnubisEvents,
	) {}

	get model(): AnubisModel | null {
		return this.tree ? new AnubisModel(this.tree) : null
	}

	start(): void {
		if (this.running) return
		this.running = true
		void this.run()
	}

	async stop(): Promise<void> {
		this.running = false
		this.wake?.()
		await this.listener?.stop()
	}

	/** Read the whole state again (a GET; nothing is sent to the mixer). */
	async refresh(): Promise<void> {
		if (!this.tree) return
		this.tree = await this.readState()
		this.events.loaded(new AnubisModel(this.tree))
	}

	/**
	 * Send one write and wait until the Anubis's state shows it. Resolves
	 * true when it does, false when it didn't within 2 s, and null when a
	 * newer write to the same control replaced it before it was sent.
	 * Throws when not connected or the Anubis doesn't acknowledge it.
	 */
	async write(write: Write): Promise<boolean | null> {
		const wait = (this.lastSent.get(write.control) ?? 0) + MIN_INTERVAL_MS - Date.now()
		if (wait > 0) {
			this.queued.set(write.control, write)
			await new Promise((resolve) => setTimeout(resolve, wait))
			if (this.queued.get(write.control) !== write) return null
			this.queued.delete(write.control)
		}
		if (!this.ready || !this.listener) throw new Error('Not connected to the Anubis')
		this.lastSent.set(write.control, Date.now())
		this.events.log('debug', `${write.description}: ${write.path} ${JSON.stringify(write.value)}`)
		await this.listener.publish({ path: write.path, value: write.value })
		return new Promise<boolean>((resolve) => {
			const check = (): void => {
				if (this.tree && write.confirmed(new AnubisModel(this.tree))) done(true)
			}
			const done = (confirmed: boolean): void => {
				clearTimeout(timer)
				this.watchers.delete(check)
				resolve(confirmed)
			}
			const timer = setTimeout(() => done(false), this.options.confirmMs ?? 2000)
			this.watchers.add(check)
			check()
		})
	}

	private async readState(): Promise<JsonObject> {
		const response = await fetch(`${this.options.url}/API/get_device_status:$`, {
			signal: AbortSignal.timeout(10000),
		})
		if (!response.ok) throw new Error(`reading state: HTTP ${response.status}`)
		const body = (await response.json()) as { data?: { value?: Json } }
		const value = body.data?.value
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new Error('reading state: unexpected reply')
		}
		return value
	}

	private async run(): Promise<void> {
		while (this.running) {
			const listener = new BayeuxListener(`${this.options.url}/cometd`, (m) => this.onMessage(m))
			this.listener = listener
			this.events.status('connecting')
			try {
				this.early = []
				await listener.join(['/ravenna/settings', '/ravenna/errors'])
				const listening = listener.listen()
				listening.catch(() => undefined) // awaited below
				const tree = await this.readState()
				for (const change of this.early) this.apply(tree, change)
				this.early = null
				this.tree = tree
				this.ready = true
				this.events.status('ok')
				this.events.loaded(new AnubisModel(tree))
				await listening
			} catch (e) {
				if (this.running) {
					this.events.status('failed', e instanceof Error ? e.message : String(e))
					this.events.log('debug', `connection failed: ${String(e)}`)
				}
			} finally {
				this.ready = false
				this.early = null
				await listener.stop()
			}
			if (this.running) {
				await new Promise<void>((resolve) => {
					this.wake = resolve
					setTimeout(resolve, this.options.retryMs ?? 5000)
				})
				this.wake = null
			}
		}
	}

	private apply(tree: JsonObject, change: Change): void {
		if (change.path === '$') {
			if (typeof change.value === 'object' && change.value !== null && !Array.isArray(change.value)) {
				for (const key of Object.keys(tree)) delete tree[key]
				Object.assign(tree, change.value)
			}
		} else if (!applyChange(tree, change.path, change.value)) {
			this.events.log('debug', `ignored change to ${change.path}`)
		}
	}

	private onMessage(message: BayeuxMessage): void {
		if (message.channel === '/ravenna/errors') {
			this.events.log('warn', `Anubis reported an error: ${JSON.stringify(message.data)}`)
			return
		}
		if (message.channel !== '/ravenna/settings' || !isChange(message.data)) return
		if (this.early) {
			this.early.push(message.data)
			return
		}
		if (!this.tree) return
		this.apply(this.tree, message.data)
		// One update for each batch the long-poll delivers.
		if (!this.flushPending) {
			this.flushPending = true
			setImmediate(() => {
				this.flushPending = false
				if (this.tree) this.events.changed(new AnubisModel(this.tree))
				for (const check of [...this.watchers]) check()
			})
		}
	}
}
