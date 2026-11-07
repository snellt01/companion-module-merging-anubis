// A small Bayeux (CometD) client over long-polling, for the Anubis's web UI
// API at http://<anubis>/cometd.
//
// Listen-only: it sends the protocol's own messages (handshake, subscribe,
// connect, disconnect) and nothing else. Writes will be added through a
// fixed list of the web UI's own messages, never a general publish.

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

	constructor(
		private readonly baseUrl: string,
		private readonly onMessage: (message: BayeuxMessage) => void,
	) {}

	get stopped(): boolean {
		return this.abort.signal.aborted
	}

	private async send(message: Omit<BayeuxMessage, 'id' | 'clientId'>, timeoutMs: number): Promise<BayeuxMessage[]> {
		if (!META_CHANNELS.has(message.channel)) throw new Error(`refusing to send to ${message.channel}`)
		const body: BayeuxMessage = { ...message, id: String(++this.nextId) }
		if (this.clientId && message.channel !== '/meta/handshake') body.clientId = this.clientId
		const response = await fetch(`${this.baseUrl}/${message.channel.slice('/meta/'.length)}`, {
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
		if (!response.ok) throw new BayeuxError(`${message.channel}: HTTP ${response.status}`)
		const replies = (await response.json()) as BayeuxMessage[]
		if (!Array.isArray(replies)) throw new BayeuxError(`${message.channel}: unexpected reply`)
		return replies
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
