// The fixed list of changes the module can make to the Anubis. Each is a
// message the Anubis's web UI sends, built the way it builds it (see
// the notes decoded from it), and only after checking that
// what it addresses exists in the current state and that the web UI would
// let the user do it. There is no general "set a value".

import {
	type AnubisModel,
	type Bus,
	formatGain,
	GAIN_MAX,
	GAIN_MIN,
	INPUT_MODES,
	MIXER_PATH,
	MODE_CAPABILITIES,
	type Preamp,
	type Send,
	type Strip,
} from './model.js'
import type { Json, JsonObject } from './tree.js'

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
const BUS_PATH = /^\$\._oem_ui_process_engine\.music\.mixer\.busses\[\?\(@\.id==\d+\)\]\[0\]$/
const PREAMP_PATH = /^\$\._modules\[\?\(@\.id==\d+\)\]\[0\]\.custom\.ins\.channels\[\d+\]$/

export const PAN_MIN = -100
export const PAN_MAX = 100

type FieldCheck = (value: Json) => boolean
const isBool: FieldCheck = (v) => typeof v === 'boolean'
const isTrue: FieldCheck = (v) => v === true
const isIntIn =
	(min: number, max: number): FieldCheck =>
	(v) =>
		Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const isLevel = isIntIn(GAIN_MIN, GAIN_MAX)

// Every path and field a write may carry, checked again just before it is
// sent: one field, of the right type and range.
const ALLOWED: { path: RegExp; fields: Record<string, FieldCheck> }[] = [
	{
		path: SEND_PATH,
		fields: {
			mute: isBool,
			link_mute: isBool,
			solo: isBool,
			link_solo: isBool,
			gain: isLevel,
			link_gain: isLevel,
			pan: isIntIn(PAN_MIN, PAN_MAX),
		},
	},
	{
		path: BUS_PATH,
		fields: {
			master_gain: isLevel,
			mute: isBool,
			dim: isBool,
			downmix: isBool,
			// The web UI only ever sends ref: true
			ref: isTrue,
		},
	},
	{
		path: PREAMP_PATH,
		fields: {
			inputMode: isIntIn(0, 2),
			// A sanity bound: the builder keeps to the preamp's own range (0…660 here)
			micGain: isIntIn(-1000, 1000),
			lineGain: isIntIn(-1000, 1000),
			instrumentGain: isIntIn(-1000, 1000),
			m48V: isBool,
			pad: isBool,
			lift: isBool,
			phase: isBool,
			cut: isBool,
			lowCut: isBool,
			lowCut_freq: isIntIn(1, 20000),
			lock: isBool,
		},
	},
]

/** True when a message is one of the fixed list's */
export function isAllowedWrite(data: { path: string; value: JsonObject }): boolean {
	const keys = Object.keys(data.value)
	if (keys.length !== 1) return false
	const field = keys[0]
	return ALLOWED.some(
		(a) => a.path.test(data.path) && Object.hasOwn(a.fields, field) && a.fields[field](data.value[field]),
	)
}

function id(value: number, what: string): number {
	if (!Number.isInteger(value) || value < 0) throw new WriteRefused(`${what} ${String(value)} isn't an id`)
	return value
}

function sendPath(strip: number, bus: number): string {
	return `${MIXER_PATH}.strips[?(@.id==${strip})][0].sends[?(@.id==${bus})][0]`
}

function busPath(bus: number): string {
	return `${MIXER_PATH}.busses[?(@.id==${bus})][0]`
}

/**
 * A strip's send to a bus, where the web UI draws that strip: it is shown on
 * that bus, isn't the hidden half of a linked pair, and isn't inside a group
 * collapsed there. `control` names the control, for the messages.
 */
