import { describe, expect, it } from 'vitest'
import { AnubisModel } from '../model.js'
import { applyChange } from '../tree.js'
import { isAllowedWrite, stripMute, WriteRefused } from '../writes.js'
import { fixtureState } from './fake-anubis.js'

const SEND = (strip: number, bus: number) =>
	`$._oem_ui_process_engine.music.mixer.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`
const INPUT = (id: number) => `$._oem_ui_process_engine.music.mixer.inputs[?(@.id==${id})][0]`

const model = () => new AnubisModel(fixtureState())

describe('stripMute', () => {
	it('mutes a single strip with mute, as the mute button does', () => {
		const write = stripMute(model(), 1210, 0, 'toggle')
		expect(write).toMatchObject({ path: SEND(1210, 0), value: { mute: true }, control: 'strip 1210 bus 0 mute' })
		expect(write?.description).toBe('Mute Stream 3 on MIXER')
	})

	it('toggles from the current state, and does nothing when already there', () => {
		// MIC 1 is muted on MIXER in the fixture
		expect(stripMute(model(), 1000, 0, 'toggle')?.value).toEqual({ mute: false })
		expect(stripMute(model(), 1000, 0, 'off')?.value).toEqual({ mute: false })
		expect(stripMute(model(), 1000, 0, 'on')).toBeNull()
	})

	it('writes a collapsed linked pair once, to its first strip, with link_mute', () => {
		const write = stripMute(model(), 1200, 0, 'on')
		expect(write).toMatchObject({ path: SEND(1200, 0), value: { link_mute: true } })
	})

	it('is confirmed only when both strips of a pair show the change', () => {
		const write = stripMute(model(), 1200, 0, 'on')
		const tree = fixtureState()
		applyChange(tree, SEND(1200, 0), { mute: true, link_mute: true })
		expect(write?.confirmed(new AnubisModel(tree))).toBe(false)
		applyChange(tree, SEND(1201, 0), { mute: true, link_mute: true })
		expect(write?.confirmed(new AnubisModel(tree))).toBe(true)
	})

	it("refuses strips and buses that aren't there", () => {
		expect(() => stripMute(model(), 999, 0, 'on')).toThrow(WriteRefused)
		expect(() => stripMute(model(), 1210, 12, 'on')).toThrow(WriteRefused)
		expect(() => stripMute(model(), 1.5, 0, 'on')).toThrow(WriteRefused)
		expect(() => stripMute(model(), Number.NaN, 0, 'on')).toThrow(WriteRefused)
	})

	it('refuses the hidden half of a linked pair', () => {
		expect(() => stripMute(model(), 1201, 0, 'on')).toThrow('hidden half')
	})

	it("refuses a strip whose input isn't connected, as the web UI does", () => {
		const tree = fixtureState()
		applyChange(tree, INPUT(1210), { connection_state: 0 })
		expect(() => stripMute(new AnubisModel(tree), 1210, 0, 'on')).toThrow("isn't connected")
	})
})

describe('isAllowedWrite', () => {
	it('allows the fixed list only', () => {
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: true } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1200, 0), value: { link_mute: false } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: 1 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: true, solo: true } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: 0 } })).toBe(false)
		expect(isAllowedWrite({ path: `${SEND(1210, 0)}.x`, value: { mute: true } })).toBe(false)
		expect(isAllowedWrite({ path: '$.identity', value: { identify: true } })).toBe(false)
		expect(isAllowedWrite({ path: '$.network', value: { mute: true } })).toBe(false)
	})
})
