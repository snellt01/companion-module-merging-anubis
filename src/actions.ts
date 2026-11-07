import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { busChoices, preampChoices, stripChoices } from './feedbacks.js'
import { INPUT_MODES } from './model.js'
import {
	busButton,
	busMaster,
	busRef,
	type OnOff,
	type PadMode,
	preampGain,
	preampLowCut,
	preampMode,
	preampPad,
	type PreampSwitch,
	preampSwitch,
	stripFader,
	stripMute,
	stripPan,
	stripSolo,
} from './writes.js'

type StripButtonOptions = { strip: number; bus: number; set: OnOff }
type StripLevelOptions = { strip: number; bus: number; db: number }
type StripPanOptions = { strip: number; bus: number; pan: number }
type BusButtonOptions = { bus: number; set: OnOff }
type BusLevelOptions = { bus: number; db: number }

export type ActionsSchema = {
	refresh: { options: Record<string, never> }
	strip_mute: { options: StripButtonOptions }
	strip_solo: { options: StripButtonOptions }
	strip_fader: { options: StripLevelOptions }
	strip_fader_step: { options: StripLevelOptions }
	strip_pan: { options: StripPanOptions }
	strip_pan_step: { options: StripPanOptions }
	bus_master: { options: BusLevelOptions }
	bus_master_step: { options: BusLevelOptions }
	bus_mute: { options: BusButtonOptions }
	bus_dim: { options: BusButtonOptions }
	bus_mono: { options: BusButtonOptions }
	bus_ref: { options: { bus: number } }
	preamp_mode: { options: { preamp: number; mode: number } }
	preamp_gain: { options: { preamp: number; db: number } }
	preamp_gain_step: { options: { preamp: number; db: number } }
	preamp_48v: { options: PreampSwitchOptions }
	preamp_phase: { options: PreampSwitchOptions }
	preamp_cut: { options: PreampSwitchOptions }
	preamp_lock: { options: PreampSwitchOptions }
	preamp_lowcut: { options: PreampSwitchOptions }
	preamp_pad: { options: { preamp: number; pad: PadMode } }
}

type PreampSwitchOptions = { preamp: number; set: OnOff }

const PAD_MODES: DropdownChoice<PadMode>[] = [
	{ id: 'lift', label: 'Lift' },
	{ id: 'off', label: 'Off' },
	{ id: 'pad', label: 'Pad' },
]

const ON_OFF: DropdownChoice<OnOff>[] = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
]

const LEVEL = { label: 'Level (dB)', default: 0, min: -144.5, max: 6 }
const LEVEL_STEP = { label: 'Step (dB)', default: 1, min: -150, max: 150 }

