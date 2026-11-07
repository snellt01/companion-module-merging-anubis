// A pretend Anubis for the tests: serves a state tree over
// GET /API/get_device_status:$ and a CometD long-polling feed at /cometd.
// It records every Bayeux message it receives, and in `forbidden` any that
// isn't a /meta/* protocol message (the read-only module must send none).

import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BayeuxMessage } from '../bayeux.js'
import type { Json, JsonObject } from '../tree.js'

const FIXTURE = new URL('./fixtures/anubis-state.json', import.meta.url)

export function fixtureState(): JsonObject {
	return JSON.parse(readFileSync(FIXTURE, 'utf8')) as JsonObject
}

export class FakeAnubis {
	state: JsonObject = fixtureState()
	readonly received: BayeuxMessage[] = []
	readonly forbidden: BayeuxMessage[] = []
	stateReads = 0
	/** Long-poll timeout the fake advises, in ms */
	pollTimeout = 200
	/** When set, state reads wait for this promise */
	holdStateReads: Promise<void> | null = null

	private server: Server
	private queue: BayeuxMessage[] = []
	private waiting: (() => void) | null = null
	private nextClient = 1
	private dropClients = false

	constructor() {
		this.server = createServer((req, res) => {
			void this.handle(req, res)
		})
	}

	async start(): Promise<string> {
		await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
		return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
	}

	async close(): Promise<void> {
		this.waiting?.()
		this.server.closeAllConnections()
		await new Promise<void>((resolve) => this.server.close(() => resolve()))
	}

	/** Push a change on /ravenna/settings, as the Anubis does when something changes */
	push(path: string, value: Json): void {
		this.queue.push({ channel: '/ravenna/settings', data: { path, value } })
		this.waiting?.()
	}

	/** Make the next /meta/connect fail and ask for a new handshake */
	dropClient(): void {
		this.dropClients = true
		this.waiting?.()
	}

	channelsReceived(): string[] {
		return this.received.map((m) => m.channel)
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = decodeURIComponent(req.url ?? '')
		if (req.method === 'GET' && url === '/API/get_device_status:$') {
			this.stateReads++
			if (this.holdStateReads) await this.holdStateReads
			return this.json(res, { code: 200, error: 'Success', data: { path: '$', value: this.state } })
		}
		if (req.method !== 'POST' || !url.startsWith('/cometd')) {
			res.writeHead(404).end()
			return
		}
		let body = ''
		for await (const chunk of req) body += String(chunk)
		const messages = JSON.parse(body) as BayeuxMessage[]
		const replies: BayeuxMessage[] = []
		for (const m of messages) {
			this.received.push(m)
			if (!m.channel.startsWith('/meta/')) {
				this.forbidden.push(m)
				replies.push({ channel: m.channel, id: m.id, successful: false, error: 'not allowed in tests' })
			} else {
				replies.push(...(await this.meta(m)))
			}
		}
		this.json(res, replies)
	}

	private async meta(m: BayeuxMessage): Promise<BayeuxMessage[]> {
		const reply = { channel: m.channel, id: m.id, clientId: m.clientId, successful: true }
		switch (m.channel) {
			case '/meta/handshake':
				this.dropClients = false
				return [
					{
						...reply,
						clientId: `fake-${this.nextClient++}`,
						version: '1.0',
						supportedConnectionTypes: ['long-polling'],
						advice: { reconnect: 'retry', interval: 0, timeout: this.pollTimeout },
					},
				]
			case '/meta/subscribe':
				return [{ ...reply, subscription: m.subscription }]
			case '/meta/connect': {
				if (this.queue.length === 0 && !this.dropClients) {
					await new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, this.pollTimeout)
						this.waiting = () => {
							clearTimeout(timer)
							resolve()
						}
					})
					this.waiting = null
				}
				if (this.dropClients) {
					return [{ ...reply, successful: false, error: '402::Unknown client', advice: { reconnect: 'handshake' } }]
				}
				const events = this.queue
				this.queue = []
				return [reply, ...events]
			}
			default:
				return [reply]
		}
	}

	private json(res: ServerResponse, body: unknown): void {
		res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
	}
}