function shownSend(
	model: AnubisModel,
	stripId: number,
	busId: number,
	control: string,
	hasControl: (strip: Strip) => boolean,
): { strip: Strip; bus: Bus; send: Send; where: string } {
	id(stripId, 'strip')
	id(busId, 'bus')
	const strip = model.strip(stripId)
	if (!strip) throw new WriteRefused(`There is no strip ${stripId} in the mixer`)
	const bus = model.bus(busId)
	const send = strip.sends.get(busId)
	if (!bus || !send) throw new WriteRefused(`There is no bus ${busId} for strip ${stripId} (${strip.name})`)
	const where = `${strip.name} on ${bus.name}`
	if (!hasControl(strip)) throw new WriteRefused(`${strip.name} has no ${control} (strip type ${strip.type})`)
	if (strip.collapsedLink && !strip.isPairLeader) {
		throw new WriteRefused(`Strip ${stripId} (${strip.name}) is the hidden half of a linked pair`)
	}
	if (!send.visible) throw new WriteRefused(`${where}: the strip isn't shown on that bus`)
	if (strip.groupId !== -1 && model.groupCollapsedOn(strip.groupId, busId) !== false) {
		throw new WriteRefused(`${where}: the strip is in a group collapsed on that bus`)
	}
	return { strip, bus, send, where }
}

type StripButton = 'mute' | 'solo'
const BUTTON_WORDS: Record<StripButton, [on: string, off: string]> = {
	mute: ['Mute', 'Unmute'],
	solo: ['Solo', 'Unsolo'],
}

/**
 * A strip's mute or solo button on one bus, as the web UI's button sends
 * it: the button must be on screen (see shownSend; talk and cue return
 * strips have none) and enabled (its input is connected). A linked pair
 * shown as one strip is written once, to its first strip, with
 * `link_<field>`. Returns null when the strip is already in that state.
 */
function stripButton(
	model: AnubisModel,
	stripId: number,
	busId: number,
	button: StripButton,
	set: OnOff,
): Write | null {
	const { strip, bus, send, where } = shownSend(model, stripId, busId, `${button} button`, (s) => s.hasMuteSolo)
	if (!strip.connected) throw new WriteRefused(`${where}: its input isn't connected, so the ${button} button is off`)

	const on = set === 'toggle' ? !send[button] : set === 'on'
	if (on === send[button]) return null
	const partner = strip.partnerId
	return {
		description: `${BUTTON_WORDS[button][on ? 0 : 1]} ${strip.name}${partner === null ? '' : ' (linked pair)'} on ${bus.name}`,
		control: `strip ${stripId} bus ${busId} ${button}`,
		path: sendPath(stripId, busId),
		value: { [partner === null ? button : `link_${button}`]: on },
		confirmed: (m) =>
			m.strip(stripId)?.sends.get(busId)?.[button] === on &&
			(partner === null || m.strip(partner)?.sends.get(busId)?.[button] === on),
	}
}

/** Mute or unmute a strip on one bus, as the strip's mute button does */
export function stripMute(model: AnubisModel, stripId: number, busId: number, set: OnOff): Write | null {
	return stripButton(model, stripId, busId, 'mute', set)
}

/** Solo a strip on one bus, as the strip's solo button does */
export function stripSolo(model: AnubisModel, stripId: number, busId: number, set: OnOff): Write | null {
	return stripButton(model, stripId, busId, 'solo', set)
}

export type LevelChange = { to: number } | { by: number }

/**
 * A level in dB as the web UI's gain entry turns it into the value it
 * sends: tenths of a dB, truncated, kept within −144.5 (−∞) … +6 dB.
 */
export function levelFromDb(db: number): number {
	return clampLevel(levelStep(db))
}

/** dB to whole tenths, truncated */
function levelStep(db: number): number {
	if (!Number.isFinite(db)) throw new WriteRefused(`${String(db)} isn't a level`)
	return Math.trunc(db * 10) || 0 // no -0
}

function clampLevel(tenths: number): number {
	return Math.min(GAIN_MAX, Math.max(GAIN_MIN, tenths))
}

/**
 * Move a strip's fader on one bus, to a level or by a step (in dB), as the
 * web UI's fader does. Strips without a fader (talk, monitor and cue
 * returns) are refused; a linked pair shown as one strip is written once,
 * to its first strip, with `link_gain`. Returns null when the fader is
 * already there.
 */
export function stripFader(model: AnubisModel, stripId: number, busId: number, change: LevelChange): Write | null {
	const { strip, bus, send } = shownSend(model, stripId, busId, 'fader', (s) => s.hasFader)
	const current = send.faderGain
	// A step from −∞ starts at the bottom of the range, as the fader does.
	const gain = 'to' in change ? levelFromDb(change.to) : clampLevel(current + levelStep(change.by))
	if (gain === current) return null
	const pair = strip.partnerId !== null
	return {
		description: `${strip.name}${pair ? ' (linked pair)' : ''} on ${bus.name} to ${formatGain(gain)} dB`,
		control: `strip ${stripId} bus ${busId} gain`,
		path: sendPath(stripId, busId),
		value: { [pair ? 'link_gain' : 'gain']: gain },
		confirmed: (m) => m.strip(stripId)?.sends.get(busId)?.faderGain === gain,
	}
}