export function UpdateActions(self: ModuleInstance): void {
	const model = self.anubis?.model ?? null
	const stripsWhere = (has: (id: number) => boolean | undefined) => stripChoices(model).filter((c) => has(c.id))
	// Talk and cue return strips have no mute or solo buttons
	const buttonStrips = stripsWhere((id) => model?.strip(id)?.hasMuteSolo)
	// Talk, monitor return and cue return strips have no fader
	const faderStrips = stripsWhere((id) => model?.strip(id)?.hasFader)
	// A linked pair shown as one strip has no pan
	const panStrips = stripsWhere((id) => model?.strip(id)?.collapsedLink === false)
	const busses = busChoices(model)
	const panBusses = busses.filter((b) => model?.bus(b.id)?.panEditable)
	const monitorBusses = busses.filter((b) => model?.bus(b.id)?.monitors)
	const preampsWith = (capability: string) =>
		preampChoices(model).filter((c) => model?.preamp(c.id)?.capabilities[capability] === true)
	const preamps = preampChoices(model)
	// allowCustom on the id lists: they are empty until the Anubis's state
	// has been read, and Companion checks saved buttons against them at
	// start-up. Every write is checked against the live state anyway.
	const preampOption = (choices: DropdownChoice<number>[]) =>
		({
			type: 'dropdown',
			id: 'preamp',
			label: 'Preamp',
			choices,
			default: choices[0]?.id ?? 0,
			allowCustom: true,
		}) as const
	const preampSwitchAction = (which: PreampSwitch, name: string, label: string, choices: DropdownChoice<number>[]) => ({
		name,
		options: [preampOption(choices), onOffOption(label)],
		callback: async ({ options: o }: { options: PreampSwitchOptions }) => {
			await self.write((m) => preampSwitch(m, Number(o.preamp), which, o.set))
		},
	})

	const stripOption = (choices: DropdownChoice<number>[]) =>
		({
			type: 'dropdown',
			id: 'strip',
			label: 'Strip',
			choices,
			default: choices[0]?.id ?? 0,
			allowCustom: true,
		}) as const
	const busOption = (choices: DropdownChoice<number>[]) =>
		({ type: 'dropdown', id: 'bus', label: 'Bus', choices, default: choices[0]?.id ?? 0, allowCustom: true }) as const
	const onOffOption = (label: string) =>
		({ type: 'dropdown', id: 'set', label, choices: ON_OFF, default: 'toggle' }) as const
	const dbOption = (db: typeof LEVEL) => ({ type: 'number', id: 'db', step: 0.1, ...db }) as const
	const panOption = (pan: { label: string; default: number; min: number; max: number }) =>
		({ type: 'number', id: 'pan', step: 1, ...pan }) as const

	self.setActionDefinitions({
		refresh: {
			name: 'Read the Anubis state again',
			description: 'Reads the whole state from the Anubis. Sends nothing to the mixer.',
			options: [],
			callback: async () => {
				await self.anubis?.refresh()
			},
		},
		strip_mute: {
			name: 'Strip: mute',
			description: "Mutes or unmutes a strip on a bus, as the strip's mute button does",
			options: [stripOption(buttonStrips), busOption(busses), onOffOption('Mute')],
			callback: async ({ options: o }) => {
				await self.write((m) => stripMute(m, Number(o.strip), Number(o.bus), o.set))
			},
		},
		strip_solo: {
			name: 'Strip: solo',
			description: "Solos or unsolos a strip on a bus, as the strip's solo button does",
			options: [stripOption(buttonStrips), busOption(busses), onOffOption('Solo')],
			callback: async ({ options: o }) => {
				await self.write((m) => stripSolo(m, Number(o.strip), Number(o.bus), o.set))
			},
		},
		strip_fader: {
			name: 'Strip: fader level',
			description: "Sets a strip's fader on a bus, in dB (-144.5 is -inf, +6 the top), as the web UI's fader does",
			options: [stripOption(faderStrips), busOption(busses), dbOption(LEVEL)],
			callback: async ({ options: o }) => {
				await self.write((m) => stripFader(m, Number(o.strip), Number(o.bus), { to: Number(o.db) }))
			},
		},
		strip_fader_step: {
			name: 'Strip: fader up or down',
			description: "Moves a strip's fader on a bus by a number of dB (negative for down), within -inf to +6 dB",
			options: [stripOption(faderStrips), busOption(busses), dbOption(LEVEL_STEP)],
			callback: async ({ options: o }) => {
				await self.write((m) => stripFader(m, Number(o.strip), Number(o.bus), { by: Number(o.db) }))
			},
		},
		strip_pan: {
			name: 'Strip: pan',
			description:
				"Pans a strip, -100 (left) to 100 (right), as the web UI's pan control does. Only on buses whose pan isn't linked to the mix",
			options: [
				stripOption(panStrips),
				busOption(panBusses),
				panOption({ label: 'Pan (-100 left, 0 centre, 100 right)', default: 0, min: -100, max: 100 }),
			],
			callback: async ({ options: o }) => {
				await self.write((m) => stripPan(m, Number(o.strip), Number(o.bus), { to: Number(o.pan) }))
			},
		},
		strip_pan_step: {
			name: 'Strip: pan left or right',
			description: "Moves a strip's pan by a step (negative is to the left), within -100 to 100",
			options: [
				stripOption(panStrips),
				busOption(panBusses),
				panOption({ label: 'Step (negative is left)', default: 10, min: -200, max: 200 }),
			],
			callback: async ({ options: o }) => {
				await self.write((m) => stripPan(m, Number(o.strip), Number(o.bus), { by: Number(o.pan) }))
			},
		},
		bus_master: {
			name: 'Bus: master level',
			description: "Sets a bus's master fader, in dB (-144.5 is -inf, +6 the top)",
			options: [busOption(busses), dbOption(LEVEL)],
			callback: async ({ options: o }) => {
				await self.write((m) => busMaster(m, Number(o.bus), { to: Number(o.db) }))
			},
		},
		bus_master_step: {
			name: 'Bus: master up or down',
			description: "Moves a bus's master fader by a number of dB (negative for down), within -inf to +6 dB",
			options: [busOption(busses), dbOption(LEVEL_STEP)],
			callback: async ({ options: o }) => {
				await self.write((m) => busMaster(m, Number(o.bus), { by: Number(o.db) }))
			},
		},
		bus_mute: {
			name: 'Bus: mute',
			description: 'Mutes or unmutes a bus. The MIXER bus mute is the main mute in the web UI',
			options: [busOption(busses), onOffOption('Mute')],
			callback: async ({ options: o }) => {
				await self.write((m) => busButton(m, Number(o.bus), 'mute', o.set))
			},
		},
		bus_dim: {
			name: 'Bus: dim',
			description: 'Dims a monitor bus (MIXER, MIXER-ALT, or a cue bus following the mix)',
			options: [busOption(monitorBusses), onOffOption('Dim')],
			callback: async ({ options: o }) => {
				await self.write((m) => busButton(m, Number(o.bus), 'dim', o.set))
			},
		},
		bus_mono: {
			name: 'Bus: mono',
			description: "Switches a monitor bus to mono (the web UI's Mono button)",
			options: [busOption(monitorBusses), onOffOption('Mono')],
			callback: async ({ options: o }) => {
				await self.write((m) => busButton(m, Number(o.bus), 'mono', o.set))
			},
		},
		bus_ref: {
			name: 'Bus: reference level',
			description: "Puts a bus's master at its reference level, as double-clicking the master fader does",
			options: [busOption(busses)],
			callback: async ({ options: o }) => {
				await self.write((m) => busRef(m, Number(o.bus)))
			},
		},
		preamp_mode: {
			name: 'Preamp: input type',
			description: 'Sets a preamp to mic, line or instrument, where it has that input',
			options: [
				preampOption(preamps),
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Input type',
					choices: INPUT_MODES.map((label, id) => ({ id, label })),
					default: 0,
				},
			],
			callback: async ({ options: o }) => {
				await self.write((m) => preampMode(m, Number(o.preamp), Number(o.mode)))
			},
		},
		preamp_gain: {
			name: 'Preamp: gain',
			description:
				"Sets a preamp's gain for its current input type, in dB, rounded to 0.5 dB like the Anubis's gain entry and kept in the preamp's range",
			options: [
				preampOption(preamps),
				{ type: 'number', id: 'db', label: 'Gain (dB)', default: 0, min: -100, max: 100, step: 0.5 },
			],
			callback: async ({ options: o }) => {
				await self.write((m) => preampGain(m, Number(o.preamp), { to: Number(o.db) }))
			},
		},
		preamp_gain_step: {
			name: 'Preamp: gain up or down',
			description: "Moves a preamp's gain by a number of dB (negative for down), within the preamp's range",
			options: [
				preampOption(preamps),
				{ type: 'number', id: 'db', label: 'Step (dB)', default: 1, min: -100, max: 100, step: 0.1 },
			],
			callback: async ({ options: o }) => {
				await self.write((m) => preampGain(m, Number(o.preamp), { by: Number(o.db) }))
			},
		},
		preamp_48v: {
			...preampSwitchAction('phantom', 'Preamp: 48 V', '48 V', preampsWith('48V')),
			description: 'Phantom power, on preamps that have it, when set to Mic',
		},
		preamp_phase: preampSwitchAction('phase', 'Preamp: phase invert', 'Phase invert', preampsWith('phase')),
		preamp_cut: preampSwitchAction('cut', 'Preamp: cut', 'Cut', preampsWith('cut')),
		preamp_lock: {
			...preampSwitchAction('lock', 'Preamp: lock', 'Lock', preampsWith('lock')),
			description:
				"Locks a preamp's settings, as its lock button does; a locked preamp refuses every other preamp action",
		},
		preamp_lowcut: {
			name: 'Preamp: low cut',
			description: "Turns a preamp's low cut filter on or off, at the frequency the preamp offers",
			options: [preampOption(preampsWith('lowCut')), onOffOption('Low cut')],
			callback: async ({ options: o }) => {
				await self.write((m) => preampLowCut(m, Number(o.preamp), o.set))
			},
		},
		preamp_pad: {
			name: 'Preamp: pad / lift',
			description: "Sets a mic preamp's pad/lift selector, on preamps that have it",
			options: [
				preampOption(preampsWith('pad')),
				{ type: 'dropdown', id: 'pad', label: 'Setting', choices: PAD_MODES, default: 'off' },
			],
			callback: async ({ options: o }) => {
				await self.write((m) => preampPad(m, Number(o.preamp), o.pad))
			},
		},
	})
}
