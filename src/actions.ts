import type ModuleInstance from './main.js'

export type ActionsSchema = {
	refresh: {
		options: Record<string, never>
	}
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		refresh: {
			name: 'Read the Anubis state again',
			description: 'Reads the whole state from the Anubis. Sends nothing to the mixer.',
			options: [],
			callback: async () => {
				await self.anubis?.refresh()
			},
		},
	})
}