export type PanChange = { to: number } | { by: number }

/**
 * Pan a strip on one bus, to a position or by a step, as the web UI's pan
 * control does: whole numbers from −100 (left) to 100 (right). The web UI
 * has no pan for a linked pair shown as one strip, disables pan on a bus
 * whose pan is linked to the mix (all but the monitor buses and a cue bus
 * following the mix), and while the strip's input isn't connected. The
 * Anubis applies a pan to every bus whose pan is linked.
 */
export function stripPan(model: AnubisModel, stripId: number, busId: number, change: PanChange): Write | null {
	const { strip, bus, send, where } = shownSend(model, stripId, busId, 'pan', () => true)
	if (strip.collapsedLink) throw new WriteRefused(`${strip.name} is a linked pair, which has no pan`)
	if (!bus.panEditable) throw new WriteRefused(`${where}: pan on ${bus.name} is linked to the mix`)
	if (!strip.connected) throw new WriteRefused(`${where}: its input isn't connected, so pan is off`)
	const requested = 'to' in change ? change.to : send.pan + change.by
	if (!Number.isFinite(requested)) throw new WriteRefused(`${String(requested)} isn't a pan position`)
	const pan = Math.min(PAN_MAX, Math.max(PAN_MIN, Math.trunc(requested) || 0))
	if (pan === send.pan) return null
	return {
		description: `Pan ${strip.name} on ${bus.name} to ${pan}`,
		control: `strip ${stripId} bus ${busId} pan`,
		path: sendPath(stripId, busId),
		value: { pan },
		confirmed: (m) => m.strip(stripId)?.sends.get(busId)?.pan === pan,
	}
}

function existingBus(model: AnubisModel, busId: number): Bus {
	id(busId, 'bus')
	const bus = model.bus(busId)
	if (!bus) throw new WriteRefused(`There is no bus ${busId} in the mixer`)
	return bus
}

/** Move a bus's master fader, to a level or by a step (in dB), as the web UI's master fader does */
export function busMaster(model: AnubisModel, busId: number, change: LevelChange): Write | null {
	const bus = existingBus(model, busId)
	const gain = 'to' in change ? levelFromDb(change.to) : clampLevel(bus.masterGain + levelStep(change.by))
	if (gain === bus.masterGain) return null
	return {
		description: `${bus.name} master to ${formatGain(gain)} dB`,
		control: `bus ${busId} master_gain`,
		path: busPath(busId),
		value: { master_gain: gain },
		confirmed: (m) => m.bus(busId)?.masterGain === gain,
	}
}

type BusButton = 'mute' | 'dim' | 'mono'
const BUS_FIELDS: Record<BusButton, string> = { mute: 'mute', dim: 'dim', mono: 'downmix' }
const BUS_WORDS: Record<BusButton, [on: string, off: string]> = {
	mute: ['Mute', 'Unmute'],
	dim: ['Dim', 'Undim'],
	mono: ['Mono', 'Stereo'],
}

/**
 * A bus's mute, dim or mono button, as the web UI sends it. Mute is on every
 * bus (the master level menu); Dim and Mono only on the monitor buses and a
 * cue bus following the mix. Returns null when the bus is already in that
 * state.
 */
export function busButton(model: AnubisModel, busId: number, button: BusButton, set: OnOff): Write | null {
	const bus = existingBus(model, busId)
	if (button !== 'mute' && !bus.monitors) throw new WriteRefused(`${bus.name} has no ${button} button`)
	const on = set === 'toggle' ? !bus[button] : set === 'on'
	if (on === bus[button]) return null
	return {
		description: `${BUS_WORDS[button][on ? 0 : 1]} ${bus.name}`,
		control: `bus ${busId} ${button}`,
		path: busPath(busId),
		value: { [BUS_FIELDS[button]]: on },
		confirmed: (m) => m.bus(busId)?.[button] === on,
	}
}

