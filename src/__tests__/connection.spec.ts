import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnubisConnection, type AnubisEvents } from '../anubis.js'
import { BayeuxListener } from '../bayeux.js'
import { AnubisModel } from '../model.js'
import { stripMute } from '../writes.js'
import { FakeAnubis, fixtureState } from './fake-anubis.js'

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
		// Nothing but the protocol's own messages and the publishes each test expects.
		expect(fake.forbidden).toEqual([])
	})

	it('sends nothing but the protocol messages when it connects', async () => {
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		await new Promise((resolve) => setTimeout(resolve, 300))
		expect(fake.channelsReceived().every((c) => c.startsWith('/meta/'))).toBe(true)
	})

	it('mutes a strip and sees the change come back', async () => {
		fake.expect(SEND(1210, 0), { mute: true })
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		const write = stripMute(latest!, 1210, 0, 'toggle')!
		expect(await connection.write(write)).toBe(true)
		expect(fake.published).toEqual([{ path: SEND(1210, 0), value: { mute: true } }])
		expect(latest?.strip(1210)?.sends.get(0)?.mute).toBe(true)
	})

	it('mutes a linked pair through its first strip', async () => {
		fake.expect(SEND(1200, 0), { link_mute: true })
		// What a real unit sent back
		fake.echo = (c) => [
			c,
			{ path: SEND(1200, 0), value: { mute: true, link_mute: true } },
			{ path: SEND(1201, 0), value: { mute: true, link_mute: true } },
		]
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		expect(await connection.write(stripMute(latest!, 1200, 0, 'on')!)).toBe(true)
		expect(fake.published).toHaveLength(1)
		expect(latest?.strip(1201)?.sends.get(0)?.mute).toBe(true)
	})

	it("reports a write that doesn't come back", async () => {
		fake.expect(SEND(1210, 0), { mute: true })
		fake.echo = () => []
		connection = new AnubisConnection({ url, retryMs: 50, confirmMs: 200 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		expect(await connection.write(stripMute(latest!, 1210, 0, 'on')!)).toBe(false)
	})

	it('sends one write per control every 50 ms, the latest winning', async () => {
		fake.expect(SEND(1210, 0), { mute: true })
		fake.expect(SEND(1210, 0), { mute: false })
		fake.echo = () => []
		connection = new AnubisConnection({ url, retryMs: 50, confirmMs: 100 }, events)
		connection.start()
		await waitFor(() => loads === 1)
		const on = stripMute(latest!, 1210, 0, 'on')!
		const off = { ...on, value: { mute: false } }
		const start = Date.now()
		// The second replaces the first, and the third the second, before they go
		const writes = [on, off, on].map(async (w) => connection!.write(w))
		const sentAt: number[] = []
		await waitFor(() => {
			if (fake.published.length > sentAt.length) sentAt.push(Date.now())
			return fake.published.length === 2
		})
		expect(await Promise.all(writes)).toEqual([false, null, false])
		expect(fake.published.map((c) => c.value)).toEqual([{ mute: true }, { mute: true }])
		expect(sentAt[1] - start).toBeGreaterThanOrEqual(45)
	})

	it('refuses to write when not connected', async () => {
		await fake.close()
		connection = new AnubisConnection({ url, retryMs: 50 }, events)
		connection.start()
		const write = stripMute(new AnubisModel(fixtureState()), 1210, 0, 'on')!
		await expect(connection.write(write)).rejects.toThrow('Not connected')
		fake = new FakeAnubis() // for afterEach
		await fake.start()
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

	it('refuses to publish anything outside the fixed list', async () => {
		const listener = new BayeuxListener('http://127.0.0.1:9/cometd', () => undefined)
		await expect(listener.publish({ path: '$.identity', value: { reboot: true } })).rejects.toThrow(
			'refusing to publish',
		)
		await expect(listener.publish({ path: SEND(1210, 0), value: { mute: true, gain: 60 } })).rejects.toThrow(
			'refusing to publish',
		)
	})
})
