// The fixed list of changes the module can make to the Anubis. Each is a
// message the Anubis's web UI sends, built the way it builds it (see
// the notes decoded from it), and only after checking that
// what it addresses exists in the current state and that the web UI would
// let the user do it. There is no general "set a value".

import { type AnubisModel, MIXER_PATH } from './model.js'
import type { JsonObject } from './tree.js'

export class WriteRefused extends Error {}

export interface Write {
	/** What it does, for the log */
	description: string
	/** The control it changes: one write per control every 50 ms, latest wins */
	control: string
	path: string
	value: JsonObject
	/** Whether the Anubis's state shows the change */
	confirmed(model: AnubisModel): boolean
}

export type OnOff = 'toggle' | 'on' | 'off'

const SEND_PATH =
	/^\$\._oem_ui_process_engine\.music\.mixer\.strips\[\?\(@\.id==\d+\)\]\[0\]\.sends\[\?\(@\.id==\d+\)\]\[0\]$/

// Every path and field a write may carry, checked again just before it is
// sent: one field, of the right type.
const ALLOWED: { path: RegExp; fields: Record<string, 'boolean'> }[] = [
	{ path: SEND_PATH, fields: { mute: 'boolean', link_mute: 'boolean' } },
]

/** True when a message is one of the fixed list's */
export function isAllowedWrite(data: { path: string; value: JsonObject }): boolean {
	const keys = Object.keys(data.value)
	if (keys.length !== 1) return false
	const field = keys[0]
	return ALLOWED.some(
		(a) => a.path.test(data.path) && field in a.fields && typeof data.value[field] === a.fields[field],
	)
}

function id(value: number, what: string): number {
	if (!Number.isInteger(value) || value < 0) throw new WriteRefused(`${what} ${String(value)} isn't an id`)
	return value
}

function sendPath(strip: number, bus: number): string {
	return `${MIXER_PATH}.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`
}

/**
 * Mute or unmute a strip on one bus, as the strip's mute button does. A
 * linked pair shown as one strip is written once, to its first strip, with
 * `link_mute`. Returns null when the strip is already in that state.
 */
export function stripMute(model: AnubisModel, stripId: number, busId: number, set: OnOff): Write | null {
	id(stripId, 'strip')
	id(busId, 'bus')
	const strip = model.strip(stripId)
	if (!strip) throw new WriteRefused(`There is no strip ${stripId} in the mixer`)
	if (strip.collapsedLink && !strip.isPairLeader) {
		throw new WriteRefused(`Strip ${stripId} (${strip.name}) is the hidden half of a linked pair`)
	}
	const bus = model.bus(busId)
	const send = strip.sends.get(busId)
	if (!bus || !send) throw new WriteRefused(`There is no bus ${busId} for strip ${stripId} (${strip.name})`)
	// The web UI disables mute (and solo) while the strip's input isn't connected.
	if (!strip.connected) throw new WriteRefused(`${strip.name}'s input isn't connected, so it can't be muted`)

	const mute = set === 'toggle' ? !send.mute : set === 'on'
	if (mute === send.mute) return null
	const partner = strip.partnerId
	return {
		description: `${mute ? 'Mute' : 'Unmute'} ${strip.name}${partner === null ? '' : ' (linked pair)'} on ${bus.name}`,
		control: `strip ${stripId} bus ${busId} mute`,
		path: sendPath(stripId, busId),
		value: partner === null ? { mute } : { link_mute: mute },
		confirmed: (m) =>
			m.strip(stripId)?.sends.get(busId)?.mute === mute &&
			(partner === null || m.strip(partner)?.sends.get(busId)?.mute === mute),
	}
}