/**
 * Put a bus's master at the reference level (the mixer's `ref_level`), as
 * double-clicking its master fader (or REF in its level menu) does. Sends
 * `ref: true` every time, as the web UI does; the Anubis then moves the
 * master and resets `ref` by itself.
 */
export function busRef(model: AnubisModel, busId: number): Write {
	const bus = existingBus(model, busId)
	const level = model.refLevel
	if (level === null) throw new WriteRefused("The mixer's reference level isn't in the state")
	return {
		description: `${bus.name} master to the reference level (${formatGain(level)} dB)`,
		control: `bus ${busId} ref`,
		path: busPath(busId),
		value: { ref: true },
		confirmed: (m) => m.bus(busId)?.masterGain === m.refLevel,
	}
}

function preampPath(p: Preamp): string {
	return `$._modules[?(@.id==${p.moduleId})][0].custom.ins.channels[${p.channel}]`
}

/** The preamp lists the control in its capabilities and doesn't mark it read-only */
function hasCapability(p: Preamp, capability: string): boolean {
	return p.capabilities[capability] === true && p.capabilities[`${capability}_ro`] !== true
}

/**
 * A preamp the web UI lets you change: it is reporting (not "Off Line")
 * and, for anything but its lock, isn't locked.
 */
function usablePreamp(model: AnubisModel, inputId: number, lockItself = false): Preamp {
	id(inputId, 'preamp')
	const p = model.preamp(inputId)
	if (!p) throw new WriteRefused(`There is no preamp on strip ${inputId}`)
	if (p.offline) throw new WriteRefused(`${p.name}'s preamp is off line`)
	if (p.lock && !lockItself) throw new WriteRefused(`${p.name}'s preamp is locked`)
	return p
}

function preampWrite(
	p: Preamp,
	field: string,
	value: Json,
	description: string,
	confirmed: (p: Preamp) => boolean,
): Write {
	return {
		description: `${p.name} preamp: ${description}`,
		control: `preamp ${p.inputId} ${field}`,
		path: preampPath(p),
		value: { [field]: value },
		confirmed: (m) => {
			const now = m.preamp(p.inputId)
			return now !== undefined && confirmed(now)
		},
	}
}

/** Set a preamp's input type (0 Mic, 1 Line, 2 Instrument), where the preamp has it */
export function preampMode(model: AnubisModel, inputId: number, mode: number): Write | null {
	const p = usablePreamp(model, inputId)
	if (p.capabilities.inputMode_ro === true) throw new WriteRefused(`${p.name}'s input type can't be changed`)
	const capability = MODE_CAPABILITIES[mode]
	if (!Number.isInteger(mode) || !capability || p.capabilities[capability] !== true) {
		throw new WriteRefused(`${p.name}'s preamp has no ${INPUT_MODES[mode] ?? `mode ${mode}`} input`)
	}
	if (mode === p.mode) return null
	return preampWrite(p, 'inputMode', mode, `input ${INPUT_MODES[mode]}`, (now) => now.mode === mode)
}

/**
 * Gain in dB for the gain entry: as the web UI's entry rounds it, to the
 * nearest 0.5 dB, then tenths.
 */
function preampGainFromDb(db: number): number {
	if (!Number.isFinite(db)) throw new WriteRefused(`${String(db)} isn't a gain`)
	let rounded = db
	if (db % 0.5 !== 0) {
		const fraction = db - Math.trunc(db)
		rounded = Math.trunc(db) + (fraction < 0.25 ? 0 : fraction < 0.75 ? 0.5 : 1)
	}
	return Math.round(rounded * 10) || 0
}

/**
 * Set or step a preamp's gain for its current input type, within the range
 * the preamp reports for it (`<mode>Gain_info`). A level is rounded to 0.5
 * dB as the web UI's gain entry does; a step moves by whole tenths.
 */
