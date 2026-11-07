import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { busChoices, stripChoices } from './feedbacks.js'
import { type OnOff, stripFader, stripMute, stripSolo } from './writes.js'

type StripButtonOptions = { strip: number; bus: number; set: OnOff }
type StripLevelOptions = { strip: number; bus: number; db: number }

export type ActionsSchema = {
	refresh: {
		options: Record<string, never>
	}
	strip_mute: {
		options: StripButtonOptions
	}
	strip_solo: {
		options: StripButtonOptions
	}
	strip_fader: {
		options: StripLevelOptions
	}
	strip_fader_step: {
		options: StripLevelOptions
	}
}

const ON_OFF: DropdownChoice<OnOff>[] = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
]

export function UpdateActions(self: ModuleInstance): void {
	const model = self.anubis?.model ?? null
	// Talk and cue return strips have no mute or solo buttons
	const strips = stripChoices(model).filter((c) => model?.strip(c.id)?.hasMuteSolo)
	// Talk, monitor return and cue return strips have no fader
	const faderStrips = stripChoices(model).filter((c) => model?.strip(c.id)?.hasFader)
	const busses = busChoices(model)
	const stripLevelOptions = (db: { label: string; default: number; min: number; max: number }) =>
		[
			{ type: 'dropdown', id: 'strip', label: 'Strip', choices: faderStrips, default: faderStrips[0]?.id ?? 0 },
			{ type: 'dropdown', id: 'bus', label: 'Bus', choices: busses, default: 0 },
			{ type: 'number', id: 'db', step: 0.1, ...db },
		] as const
	const stripButtonOptions = (label: string) =>
		[
			{ type: 'dropdown', id: 'strip', label: 'Strip', choices: strips, default: strips[0]?.id ?? 0 },
			{ type: 'dropdown', id: 'bus', label: 'Bus', choices: busses, default: 0 },
			{ type: 'dropdown', id: 'set', label, choices: ON_OFF, default: 'toggle' },
		] as const

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
			options: [...stripButtonOptions('Mute')],
			callback: async (action) => {
				const { strip, bus, set } = action.options
				await self.write((m) => stripMute(m, Number(strip), Number(bus), set))
			},
		},
		strip_solo: {
			name: 'Strip: solo',
			description: "Solos or unsolos a strip on a bus, as the strip's solo button does",
			options: [...stripButtonOptions('Solo')],
			callback: async (action) => {
				const { strip, bus, set } = action.options
				await self.write((m) => stripSolo(m, Number(strip), Number(bus), set))
			},
		},
		strip_fader: {
			name: 'Strip: fader level',
			description: "Sets a strip's fader on a bus, in dB (-144.5 is -inf, +6 the top), as the web UI's fader does",
			options: [...stripLevelOptions({ label: 'Level (dB)', default: 0, min: -144.5, max: 6 })],
			callback: async (action) => {
				const { strip, bus, db } = action.options
				await self.write((m) => stripFader(m, Number(strip), Number(bus), { to: Number(db) }))
			},
		},
		strip_fader_step: {
			name: 'Strip: fader up or down',
			description: "Moves a strip's fader on a bus by a number of dB (negative for down), within -inf to +6 dB",
			options: [...stripLevelOptions({ label: 'Step (dB)', default: 1, min: -150, max: 150 })],
			callback: async (action) => {
				const { strip, bus, db } = action.options
				await self.write((m) => stripFader(m, Number(strip), Number(bus), { by: Number(db) }))
			},
		},
	})
}
