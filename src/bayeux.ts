// A small Bayeux (CometD) client over long-polling, for the Anubis's web UI
// API at http://<anubis>/cometd.
//
// It sends the protocol's own messages (handshake, subscribe, connect,
// disconnect) and one kind of publish: a write from the module's fixed list
// (writes.ts) on /service/ravenna/settings, checked again here before it
// goes. Nothing else.

import { isAllowedWrite } from './writes.js'
import type { JsonObject } from './tree.js'

export interface BayeuxMessage {
	channel: string
	id?: string
	clientId?: string
	successful?: boolean
	error?: string
	subscription?: string
	data?: unknown
	advice?: { reconnect?: 'retry' | 'handshake' | 'none'; interval?: number; timeout?: number }
	version?: string
	minimumVersion?: string
	supportedConnectionTypes?: string[]
	connectionType?: string
}

const META_CHANNELS = new Set(['/meta/handshake', '/meta/subscribe', '/meta/connect', '/meta/disconnect'])
const SETTINGS_CHANNEL = '/service/ravenna/settings'
// Allowance on top of the server's long-poll timeout, as the web UI uses.
const MAX_NETWORK_DELAY = 5000

export class BayeuxError extends Error {
	constructor(
		message: string,
		readonly reconnect?: string,
	) {
		super(message)
	}
}

export class BayeuxListener {
	private clientId: string | null = null
	private nextId = 0
	private timeout = 30000
	private interval = 0
	private cookie = ''
	private readonly abort = new AbortController()
	// The last publish queued; the next waits for it
	private publishing: Promise<void> = Promise.resolve()

	constructor(
		private readonly baseUrl: string,
		private readonly onMessage: (message: BayeuxMessage) => void,
	) {}

	get stopped(): boolean {
		return this.abort.signal.aborted
	}

	private async post(url: string, body: BayeuxMessage, timeoutMs: number): Promise<BayeuxMessage[]> {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json;charset=UTF-8',
				...(this.cookie ? { Cookie: this.cookie } : {}),
			},
			body: JSON.stringify([body]),
			signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs)]),
		})
		const setCookies = response.headers.getSetCookie()
		if (setCookies.length > 0) this.cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
		if (!response.ok) throw new BayeuxError(`${body.channel}: HTTP ${response.status}`)
		const replies = (await response.json()) as BayeuxMessage[]
		if (!Array.isArray(replies)) throw new BayeuxError(`${body.channel}: unexpected reply`)
		return replies
	}

	private async send(message: Omit<BayeuxMessage, 'id' | 'clientId'>, timeoutMs: number): Promise<BayeuxMessage[]> {
		if (!META_CHANNELS.has(message.channel)) throw new Error(`refusing to send to ${message.channel}`)
		const body: BayeuxMessage = { ...message, id: String(++this.nextId) }
		if (this.clientId && message.channel !== '/meta/handshake') body.clientId = this.clientId
		return this.post(`${this.baseUrl}/${message.channel.slice('/meta/'.length)}`, body, timeoutMs)
	}

	private reply(replies: BayeuxMessage[], channel: string): BayeuxMessage {
		const reply = replies.find((r) => r.channel === channel)
		if (!reply) throw new BayeuxError(`${channel}: no reply`)
		if (reply.advice?.timeout !== undefined) this.timeout = reply.advice.timeout
		if (reply.advice?.interval !== undefined) this.interval = reply.advice.interval
		if (!reply.successful) throw new BayeuxError(`${channel}: ${reply.error ?? 'refused'}`, reply.advice?.reconnect)
		return reply
	}

	private deliver(replies: BayeuxMessage[]): void {
		for (const message of replies) {
			if (!message.channel.startsWith('/meta/')) this.onMessage(message)
		}
	}

	/** Handshake and subscribe. */
	async join(channels: string[]): Promise<void> {
		const handshake = await this.send(
			{
				channel: '/meta/handshake',
				version: '1.0',
				minimumVersion: '1.0',
				supportedConnectionTypes: ['long-polling'],
			},
			MAX_NETWORK_DELAY,
		)
		this.clientId = this.reply(handshake, '/meta/handshake').clientId ?? null
		if (!this.clientId) throw new BayeuxError('handshake: no clientId')
		for (const subscription of channels) {
			const replies = await this.send({ channel: '/meta/subscribe', subscription }, MAX_NETWORK_DELAY)
			this.reply(replies, '/meta/subscribe')
			this.deliver(replies)
		}
	}

	/**
	 * Long-poll until stopped. Throws when the connection fails or the
	 * server asks for a new handshake; the caller starts again from join().
	 */
	async listen(): Promise<void> {
		while (!this.stopped) {
			const replies = await this.send(
				{ channel: '/meta/connect', connectionType: 'long-polling' },
				this.timeout + MAX_NETWORK_DELAY,
			)
			this.reply(replies, '/meta/connect')
			this.deliver(replies)
			if (this.interval > 0) await new Promise((resolve) => setTimeout(resolve, this.interval))
		}
	}

	/**
	 * Publish one write from the fixed list and wait for the server to
	 * acknowledge it. Over long-polling a publish is POSTed to /cometd itself;
	 * anything else in the reply is delivered as usual. Publishes go one at
	 * a time, in order, beside the long poll, as the web UI's client sends
	 * them: the Anubis closes connections when several arrive at once.
	 */
	async publish(data: { path: string; value: JsonObject }): Promise<void> {
		if (!isAllowedWrite(data)) throw new Error(`refusing to publish ${JSON.stringify(data)}`)
		const sent = this.publishing.then(async () => this.publishNow(data))
		this.publishing = sent.catch(() => undefined)
		return sent
	}

	private async publishNow(data: { path: string; value: JsonObject }): Promise<void> {
		if (!this.clientId || this.stopped) throw new BayeuxError('not connected')
		const body: BayeuxMessage = {
			channel: SETTINGS_CHANNEL,
			id: String(++this.nextId),
			clientId: this.clientId,
			data: { path: data.path, value: data.value },
		}
		const replies = await this.post(this.baseUrl, body, MAX_NETWORK_DELAY)
		const ack = replies.find((r) => r.id === body.id && r.channel === SETTINGS_CHANNEL)
		this.deliver(replies.filter((r) => r !== ack))
		if (!ack) throw new BayeuxError(`${SETTINGS_CHANNEL}: no acknowledgement`)
		if (!ack.successful) throw new BayeuxError(`${SETTINGS_CHANNEL}: ${ack.error ?? 'refused'}`)
	}

	/** Stop listening and tell the server we've gone. */
	async stop(): Promise<void> {
		if (this.stopped) return
		this.abort.abort()
		if (!this.clientId) return
		try {
			await fetch(`${this.baseUrl}/disconnect`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json;charset=UTF-8',
					...(this.cookie ? { Cookie: this.cookie } : {}),
				},
				body: JSON.stringify([{ channel: '/meta/disconnect', clientId: this.clientId, id: String(++this.nextId) }]),
				signal: AbortSignal.timeout(2000),
			})
		} catch {
			// The server drops the client by itself after its timeout.
		}
	}
}
