// What happens when strips are linked or unlinked on the Anubis while
// buttons are set up: the web UI sends `_link_with_left` / `_unlink` /
// `collapsed_link` (layout writes the module never sends). On a link or
// unlink a real unit pushes every input's `linked_input_id`, `hard_link`
// and `collapsed_link` (an unlinked strip keeps `collapsed_link: true`),
// then the strips' sends: with `link_*` after a link, without after an
// unlink (merged, so the old `link_*` stay). Expanding or collapsing a
// pair pushes only the two inputs' `collapsed_link`.

import { afterEach, describe, expect, it } from 'vitest'
import { AnubisConnection } from '../anubis.js'
import { stripChoices } from '../feedbacks.js'
import { AnubisModel } from '../model.js'
import { applyChange, type Json, type JsonObject } from '../tree.js'
import { variableValues } from '../variables.js'
import { stripFader, stripMute, stripPan, stripSolo } from '../writes.js'
import { FakeAnubis, fixtureState } from './fake-anubis.js'

const MIX = '$._oem_ui_process_engine.music.mixer'
const INPUT = (id: number) => `${MIX}.inputs[?(@.id==${id})][0]`
const SEND = (strip: number, bus: number) => `${MIX}.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`

function withChanges(changes: [string, Json][]): AnubisModel {
	const tree: JsonObject = fixtureState()
	for (const [path, value] of changes) applyChange(tree, path, value)
	return new AnubisModel(tree)
}
const unlinkAvio: [string, Json][] = [
	[INPUT(1200), { linked_input_id: -1, hard_link: false, collapsed_link: true, _link_with_right: false }],
	[INPUT(1201), { linked_input_id: -1, hard_link: false, collapsed_link: true, _link_with_left: false }],
	[INPUT(1200), { _link_changed: true }],
]
const linkMics: [string, Json][] = [
	[INPUT(1000), { linked_input_id: 1001, hard_link: false, collapsed_link: true, _unlink: false }],
	[INPUT(1001), { linked_input_id: 1000, hard_link: false, collapsed_link: true, _unlink: false }],
	[INPUT(1000), { _link_changed: true }],
]

describe('a linked pair is unlinked', () => {
	const model = withChanges(unlinkAvio)

	it('lists the two strips separately', () => {
		const labels = stripChoices(model).map((c) => c.label)
		expect(labels).toContain('Stream-L')
		expect(labels).toContain('Stream-R')
		expect(labels).not.toContain('Stream-L + Stream-R')
	})

	it('writes to the left strip alone: a button set up for the pair now changes Stream-L only', () => {
		expect(stripMute(model, 1200, 0, 'on')?.value).toEqual({ mute: true })
		expect(stripMute(model, 1201, 0, 'on')?.value).toEqual({ mute: true })
		expect(stripSolo(model, 1200, 0, 'on')?.value).toEqual({ solo: true })
		expect(stripFader(model, 1200, 0, { to: -10 })?.value).toEqual({ gain: -100 })
		// Each side now has its own pan, as in the web UI
		expect(stripPan(model, 1200, 0, { to: 0 })?.value).toEqual({ pan: 0 })
	})

	it('shows each side’s own level, not the stale link_gain', () => {
		const tree = fixtureState()
		applyChange(tree, SEND(1200, 0), { gain: -170, link_gain: -120 })
		for (const [path, value] of unlinkAvio) applyChange(tree, path, value)
		const m = new AnubisModel(tree)
		expect(m.strip(1200)?.sends.get(0)?.faderGain).toBe(-170)
		expect(variableValues(m).strip_1200_gain).toBe('-17.0')
	})
})

describe('a linked pair is expanded (still linked, shown as two strips)', () => {
	const model = withChanges([
		[INPUT(1200), { collapsed_link: false }],
		[INPUT(1201), { collapsed_link: false }],
	])

	it('treats the sides as separate strips, as the web UI writes them', () => {
		expect(stripChoices(model).map((c) => c.label)).toEqual(expect.arrayContaining(['Stream-L', 'Stream-R']))
		expect(stripMute(model, 1201, 0, 'on')?.value).toEqual({ mute: true })
		// Each side has its own pan again (Stream-R is at 100 in the fixture)
		expect(stripPan(model, 1201, 0, { to: 0 })?.value).toEqual({ pan: 0 })
	})
})

describe('two single strips are linked', () => {
	const model = withChanges(linkMics)

	it('lists them as one pair, under the lower id', () => {
		const choices = stripChoices(model)
		expect(choices.find((c) => c.id === 1000)?.label).toBe('MIC 1 + MIC 2')
		expect(choices.find((c) => c.id === 1001)).toBeUndefined()
	})

	it('writes the pair through MIC 1 with link_*, and refuses buttons set up for MIC 2', () => {
		expect(stripMute(model, 1000, 0, 'off')?.value).toEqual({ link_mute: false })
		expect(stripFader(model, 1000, 0, { to: -10 })?.value).toEqual({ link_gain: -100 })
		expect(() => stripMute(model, 1001, 0, 'off')).toThrow('hidden half')
		expect(() => stripFader(model, 1001, 0, { to: -10 })).toThrow('hidden half')
		expect(() => stripPan(model, 1000, 0, { to: 0 })).toThrow('no pan')
	})

	it('still shows MIC 2’s own state in its variables and feedback', () => {
		expect(variableValues(model).strip_1001_mute).toBe(true)
		expect(model.strip(1001)?.sends.get(0)?.mute).toBe(true)
	})
})

describe('linking changes pushed while connected', () => {
	let fake: FakeAnubis
	let connection: AnubisConnection | null = null

	afterEach(async () => {
		await connection?.stop()
		await fake.close()
		expect(fake.forbidden).toEqual([])
	})

	it('follows an unlink and a link without reconnecting, and sends nothing', async () => {
		fake = new FakeAnubis()
		const url = await fake.start()
		let latest: AnubisModel | null = null
		let loads = 0
		connection = new AnubisConnection(
			{ url, retryMs: 50 },
			{
				log: () => undefined,
				status: () => undefined,
				loaded: (m) => {
					loads++
					latest = m
				},
				changed: (m) => (latest = m),
			},
		)
		connection.start()
		const waitFor = async (check: () => boolean) => {
			const end = Date.now() + 3000
			while (!check()) {
				if (Date.now() > end) throw new Error('timed out')
				await new Promise((r) => setTimeout(r, 10))
			}
		}
		await waitFor(() => loads === 1)
		for (const [path, value] of unlinkAvio) fake.push(path, value)
		await waitFor(() => latest?.strip(1200)?.partnerId === null)
		for (const [path, value] of linkMics) fake.push(path, value)
		await waitFor(() => latest?.strip(1000)?.partnerId === 1001)
		expect(stripChoices(latest).map((c) => c.label)).toEqual(
			expect.arrayContaining(['MIC 1 + MIC 2', 'Stream-L', 'Stream-R']),
		)
		expect(loads).toBe(1)
		expect(fake.channelsReceived().every((c) => c.startsWith('/meta/'))).toBe(true)
	})
})
