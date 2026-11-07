// Ready-made buttons, built from the Anubis's own strips, buses and
// preamps (so they appear once its state has been read). Each one is a
// write action with the feedback that shows its state. Strip presets are
// for the MIXER bus; the actions take any bus once placed.

import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { CompanionButtonStyleProps } from '@companion-module/base'
import { BLACK, BLUE, busChoices, GREEN, ORANGE, RED, stripChoices, WHITE, YELLOW } from './feedbacks.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { DEFAULT_HOLD_MS } from './talkback.js'

const MIXER_BUS = 0

const style = (text: string): CompanionButtonStyleProps => ({ text, size: 'auto', color: WHITE, bgcolor: BLACK })

export function UpdatePresets(self: ModuleInstance): void {
	const model = self.anubis?.model ?? null
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []
	if (!model) {
		self.setPresetDefinitions(sections, presets)
		return
	}
	const v = (name: string) => `$(${self.label}:${name})`

	// Strips: mute, solo, fader up and down, on MIXER
	const strips: string[] = []
	for (const { id, label } of stripChoices(model)) {
		const strip = model.strip(id)
		if (!strip) continue
		const target = { strip: id, bus: MIXER_BUS }
		if (strip.hasMuteSolo) {
			presets[`strip_mute_${id}`] = {
				type: 'simple',
				name: `${label}: mute`,
				style: style(`${label}\nMUTE`),
				steps: [{ down: [{ actionId: 'strip_mute', options: { ...target, set: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'strip_mute', options: target, style: { bgcolor: RED, color: WHITE } }],
			}
			presets[`strip_solo_${id}`] = {
				type: 'simple',
				name: `${label}: solo`,
				style: style(`${label}\nSOLO`),
				steps: [{ down: [{ actionId: 'strip_solo', options: { ...target, set: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'strip_solo', options: target, style: { bgcolor: YELLOW, color: BLACK } }],
			}
			strips.push(`strip_mute_${id}`, `strip_solo_${id}`)
		}
		if (strip.hasFader) {
			for (const [dir, db] of [
				['up', 1],
				['down', -1],
			] as const) {
				presets[`strip_fader_${dir}_${id}`] = {
					type: 'simple',
					name: `${label}: fader ${dir} 1 dB`,
					style: style(`${label}\n${dir === 'up' ? '+' : '-'}1 dB\n${v(`strip_${id}_gain`)}`),
					steps: [{ down: [{ actionId: 'strip_fader_step', options: { ...target, db } }], up: [] }],
					feedbacks: [],
				}
				strips.push(`strip_fader_${dir}_${id}`)
			}
		}
	}
	sections.push({ id: 'strips', name: 'Strips (MIXER)', definitions: strips })

	// Buses: mute everywhere; dim and mono where the bus has them
	const busses: string[] = []
	for (const { id, label } of busChoices(model)) {
		const bus = model.bus(id)
		if (!bus) continue
		const buttons = [['mute', 'MUTE', RED, WHITE]] as [string, string, number, number][]
		if (bus.monitors) buttons.push(['dim', 'DIM', ORANGE, BLACK], ['mono', 'MONO', BLUE, WHITE])
		for (const [button, text, bgcolor, color] of buttons) {
			const key = `bus_${button}_${id}`
			const actionId = `bus_${button}` as 'bus_mute' | 'bus_dim' | 'bus_mono'
			presets[key] = {
				type: 'simple',
				name: `${label}: ${button}`,
				style: style(`${label}\n${text}`),
				steps: [{ down: [{ actionId, options: { bus: id, set: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: actionId, options: { bus: id }, style: { bgcolor, color } }],
			}
			busses.push(key)
		}
	}
	sections.push({ id: 'busses', name: 'Buses', definitions: busses })

	// Preamps: the switches each preamp has, and gain up and down
	const preamps: string[] = []
	for (const p of model.preamps()) {
		const switches = [
			['48V', 'preamp_48v', 'phantom', '48V', RED],
			['phase', 'preamp_phase', 'phase', 'PHASE', BLUE],
			['lowCut', 'preamp_lowcut', 'lowCut', 'LOW CUT', BLUE],
			['cut', 'preamp_cut', 'cut', 'CUT', RED],
			['lock', 'preamp_lock', 'lock', 'LOCK', ORANGE],
		] as const
		for (const [capability, actionId, setting, text, bgcolor] of switches) {
			if (p.capabilities[capability] !== true) continue
			const key = `${actionId}_${p.inputId}`
			presets[key] = {
				type: 'simple',
				name: `${p.name} preamp: ${text.toLowerCase()}`,
				style: style(`${p.name}\n${text}`),
				steps: [{ down: [{ actionId, options: { preamp: p.inputId, set: 'toggle' } }], up: [] }],
				feedbacks: [
					{
						feedbackId: 'preamp_setting',
						options: { preamp: p.inputId, setting },
						style: { bgcolor, color: WHITE },
					},
				],
			}
			preamps.push(key)
		}
		for (const [dir, db] of [
			['up', 1],
			['down', -1],
		] as const) {
			const key = `preamp_gain_${dir}_${p.inputId}`
			presets[key] = {
				type: 'simple',
				name: `${p.name} preamp: gain ${dir} 1 dB`,
				style: style(`${p.name}\nGAIN ${dir === 'up' ? '+' : '-'}1\n${v(`preamp_${p.inputId}_gain`)}`),
				steps: [{ down: [{ actionId: 'preamp_gain_step', options: { preamp: p.inputId, db } }], up: [] }],
				feedbacks: [],
			}
			preamps.push(key)
		}
	}
	sections.push({ id: 'preamps', name: 'Preamps', definitions: preamps })

	// Talkback: a tap latches, a hold talks while held; to each cue bus with
	// a TALK button and to all of them; and the talkback's source
	const talk: string[] = []
	for (const { id, label } of busChoices(model)) {
		if (!model.bus(id)?.hasTalk) continue
		const options = { bus: id }
		presets[`talk_cue_${id}`] = {
			type: 'simple',
			name: `Talk to ${label} (tap to latch, hold to talk)`,
			style: style(`TALK\n${label}`),
			steps: [
				{
					down: [{ actionId: 'talk_cue_button', options: { ...options, event: 'press', hold: DEFAULT_HOLD_MS } }],
					up: [{ actionId: 'talk_cue_button', options: { ...options, event: 'release', hold: DEFAULT_HOLD_MS } }],
				},
			],
			feedbacks: [{ feedbackId: 'talk_cue', options, style: { bgcolor: ORANGE, color: BLACK } }],
		}
		talk.push(`talk_cue_${id}`)
	}
	if (talk.length > 0) {
		presets.talk_all = {
			type: 'simple',
			name: 'Talk to all cue buses (tap to latch, hold to talk)',
			style: style('TALK\nALL'),
			steps: [
				{
					down: [{ actionId: 'talk_all_button', options: { event: 'press', hold: DEFAULT_HOLD_MS } }],
					up: [{ actionId: 'talk_all_button', options: { event: 'release', hold: DEFAULT_HOLD_MS } }],
				},
			],
			feedbacks: [{ feedbackId: 'talk_any', options: {}, style: { bgcolor: ORANGE, color: BLACK } }],
		}
		talk.push('talk_all')
	}
	for (const { id, label } of stripChoices(model)) {
		const strip = model.strip(id)
		if (!strip?.canTalk || ![...strip.sends.values()].some((s) => s.visible && model.bus(s.bus)?.type === 1)) continue
		presets[`talk_input_${id}`] = {
			type: 'simple',
			name: `Talkback source: ${label}`,
			style: style(`TALK FROM\n${label}`),
			steps: [{ down: [{ actionId: 'talk_input', options: { strip: id } }], up: [] }],
			feedbacks: [{ feedbackId: 'talk_input', options: { strip: id }, style: { bgcolor: BLUE, color: WHITE } }],
		}
		talk.push(`talk_input_${id}`)
	}
	sections.push({ id: 'talkback', name: 'Talkback', definitions: talk })

	// SoundID: each profile on each monitor and cue bus, toggled
	const soundId: string[] = []
	for (const b of model.busses()) {
		if (!b.hasSoundId) continue
		for (const p of model.soundIdProfiles ?? []) {
			const key = `bus_soundid_${b.id}_${p.id}`
			presets[key] = {
				type: 'simple',
				name: `${b.name}: SoundID ${p.name}`,
				style: style(`${b.name}\nSOUNDID\n${p.name}`),
				steps: [{ down: [{ actionId: 'bus_soundid', options: { bus: b.id, profile: p.id, set: 'toggle' } }], up: [] }],
				feedbacks: [
					{ feedbackId: 'bus_soundid', options: { bus: b.id, profile: p.id }, style: { bgcolor: GREEN, color: WHITE } },
				],
			}
			soundId.push(key)
		}
	}
	if (soundId.length > 0) sections.push({ id: 'soundid', name: 'SoundID', definitions: soundId })

	self.setPresetDefinitions(sections, presets)
}
