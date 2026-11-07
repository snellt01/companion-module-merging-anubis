import { describe, expect, it } from 'vitest'
import { UpdateActions } from '../actions.js'
import { UpdateFeedbacks } from '../feedbacks.js'
import type ModuleInstance from '../main.js'
import { AnubisModel } from '../model.js'
import { UpdatePresets } from '../presets.js'
import { fixtureState } from './fake-anubis.js'

type Captured = { sections: { id: string; definitions: string[] }[]; presets: Record<string, any> }

// A stand-in for the module instance, holding the fixture's state
function build(): {
	captured: Captured
	actions: Record<string, any>
	feedbacks: Record<string, any>
	writes: unknown[]
} {
	const model = new AnubisModel(fixtureState())
	const captured = {} as Captured
	let actions: Record<string, any> = {}
	let feedbacks: Record<string, any> = {}
	const writes: unknown[] = []
	const self = {
		label: 'anubis',
		anubis: { model },
		setPresetDefinitions: (sections: Captured['sections'], presets: Captured['presets']) => {
			captured.sections = sections
			captured.presets = presets
		},
		setActionDefinitions: (a: Record<string, any>) => (actions = a),
		setFeedbackDefinitions: (f: Record<string, any>) => (feedbacks = f),
		write: async (b: (m: AnubisModel) => unknown) => {
			writes.push(b(model))
		},
	} as unknown as ModuleInstance
	UpdateActions(self)
	UpdateFeedbacks(self)
	UpdatePresets(self)
	return { captured, actions, feedbacks, writes }
}

describe('presets', () => {
	it('makes buttons from the Anubis’s own strips, buses and preamps', () => {
		const { captured } = build()
		const ids = Object.keys(captured.presets)
		expect(ids).toContain('strip_mute_1200') // Stream-L + Stream-R
		expect(ids).not.toContain('strip_mute_1201') // its hidden half
		expect(ids).not.toContain('strip_mute_4') // cue return: no mute
		expect(ids).toContain('bus_dim_0')
		expect(ids).not.toContain('bus_dim_6') // CUE5 has no dim
		expect(ids).toContain('preamp_48v_1000')
		expect(ids).not.toContain('preamp_48v_1002') // jack: no 48 V
		expect(ids).toEqual(expect.arrayContaining(['talk_cue_3', 'talk_cue_6', 'talk_all', 'talk_input_1000']))
		expect(ids).not.toContain('talk_cue_2') // CUE1 follows the mix: no TALK button
		expect(ids).not.toContain('talk_input_4') // a cue return can't be the talk input
		expect(captured.presets.talk_cue_3.steps[0]).toMatchObject({
			down: [{ actionId: 'talk_cue', options: { bus: 3, set: 'on' } }],
			up: [{ actionId: 'talk_cue', options: { bus: 3, set: 'off' } }],
		})
		expect(captured.presets.strip_mute_1200.style.text).toBe('Stream-L + Stream-R\nMUTE')
		expect(captured.presets.strip_fader_up_1000.style.text).toContain('$(anubis:strip_1000_gain)')
		// Every preset is in a section, once
		const listed = captured.sections.flatMap((s) => s.definitions)
		expect(listed.sort()).toEqual(ids.sort())
	})

	it('uses only actions and feedbacks the module defines, with options they accept', async () => {
		const { captured, actions, feedbacks, writes } = build()
		let run = 0
		for (const [id, preset] of Object.entries(captured.presets)) {
			for (const a of [...preset.steps[0].down, ...preset.steps[0].up]) {
				expect(actions[a.actionId], `${id}: ${a.actionId}`).toBeDefined()
				await actions[a.actionId].callback({ options: a.options })
				run++
			}
			for (const f of preset.feedbacks) {
				expect(feedbacks[f.feedbackId], `${id}: ${f.feedbackId}`).toBeDefined()
				expect(typeof feedbacks[f.feedbackId].callback({ options: f.options })).toBe('boolean')
			}
		}
		// Each preset's actions build a write (or nothing to do) without being refused
		expect(writes.length).toBe(run)
	})
})
