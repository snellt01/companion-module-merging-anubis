import type ModuleInstance from './main.js'

// Presets come with the write actions.
export function UpdatePresets(self: ModuleInstance): void {
	self.setPresetDefinitions([], {})
}