export function preampGain(model: AnubisModel, inputId: number, change: LevelChange): Write | null {
	const p = usablePreamp(model, inputId)
	const field = p.gainField
	const info = p.capabilities[`${field}_info`]
	const range = typeof info === 'object' && info !== null && !Array.isArray(info) ? info : {}
	if (!hasCapability(p, field) || typeof range.min !== 'number' || typeof range.max !== 'number') {
		throw new WriteRefused(`${p.name}'s preamp has no ${INPUT_MODES[p.mode]} gain to change`)
	}
	const wanted = 'to' in change ? preampGainFromDb(change.to) : p.gain + levelStep(change.by)
	const gain = Math.min(range.max, Math.max(range.min, wanted))
	if (gain === p.gain) return null
	return preampWrite(p, field, gain, `${INPUT_MODES[p.mode]} gain ${(gain / 10).toFixed(1)} dB`, (now) => {
		return now.gainField === field && now.gain === gain
	})
}

export type PreampSwitch = 'phantom' | 'phase' | 'cut' | 'lock'
const SWITCHES: Record<PreampSwitch, { field: string; capability: string; name: string }> = {
	phantom: { field: 'm48V', capability: '48V', name: '48 V' },
	phase: { field: 'phase', capability: 'phase', name: 'phase invert' },
	cut: { field: 'cut', capability: 'cut', name: 'cut' },
	lock: { field: 'lock', capability: 'lock', name: 'lock' },
}

/**
 * A preamp's 48 V, phase, cut or lock button. 48 V only on a preamp that
 * has it, set to Mic; nothing but the lock while it is locked.
 */
export function preampSwitch(model: AnubisModel, inputId: number, which: PreampSwitch, set: OnOff): Write | null {
	const p = usablePreamp(model, inputId, which === 'lock')
	const { field, capability, name } = SWITCHES[which]
	if (!hasCapability(p, capability)) throw new WriteRefused(`${p.name}'s preamp has no ${name}`)
	if (which === 'phantom' && p.mode !== 0) throw new WriteRefused(`${p.name}'s preamp isn't on Mic, so 48 V is off`)
	const on = set === 'toggle' ? !p[which] : set === 'on'
	if (on === p[which]) return null
	return preampWrite(p, field, on, `${name} ${on ? 'on' : 'off'}`, (now) => now[which] === on)
}

export type PadMode = 'lift' | 'off' | 'pad'

/**
 * The preamp's pad/boost selector, sent as the web UI sends it: two writes,
 * `lift` (shown as Boost) then `pad`. Only on a preamp with both, set to Mic.
 */
export function preampPad(model: AnubisModel, inputId: number, mode: PadMode): Write[] | null {
	const p = usablePreamp(model, inputId)
	if (!hasCapability(p, 'lift') || !hasCapability(p, 'pad'))
		throw new WriteRefused(`${p.name}'s preamp has no pad and boost`)
	if (p.mode !== 0) throw new WriteRefused(`${p.name}'s preamp isn't on Mic, so pad and boost are off`)
	const lift = mode === 'lift'
	const pad = mode === 'pad'
	if (p.lift === lift && p.pad === pad) return null
	return [
		preampWrite(p, 'lift', lift, `boost ${lift ? 'on' : 'off'}`, (now) => now.lift === lift),
		preampWrite(p, 'pad', pad, `pad ${pad ? 'on' : 'off'}`, (now) => now.pad === pad),
	]
}

/**
 * The preamp's low cut. Turning it on sends `lowCut: true`, then the
 * frequency (the current one if the preamp offers it, else its first), as
 * the web UI does.
 */
export function preampLowCut(model: AnubisModel, inputId: number, set: OnOff): Write[] | null {
	const p = usablePreamp(model, inputId)
	if (!hasCapability(p, 'lowCut')) throw new WriteRefused(`${p.name}'s preamp has no low cut`)
	const on = set === 'toggle' ? !p.lowCut : set === 'on'
	if (on === p.lowCut) return null
	const off = preampWrite(p, 'lowCut', false, 'low cut off', (now) => !now.lowCut)
	if (!on) return [off]
	const offered = p.capabilities.lowCut_info
	const freqs = Array.isArray(offered)
		? offered.filter((f): f is number => Number.isInteger(f) && (f as number) > 0)
		: []
	if (freqs.length === 0) throw new WriteRefused(`${p.name}'s preamp offers no low cut frequency`)
	const freq = freqs.includes(p.lowCutFreq) ? p.lowCutFreq : freqs[0]
	return [
		preampWrite(p, 'lowCut', true, 'low cut on', (now) => now.lowCut),
		preampWrite(p, 'lowCut_freq', freq, `low cut at ${freq} Hz`, (now) => now.lowCutFreq === freq),
	]
}
