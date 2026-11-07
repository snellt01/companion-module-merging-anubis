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
	talkInput,
	talkToAll,
	talkToCue,
} from './writes.js'
import { DEFAULT_HOLD_MS, type TalkEvent } from './talkback.js'

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
	talk_cue: { options: BusButtonOptions }
	talk_all: { options: { set: OnOff } }
	talk_input: { options: { strip: number } }
	talk_cue_button: { options: { bus: number } & TalkButtonOptions }
	talk_all_button: { options: TalkButtonOptions }
}

type TalkButtonOptions = { event: TalkEvent; hold: number }

type PreampSwitchOptions = { preamp: number; set: OnOff }

const PAD_MODES: DropdownChoice<PadMode>[] = [
	{ id: 'lift', label: 'Boost' },
	{ id: 'off', label: 'Off' },
	{ id: 'pad', label: 'Pad' },
]

const ON_OFF: DropdownChoice<OnOff>[] = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
]

const TALK_EVENTS: DropdownChoice<TalkEvent>[] = [
	{ id: 'press', label: 'Pressed' },
	{ id: 'release', label: 'Released' },
]

const TALK_BUTTON = [
	{ type: 'dropdown', id: 'event', label: 'Key', choices: TALK_EVENTS, default: 'press' } as const,
	{
		type: 'number',
		id: 'hold',
		label: 'Held at least this long, talk only while held (ms)',
		default: DEFAULT_HOLD_MS,
		min: 100,
		max: 5000,
	} as const,
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
	const talkBusses = busses.filter((b) => model?.bus(b.id)?.hasTalk)
	// Music input and talk mic strips shown on MIXER or MIXER-ALT
	const talkStrips = stripsWhere((id) => {
		const strip = model?.strip(id)
		return strip?.canTalk && [...strip.sends.values()].some((s) => s.visible && model?.bus(s.bus)?.type === 1)
	})
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
			name: 'Preamp: pad / boost',
			description: "Sets a mic preamp's pad/boost selector, on preamps that have it",
			options: [
				preampOption(preampsWith('pad')),
				{ type: 'dropdown', id: 'pad', label: 'Setting', choices: PAD_MODES, default: 'off' },
			],
			callback: async ({ options: o }) => {
				await self.write((m) => preampPad(m, Number(o.preamp), o.pad))
			},
		},
		talk_cue: {
			name: 'Talkback: talk to a cue bus',
			description:
				'Talkback to a cue bus with its own mix, as its TALK button does. For a button that talks while held, use On when pressed and Off when released',
			options: [busOption(talkBusses), onOffOption('Talk')],
			callback: async ({ options: o }) => {
				await self.write((m) => talkToCue(m, Number(o.bus), o.set))
			},
		},
		talk_all: {
			name: 'Talkback: talk to all cue buses',
			description:
				'TALK ALL: every cue bus with its own mix. Toggle turns them all off if any cue bus is being talked to, else all on',
			options: [onOffOption('Talk')],
			callback: async ({ options: o }) => {
				await self.write((m) => talkToAll(m, o.set), { together: true })
			},
		},
		talk_cue_button: {
			name: 'Talkback: TALK key for a cue bus (tap or hold)',
			description:
				'Use when pressed and again when released. A tap turns talkback on, or off when it is on; held, it talks until the key is let go',
			options: [busOption(talkBusses), ...TALK_BUTTON],
			callback: async ({ options: o }) => {
				const busId = Number(o.bus)
				await self.write((m) => {
					const set = self.talkButtons.handle(`bus ${busId}`, o.event, m.bus(busId)?.talking ?? false, o.hold)
					return set ? talkToCue(m, busId, set) : null
				})
			},
		},
		talk_all_button: {
			name: 'Talkback: TALK ALL key (tap or hold)',
			description:
				'Use when pressed and again when released. A tap turns talkback to every cue bus on, or all off when any is on; held, it talks until the key is let go',
			options: [...TALK_BUTTON],
			callback: async ({ options: o }) => {
				await self.write(
					(m) => {
						const talking = m.busses().some((b) => b.type === 2 && b.talking)
						const set = self.talkButtons.handle('all', o.event, talking, o.hold)
						return set ? talkToAll(m, set) : null
					},
					{ together: true },
				)
			},
		},
		talk_input: {
			name: 'Talkback: source',
			description: "Sets the talkback's input, as TALK INPUT in a strip's menu does (TALK is the built-in talk mic)",
			options: [stripOption(talkStrips)],
			callback: async ({ options: o }) => {
				await self.write((m) => talkInput(m, Number(o.strip)))
			},
		},
	})
}
