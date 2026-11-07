import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { busChoices, stripChoices } from './feedbacks.js'
import { type OnOff, stripMute, stripSolo } from './writes.js'

type StripButtonOptions = { strip: number; bus: number; set: OnOff }

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
	const busses = busChoices(model)
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
	})
}
