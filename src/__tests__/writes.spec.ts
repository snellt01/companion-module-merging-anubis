import { describe, expect, it } from 'vitest'
import { AnubisModel } from '../model.js'
import { applyChange } from '../tree.js'
import { isAllowedWrite, levelFromDb, stripFader, stripMute, stripSolo, WriteRefused } from '../writes.js'
import { fixtureState } from './fake-anubis.js'

const MIX = '$._oem_ui_process_engine.music.mixer'
const SEND = (strip: number, bus: number) => `${MIX}.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`
const INPUT = (id: number) => `${MIX}.inputs[?(@.id==${id})][0]`

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

	it('refuses strips the web UI gives no mute button: cue returns, talk mics', () => {
		expect(() => stripMute(model(), 4, 0, 'on')).toThrow('has no mute button')
		const tree = fixtureState()
		applyChange(tree, `${MIX}.strips[?(@.id==1210)][0]`, { type: 2 })
		expect(() => stripMute(new AnubisModel(tree), 1210, 0, 'on')).toThrow('has no mute button')
	})

	it("refuses a bus the strip isn't shown on", () => {
		const tree = fixtureState()
		applyChange(tree, SEND(1210, 7), { visible: false })
		expect(() => stripMute(new AnubisModel(tree), 1210, 7, 'on')).toThrow("isn't shown on that bus")
		expect(stripMute(new AnubisModel(tree), 1210, 0, 'on')).not.toBeNull()
	})

	it('refuses a strip inside a group collapsed on the bus, or a group it can’t read', () => {
		const tree = fixtureState()
		applyChange(tree, `${MIX}.strips[?(@.id==1210)][0]`, { group_id: 0 })
		// No groups in the state: can't tell, so refused
		expect(() => stripMute(new AnubisModel(tree), 1210, 0, 'on')).toThrow('group collapsed')
		applyChange(tree, MIX, { groups: [{ id: 0, collapsed_on_bus: [true, false] }] })
		expect(() => stripMute(new AnubisModel(tree), 1210, 0, 'on')).toThrow('group collapsed')
		expect(stripMute(new AnubisModel(tree), 1210, 1, 'on')?.value).toEqual({ mute: true })
	})
})

describe('stripSolo', () => {
	it('solos with solo, and a collapsed pair with link_solo', () => {
		const write = stripSolo(model(), 1210, 0, 'toggle')
		expect(write).toMatchObject({ path: SEND(1210, 0), value: { solo: true }, control: 'strip 1210 bus 0 solo' })
		expect(write?.description).toBe('Solo Stream 3 on MIXER')
		expect(stripSolo(model(), 1200, 0, 'on')?.value).toEqual({ link_solo: true })
		expect(stripSolo(model(), 1210, 0, 'off')).toBeNull()
	})

	it('has the same limits as mute', () => {
		expect(() => stripSolo(model(), 4, 0, 'on')).toThrow('has no solo button')
		expect(() => stripSolo(model(), 1201, 0, 'on')).toThrow('hidden half')
	})
})

describe('stripFader', () => {
	it('sets a level in whole tenths of a dB, truncated and kept in range, as the gain entry does', () => {
		expect(levelFromDb(-12.34)).toBe(-123)
		expect(levelFromDb(-0.07)).toBe(0)
		expect(levelFromDb(4.35)).toBe(43)
		expect(levelFromDb(10)).toBe(60)
		expect(levelFromDb(-200)).toBe(-1445)
		expect(() => levelFromDb(Number.NaN)).toThrow(WriteRefused)
	})

	it('moves a single strip with gain', () => {
		const write = stripFader(model(), 1210, 0, { to: -10 })
		expect(write).toMatchObject({ path: SEND(1210, 0), value: { gain: -100 }, control: 'strip 1210 bus 0 gain' })
		expect(write?.description).toBe('Stream 3 on MIXER to -10.0 dB')
		expect(stripFader(model(), 1210, 0, { to: 0 })).toBeNull()
	})

	it('steps from the current level, from -inf too, and stops at the ends', () => {
		expect(stripFader(model(), 1210, 0, { by: -3 })?.value).toEqual({ gain: -30 })
		expect(stripFader(model(), 1210, 0, { by: 10 })?.value).toEqual({ gain: 60 })
		// MIC 1 is at -inf on MIXER
		expect(stripFader(model(), 1000, 0, { by: 1 })?.value).toEqual({ gain: -1435 })
		expect(stripFader(model(), 1000, 0, { by: -1 })).toBeNull()
	})

	it('moves a collapsed pair with link_gain, from what its fader shows', () => {
		const tree = fixtureState()
		applyChange(tree, SEND(1200, 0), { gain: -170, link_gain: -120 })
		const write = stripFader(new AnubisModel(tree), 1200, 0, { by: 1 })
		expect(write).toMatchObject({ path: SEND(1200, 0), value: { link_gain: -110 } })
		applyChange(tree, SEND(1200, 0), { link_gain: -110 })
		expect(write?.confirmed(new AnubisModel(tree))).toBe(true)
		expect(() => stripFader(model(), 1201, 0, { to: 0 })).toThrow('hidden half')
	})

	it('refuses strips without a fader and buses the strip isn’t shown on', () => {
		expect(() => stripFader(model(), 4, 0, { to: 0 })).toThrow('has no fader')
		const tree = fixtureState()
		applyChange(tree, `${MIX}.strips[?(@.id==1210)][0]`, { type: 5 }) // monitor return
		expect(() => stripFader(new AnubisModel(tree), 1210, 0, { to: 0 })).toThrow('has no fader')
		applyChange(tree, `${MIX}.strips[?(@.id==1210)][0]`, { type: 7 }) // effect return
		applyChange(tree, SEND(1210, 7), { visible: false })
		expect(stripFader(new AnubisModel(tree), 1210, 0, { to: -1 })).not.toBeNull()
		expect(() => stripFader(new AnubisModel(tree), 1210, 7, { to: 0 })).toThrow("isn't shown")
	})

	it('moves the fader of a strip whose input is disconnected, as the web UI allows', () => {
		const tree = fixtureState()
		applyChange(tree, INPUT(1210), { connection_state: 0 })
		expect(stripFader(new AnubisModel(tree), 1210, 0, { to: -1 })?.value).toEqual({ gain: -10 })
	})
})

describe('isAllowedWrite', () => {
	it('allows the fixed list only', () => {
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: true } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1200, 0), value: { link_mute: false } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { solo: true } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1200, 0), value: { link_solo: true } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { solo_safe: true } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: -1445 } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1200, 0), value: { link_gain: 60 } })).toBe(true)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: 61 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: -1446 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: -10.5 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { gain: '0' } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { group_gain: 0 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { toString: 0 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: 1 } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { mute: true, solo: true } })).toBe(false)
		expect(isAllowedWrite({ path: SEND(1210, 0), value: { pan: 0 } })).toBe(false)
		expect(isAllowedWrite({ path: `${SEND(1210, 0)}.x`, value: { mute: true } })).toBe(false)
		expect(isAllowedWrite({ path: '$.identity', value: { identify: true } })).toBe(false)
		expect(isAllowedWrite({ path: '$.network', value: { mute: true } })).toBe(false)
	})
})
