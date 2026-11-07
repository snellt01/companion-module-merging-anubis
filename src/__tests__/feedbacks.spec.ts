import { describe, expect, it } from 'vitest'
import { UpdateFeedbacks } from '../feedbacks.js'
import type ModuleInstance from '../main.js'
import { AnubisModel } from '../model.js'
import { fixtureState } from './fake-anubis.js'

// The feedback definitions, over the fixture's state
function feedbacks(): Record<string, any> {
	let defs: Record<string, any> = {}
	const self = {
		anubis: { model: new AnubisModel(fixtureState()) },
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
