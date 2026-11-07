import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { type AnubisModel, INPUT_MODES, type Preamp, stripLabel } from './model.js'

type StripOptions = { strip: number; bus: number }
type BusOptions = { bus: number }

export type FeedbacksSchema = {
	strip_mute: { type: 'boolean'; options: StripOptions }
	strip_solo: { type: 'boolean'; options: StripOptions }
	bus_mute: { type: 'boolean'; options: BusOptions }
	bus_dim: { type: 'boolean'; options: BusOptions }
	bus_mono: { type: 'boolean'; options: BusOptions }
	bus_solo: { type: 'boolean'; options: BusOptions }
	preamp_setting: { type: 'boolean'; options: { preamp: number; setting: PreampSetting } }
	preamp_mode: { type: 'boolean'; options: { preamp: number; mode: number } }
}

type PreampSetting = 'phantom' | 'pad' | 'lift' | 'phase' | 'lowCut' | 'cut' | 'lock'
const PREAMP_SETTINGS: DropdownChoice<PreampSetting>[] = [
	{ id: 'phantom', label: '48 V' },
	{ id: 'pad', label: 'Pad' },
	{ id: 'lift', label: 'Lift' },
	{ id: 'phase', label: 'Phase invert' },
	{ id: 'lowCut', label: 'Low cut' },
	{ id: 'cut', label: 'Cut' },
	{ id: 'lock', label: 'Locked' },
]

const RED = 0xcc0000
const YELLOW = 0xffcc00
const ORANGE = 0xff8000
const BLUE = 0x0050c8
const WHITE = 0xffffff
const BLACK = 0x000000

/** Strips for a list: a linked pair shown as one strip is one entry */
export function stripChoices(model: AnubisModel | null): DropdownChoice<number>[] {
	if (!model) return []
	const strips = model.strips()
	return strips
		.filter((s) => s.partnerId === null || s.isPairLeader)
		.map((s) => ({ id: s.id, label: stripLabel(s, strips) }))
}

export function busChoices(model: AnubisModel | null): DropdownChoice<number>[] {
	return model ? model.busses().map((b) => ({ id: b.id, label: b.name })) : []
}

export function preampChoices(model: AnubisModel | null): DropdownChoice<number>[] {
	return model ? model.preamps().map((p) => ({ id: p.inputId, label: p.name })) : []
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const model = (): AnubisModel | null => self.anubis?.model ?? null
	const strips = stripChoices(model())
	const busses = busChoices(model())
	const preamps = preampChoices(model())

	const stripOptions = [
		{ type: 'dropdown', id: 'strip', label: 'Strip', choices: strips, default: strips[0]?.id ?? 0 },
		{ type: 'dropdown', id: 'bus', label: 'Bus', choices: busses, default: 0 },
	] as const
	const busOption = [{ type: 'dropdown', id: 'bus', label: 'Bus', choices: busses, default: 0 }] as const
	const preampOption = {
		type: 'dropdown',
		id: 'preamp',
		label: 'Preamp',
		choices: preamps,
		default: preamps[0]?.id ?? 0,
	} as const

	const send = (o: StripOptions) => model()?.strip(Number(o.strip))?.sends.get(Number(o.bus))
	const bus = (o: BusOptions) => model()?.bus(Number(o.bus))
	const preamp = (id: number): Preamp | undefined => model()?.preamp(Number(id))

	const definitions: CompanionFeedbackDefinitions<FeedbacksSchema> = {
		strip_mute: {
			type: 'boolean',
			name: 'Strip: muted',
			description: 'A strip is muted on a bus',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [...stripOptions],
			callback: (fb) => send(fb.options)?.mute ?? false,
		},
		strip_solo: {
			type: 'boolean',
			name: 'Strip: solo',
			description: 'A strip is soloed on a bus',
			defaultStyle: { bgcolor: YELLOW, color: BLACK },
			options: [...stripOptions],
			callback: (fb) => send(fb.options)?.solo ?? false,
		},
		bus_mute: {
			type: 'boolean',
			name: 'Bus: muted',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [...busOption],
			callback: (fb) => bus(fb.options)?.mute ?? false,
		},
		bus_dim: {
			type: 'boolean',
			name: 'Bus: dimmed',
			defaultStyle: { bgcolor: ORANGE, color: BLACK },
			options: [...busOption],
			callback: (fb) => bus(fb.options)?.dim ?? false,
		},
		bus_mono: {
			type: 'boolean',
			name: 'Bus: mono',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [...busOption],
			callback: (fb) => bus(fb.options)?.mono ?? false,
		},
		bus_solo: {
			type: 'boolean',
			name: 'Bus: a strip is soloed',
			defaultStyle: { bgcolor: YELLOW, color: BLACK },
			options: [...busOption],
			callback: (fb) => bus(fb.options)?.hasSolo ?? false,
		},
		preamp_setting: {
			type: 'boolean',
			name: 'Preamp: setting is on',
			description: '48 V, pad, lift, phase, low cut, cut or lock is on',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				preampOption,
				{ type: 'dropdown', id: 'setting', label: 'Setting', choices: PREAMP_SETTINGS, default: 'phantom' },
			],
			callback: (fb) => preamp(fb.options.preamp)?.[fb.options.setting] ?? false,
		},
		preamp_mode: {
			type: 'boolean',
			name: 'Preamp: input type',
			description: 'The preamp is set to mic, line or instrument',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				preampOption,
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Input type',
					choices: INPUT_MODES.map((label, id) => ({ id, label })),
					default: 0,
				},
			],
			callback: (fb) => preamp(fb.options.preamp)?.mode === Number(fb.options.mode),
		},
	}
	self.setFeedbackDefinitions(definitions)
}
