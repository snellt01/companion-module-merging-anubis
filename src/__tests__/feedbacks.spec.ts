import { describe, expect, it } from 'vitest'
import { UpdateFeedbacks } from '../feedbacks.js'
import type ModuleInstance from '../main.js'
import { AnubisModel } from '../model.js'
import { applyChange, type JsonObject } from '../tree.js'
import { variableValues } from '../variables.js'
import { fixtureState } from './fake-anubis.js'

const MIX = '$._oem_ui_process_engine.music.mixer'

// The feedback definitions, over the fixture's state (with any changes)
function feedbacks(changes: [string, JsonObject][] = []): Record<string, any> {
	let defs: Record<string, any> = {}
	const tree = fixtureState()
	for (const [path, value] of changes) applyChange(tree, path, value)
	const self = {
		anubis: { model: new AnubisModel(tree) },
		setFeedbackDefinitions: (f: Record<string, any>) => (defs = f),
	} as unknown as ModuleInstance
	UpdateFeedbacks(self)
	return defs
}

describe('strip fader level feedback', () => {
	const level = feedbacks().strip_level
	const check = (strip: number, bus: number, compare: string, db: number): boolean =>
		level.callback({ options: { strip, bus, compare, db } })

	it('compares the fader with the level, to a tenth of a dB', () => {
		// Stream (a collapsed pair) is at -16.5 dB on MIXER
		expect(check(1200, 0, 'atOrAbove', -16.5)).toBe(true)
		expect(check(1200, 0, 'atOrAbove', -16.4)).toBe(false)
		expect(check(1200, 0, 'below', -16.4)).toBe(true)
		expect(check(1200, 0, 'below', -16.5)).toBe(false)
	})

	it('works on any bus, and treats -144.5 as -inf', () => {
		expect(check(1000, 3, 'atOrAbove', 0)).toBe(true) // MIC 1 on CUE2 at 0 dB
		expect(check(1001, 0, 'atOrAbove', -144.5)).toBe(true) // MIC 2 at -inf on MIXER
		expect(check(1001, 0, 'below', -144)).toBe(true)
	})

	it('is off for a strip or bus that isn’t there', () => {
		expect(check(9999, 0, 'below', 6)).toBe(false)
		expect(check(1000, 99, 'below', 6)).toBe(false)
	})
})

describe('talkback feedbacks and variables', () => {
	const talkingToCue2: [string, JsonObject] = [`${MIX}.busses[?(@.id==3)][0]`, { talking_to_cue: true }]
	const fromMic1: [string, JsonObject] = [`${MIX}.settings`, { talk_input: 1000 }]

	it('shows talkback to a cue bus, and to any cue bus', () => {
		const idle = feedbacks()
		expect(idle.talk_cue.callback({ options: { bus: 3 } })).toBe(false)
		expect(idle.talk_any.callback({ options: {} })).toBe(false)
		const talking = feedbacks([talkingToCue2])
		expect(talking.talk_cue.callback({ options: { bus: 3 } })).toBe(true)
		expect(talking.talk_cue.callback({ options: { bus: 4 } })).toBe(false)
		expect(talking.talk_any.callback({ options: {} })).toBe(true)
	})

	it('shows the talkback source', () => {
		expect(feedbacks().talk_input.callback({ options: { strip: 1000 } })).toBe(false)
		expect(feedbacks([fromMic1]).talk_input.callback({ options: { strip: 1000 } })).toBe(true)
	})

	it('has variables for the source and for talkback on each cue bus with a TALK button', () => {
		const tree = fixtureState()
		const before = variableValues(new AnubisModel(tree))
		expect(before).toMatchObject({ talk_input_id: 998, talk_input: '998', bus_3_talk: false })
		expect(before).not.toHaveProperty('bus_2_talk') // CUE1 follows the mix
		for (const [path, value] of [talkingToCue2, fromMic1]) applyChange(tree, path, value)
		expect(variableValues(new AnubisModel(tree))).toMatchObject({ talk_input: 'MIC 1', bus_3_talk: true })
	})
})

describe('SoundID feedback and variables', () => {
	const HEADPHONES = 757008898 // on MIXER-ALT and CUE1 in the fixture
	const SPEAKERS = 220994182

	it('shows SoundID on a bus, with any profile or one', () => {
		const soundId = feedbacks().bus_soundid
		expect(soundId.callback({ options: { bus: 1, profile: -2 } })).toBe(true)
		expect(soundId.callback({ options: { bus: 1, profile: HEADPHONES } })).toBe(true)
		expect(soundId.callback({ options: { bus: 1, profile: SPEAKERS } })).toBe(false)
		expect(soundId.callback({ options: { bus: 0, profile: -2 } })).toBe(false)
		expect(soundId.options[0].choices.map((c: { id: number }) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6])
	})

	it('has the profile and its target mode on each monitor and cue bus', () => {
		const values = variableValues(new AnubisModel(fixtureState()))
		expect(values).toMatchObject({
			bus_0_soundid: '',
			bus_0_soundid_target: '',
			bus_1_soundid: 'Headphones',
			bus_1_soundid_target: 'Flat',
		})
		expect(values).not.toHaveProperty('bus_7_soundid') // an effect bus
	})
})
