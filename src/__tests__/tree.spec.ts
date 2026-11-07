import { describe, expect, it } from 'vitest'
import { applyChange, getAt, type Json, merge, parsePath } from '../tree.js'
import { fixtureState } from './fake-anubis.js'

const SEND = (strip: number, bus: number) =>
	`$._oem_ui_process_engine.music.mixer.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`

describe('parsePath', () => {
	it('reads the path forms the Anubis uses', () => {
		expect(parsePath(SEND(1001, 0))).toEqual([
			{ key: '_oem_ui_process_engine' },
			{ key: 'music' },
			{ key: 'mixer' },
			{ key: 'strips' },
			{ id: 1001 },
			{ key: 'sends' },
			{ id: 0 },
		])
		expect(parsePath('$._modules[?(@.id==154)][0].custom.ins.channels[1]')).toEqual([
			{ key: '_modules' },
			{ id: 154 },
			{ key: 'custom' },
			{ key: 'ins' },
			{ key: 'channels' },
			{ index: 1 },
		])
		expect(parsePath('$')).toEqual([])
	})

	it('rejects anything else', () => {
		expect(parsePath('$..strips')).toBeNull()
		expect(parsePath('$.strips[?(@.name=="x")][0]')).toBeNull()
		expect(parsePath('strips')).toBeNull()
	})
})

describe('merge', () => {
	it('merges objects and keeps fields that were not sent', () => {
		expect(merge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 4 } })).toEqual({ a: 1, b: { c: 4, d: 3 } })
	})

	it('merges arrays without ids item by item and takes the new length', () => {
		expect(merge([{ a: 1 }, { a: 2 }], [{ b: 3 }])).toEqual([{ a: 1, b: 3 }])
		expect(merge([1], [5, 6])).toEqual([5, 6])
	})

	it('merges lists kept by id by id, keeping the items not sent', () => {
		// What a real unit sends when the muted-DAWs view changes: some strips, one send each
		const strips: Json = [
			{
				id: 4,
				sends: [
					{ id: 0, visible: true, gain: 0 },
					{ id: 1, visible: true },
				],
			},
			{ id: 6, sends: [{ id: 0, visible: true }] },
			{ id: 1000, sends: [{ id: 0, visible: true }] },
		]
		let reshaped = 0
		merge(
			strips,
			[
				{ id: 6, sends: [{ id: 0, visible: false }] },
				{ id: 4, sends: [{ id: 1, visible: false }] },
			],
			() => reshaped++,
		)
		expect(strips).toEqual([
			{
				id: 4,
				sends: [
					{ id: 0, visible: true, gain: 0 },
					{ id: 1, visible: false },
				],
			},
			{ id: 6, sends: [{ id: 0, visible: false }] },
			{ id: 1000, sends: [{ id: 0, visible: true }] },
		])
		// A partial list may also mean items were removed: the state should be read again
		expect(reshaped).toBeGreaterThan(0)
	})

	it('adds new items to a list kept by id, and says so; the same ids in another order are no change', () => {
		let reshaped = 0
		const list = [
			{ id: 1, n: 0 },
			{ id: 2, n: 1 },
		]
		merge(
			list,
			[
				{ id: 2, n: 0 },
				{ id: 1, n: 1 },
			],
			() => reshaped++,
		)
		expect(reshaped).toBe(0)
		expect(list).toEqual([
			{ id: 1, n: 1 },
			{ id: 2, n: 0 },
		])
		merge(list, [{ id: 1 }, { id: 2 }, { id: 3, n: 2 }], () => reshaped++)
		expect(list.map((i) => i.id)).toEqual([1, 2, 3])
		expect(reshaped).toBe(1)
	})
})

describe('applyChange to an id the tree does not have', () => {
	it('is ignored, and says the state should be read again', () => {
		const tree = { strips: [{ id: 1, name: 'A' }] }
		let reshaped = 0
		expect(applyChange(tree, '$.strips[?(@.id==2)][0]', { name: 'B' }, () => reshaped++)).toBe(false)
		expect(applyChange(tree, '$.strips[?(@.id==2)][0].sends', [], () => reshaped++)).toBe(false)
		expect(reshaped).toBe(2)
		// A part of the tree the module never read isn't a reason to read again
		expect(applyChange(tree, '$.pages[?(@.id==2)][0]', { x: 1 }, () => reshaped++)).toBe(false)
		expect(reshaped).toBe(2)
	})
})

describe('applyChange', () => {
	it('applies a fader move to one send only', () => {
		const tree = fixtureState()
		expect(applyChange(tree, SEND(1001, 0), { gain: -200 })).toBe(true)
		expect(getAt(tree, SEND(1001, 0))).toMatchObject({ gain: -200, mute: true, pan: 0 })
		expect(getAt(tree, SEND(1001, 1))).toMatchObject({ gain: -1445 })
	})

	it('applies a collapsed pair mute the way the Anubis reports it', () => {
		const tree = fixtureState()
		applyChange(tree, SEND(1200, 0), { link_mute: true })
		applyChange(tree, SEND(1200, 0), { mute: true, link_mute: true })
		applyChange(tree, SEND(1201, 0), { mute: true, link_mute: true })
		expect(getAt(tree, SEND(1200, 0))).toMatchObject({ mute: true, link_mute: true })
		expect(getAt(tree, SEND(1201, 0))).toMatchObject({ mute: true, link_mute: true })
	})

	it('ignores a change to something that is not in the tree', () => {
		const tree = fixtureState()
		const before = JSON.stringify(tree)
		expect(applyChange(tree, SEND(4242, 0), { mute: true })).toBe(false)
		expect(applyChange(tree, '$.nothing.here', { x: 1 })).toBe(false)
		expect(applyChange(tree, '$..strips', { x: 1 })).toBe(false)
		expect(JSON.stringify(tree)).toBe(before)
	})

	it('adds a new key at the top level', () => {
		const tree = fixtureState()
		expect(applyChange(tree, '$.identity', { identify: true })).toBe(true)
		expect(getAt(tree, '$.identity.identify')).toBe(true)
		expect(getAt(tree, '$.identity.name')).toBe('Anubis')
	})
})
