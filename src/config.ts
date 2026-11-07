import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Merging Anubis',
			value:
				'Connects to the Anubis web UI (port 80). The Anubis must be in the Music mission. ' +
				'This version only reads the Anubis; it sends no changes.',
			width: 12,
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Anubis IP address or hostname',
			width: 8,
			regex: Regex.HOSTNAME,
		},
	]
}
