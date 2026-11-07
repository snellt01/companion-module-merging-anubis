// Keeps a copy of the Anubis's state: join the CometD feed, read the whole
// state with one GET, then apply every change the feed pushes. Starts again
// from the top whenever the connection fails.

import { BayeuxListener, type BayeuxMessage } from './bayeux.js'
import { AnubisModel } from './model.js'
import { applyChange, type Json, type JsonObject } from './tree.js'

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
}

type Change = { path: string; value: Json }

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
				this.events.status('ok')
				this.events.loaded(new AnubisModel(tree))
				await listening
			} catch (e) {
				if (this.running) {
					this.events.status('failed', e instanceof Error ? e.message : String(e))
					this.events.log('debug', `connection failed: ${String(e)}`)
				}
			} finally {
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
			})
		}
	}
}
