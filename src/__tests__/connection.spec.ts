import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnubisConnection, type AnubisEvents } from '../anubis.js'
import { BayeuxListener } from '../bayeux.js'
import type { AnubisModel } from '../model.js'
import { FakeAnubis } from './fake-anubis.js'

const SEND = (strip: number, bus: number) =>
	`$._oem_ui_process_engine.music.mixer.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
	const end = Date.now() + ms
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out')
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

describe('AnubisConnection against a pretend Anubis', () => {
	let fake: FakeAnubis
	let url: string
	let connection: AnubisConnection | null
	let statuses: string[]
	let loads: number
	let latest: AnubisModel | null

	const events: AnubisEvents = {
		log: () => undefined,
		status: (status) => statuses.push(status),
		loaded: (model) => {
			loads++
			latest = model
		},
		changed: (model) => {
			latest = model
		},
	}

	beforeEach(async () => {
		fake = new FakeAnubis()
		url = await fake.start()
		statuses = []
		loads = 0
		latest = null
		connection = null
	})

	afterEach(async () => {
		await connection?.stop()
		await fake.close()
		// The read-only module sends nothing but the protocol's own messages.
		expect(fake.forbidden).toEqual([])
	})

	it('joins the feed, reads the state and reports ok', async () => {
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		expect(statuses).toEqual(['connecting', 'ok'])
		expect(latest?.deviceName).toBe('Anubis')
		expect(fake.received.filter((m) => m.channel === '/meta/subscribe').map((m) => m.subscription)).toEqual([
			'/ravenna/settings',
			'/ravenna/errors',
		])
		expect(fake.stateReads).toBe(1)
	})

	it('applies the changes the Anubis pushes', async () => {
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		fake.push(SEND(1001, 0), { gain: -200 })
		fake.push('$._oem_ui_process_engine.music.mixer.busses[?(@.id==0)][0]', { dim: true, osc: true })
		await waitFor(() => latest?.bus(0)?.dim === true)
		expect(latest?.strip(1001)?.sends.get(0)?.gain).toBe(-200)
	})

	it('keeps a change that arrives while the state is being read', async () => {
		let release = (): void => undefined
		fake.holdStateReads = new Promise((resolve) => (release = resolve))
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => fake.stateReads === 1)
		fake.push(SEND(1000, 0), { mute: true })
		await waitFor(() => fake.received.filter((m) => m.channel === '/meta/connect').length >= 2)
		release()
		await waitFor(() => loads === 1)
		expect(latest?.strip(1000)?.sends.get(0)?.mute).toBe(true)
	})

	it('starts again and re-reads the state when the Anubis drops the client', async () => {
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		fake.dropClient()
		await waitFor(() => loads === 2)
		expect(fake.stateReads).toBe(2)
		expect(fake.channelsReceived().filter((c) => c === '/meta/handshake')).toHaveLength(2)
		expect(statuses).toEqual(['connecting', 'ok', 'failed', 'connecting', 'ok'])
	})

	it('says goodbye when stopped and then stays quiet', async () => {
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		await connection.stop()
		await waitFor(() => fake.channelsReceived().includes('/meta/disconnect'))
		const count = fake.received.length
		await new Promise((resolve) => setTimeout(resolve, 400))
		expect(fake.received.length).toBe(count)
	})

	it('reports a failure when nothing answers, and keeps trying', async () => {
		await fake.close()
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => statuses.filter((s) => s === 'failed').length >= 2)
		fake = new FakeAnubis() // for afterEach
		await fake.start()
	})
})

describe('BayeuxListener', () => {
	it('refuses to send anything but the protocol messages', async () => {
		const listener = new BayeuxListener('http://127.0.0.1:9/cometd', () => undefined)
		const send = Reflect.get(listener, 'send') as (m: { channel: string }, t: number) => Promise<unknown>
		await expect(send.call(listener, { channel: '/service/ravenna/settings' }, 1000)).rejects.toThrow(
			'refusing to send to /service/ravenna/settings',
		)
	})
})
