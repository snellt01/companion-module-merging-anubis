// Reads what the module needs out of the Anubis's state tree. Everything is
// addressed by the tree's own ids (strip, bus, input), never by on-screen
// position, which changes when strips are moved.

import type { Json, JsonObject } from './tree.js'

export const MIXER_PATH = '$._oem_ui_process_engine.music.mixer'
export const MUSIC_MISSION = 3
export const TESTED_FIRMWARE = '2.0.0-RL-26Q2-20260605.2+9abce1f5'
// Levels are integer tenths of a dB; this is the bottom of the range (-inf).
export const GAIN_MIN = -1445
export const GAIN_MAX = 60

export interface Send {
	bus: number
	/** This strip's own level */
	gain: number
	/** What its fader shows: `link_gain` for a collapsed linked pair (whose two sides can differ), else `gain` */
	faderGain: number
	pan: number
	mute: boolean
	solo: boolean
	/** The strip is shown on this bus */
	visible: boolean
}

// Strip types (`strips[].type`) the web UI gives no mute or solo buttons:
// talk mics (local, peered) get none, cue returns get M > C, TALK, C > M.
const NO_MUTE_SOLO_TYPES = new Set([2, 3, 6])
// Strip types the web UI draws a fader on: music input, DAW input, effect return.
const FADER_TYPES = new Set([1, 4, 7])

export interface Strip {
	id: number
	name: string
	type: number
	/** Its group, or -1 */
	groupId: number
	/** The web UI shows mute and solo buttons on strips of this type */
	hasMuteSolo: boolean
	/** The web UI shows a fader on strips of this type */
	hasFader: boolean
	/** For a linked pair shown as one strip: the other strip's id */
	partnerId: number | null
	/** Shown as one strip with its partner, and this is the one shown (the lower id, as in the web UI) */
	isPairLeader: boolean
	/** Linked and collapsed, as the web UI tests it (whether or not the partner is in the mixer) */
	collapsedLink: boolean
	connected: boolean
	sends: Map<number, Send>
}

export interface Bus {
	id: number
	name: string
	/** 1 monitor, 2 cue, 3 effect, 4 insert (send) */
	type: number
	masterGain: number
	mute: boolean
	dim: boolean
	mono: boolean
	hasSolo: boolean
	/**
	 * A monitor bus, or a cue bus following the mix (cue mode 1): the web
	 * UI gives these Dim and Mono buttons, and pan on them is never linked
	 */
	monitors: boolean
	/** Strip pan can be changed on this bus (it isn't linked to the mix's) */
	panEditable: boolean
}

export const INPUT_MODES = ['Mic', 'Line', 'Instrument'] as const
/** Each input mode's gain field, and the capability flag that says the preamp has the mode */
export const GAIN_FIELDS = ['micGain', 'lineGain', 'instrumentGain'] as const
export const MODE_CAPABILITIES = ['mic', 'line', 'instrument'] as const

export interface Preamp {
	/** The input (and strip) this preamp feeds */
	inputId: number
	name: string
	moduleId: number
	channel: number
	mode: number
	/** No input mode reported: the web UI shows "Off Line" and disables the preamp */
	offline: boolean
	/** The gain field for the current mode (micGain, lineGain or instrumentGain) */
	gainField: string
	gain: number
	phantom: boolean
	pad: boolean
	lift: boolean
	phase: boolean
	cut: boolean
	lowCut: boolean
	lowCutFreq: number
	lock: boolean
	capabilities: JsonObject
}

function obj(v: Json | undefined): JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
}
function arr(v: Json | undefined): Json[] {
	return Array.isArray(v) ? v : []
}
function num(v: Json | undefined, fallback = 0): number {
	return typeof v === 'number' ? v : fallback
}
function bool(v: Json | undefined): boolean {
	return v === true
}
function str(v: Json | undefined): string {
	return typeof v === 'string' ? v : ''
}

export class AnubisModel {
	constructor(readonly tree: JsonObject) {}

	private get mixer(): JsonObject {
		return obj(obj(obj(obj(this.tree._oem_ui_process_engine).music)).mixer)
	}

	get deviceName(): string {
		return str(obj(this.tree.identity).name)
	}

	get mission(): number {
		return num(obj(this.tree.identity).anubis_mission, -1)
	}

	get firmware(): string {
		return str(this.tree._firmware_version_long)
	}

	get identify(): boolean {
		return bool(obj(this.tree.identity).identify)
	}

	private inputs(): Map<number, JsonObject> {
		return new Map(arr(this.mixer.inputs).map((i) => [num(obj(i).id, -1), obj(i)]))
	}

	/** The strips shown in the mixer, in on-screen order */
	strips(): Strip[] {
		const inputs = this.inputs()
		const byId = new Map(arr(this.mixer.strips).map((s) => [num(obj(s).id, -1), obj(s)]))
		const shown = arr(this.mixer.displayed_strips)
			.map(obj)
			.sort((a, b) => num(a.display_number) - num(b.display_number))
			.map((d) => num(d.id, -1))
		const result: Strip[] = []
		for (const id of shown) {
			const s = byId.get(id)
			if (!s) continue
			const input = inputs.get(num(s.input_id, -1)) ?? {}
			const linked = num(input.linked_input_id, -1)
			const collapsedLink = linked !== -1 && bool(input.collapsed_link)
			const partnerId = collapsedLink && byId.has(linked) ? linked : null
			const type = num(s.type, -1)
			result.push({
				id,
				name: str(s.name),
				type,
				groupId: num(s.group_id, -1),
				hasMuteSolo: !NO_MUTE_SOLO_TYPES.has(type),
				hasFader: FADER_TYPES.has(type),
				partnerId,
				isPairLeader: partnerId !== null && id < partnerId,
				collapsedLink,
				connected: bool(input.connected) && num(input.connection_state) === 1,
				sends: new Map(
					arr(s.sends).map((raw) => {
						const send = obj(raw)
						const bus = num(send.id, -1)
						const gain = num(send.gain, GAIN_MIN)
						return [
							bus,
							{
								bus,
								gain,
								faderGain: collapsedLink ? num(send.link_gain, gain) : gain,
								pan: num(send.pan),
								mute: bool(send.mute),
								solo: bool(send.solo),
								visible: bool(send.visible),
							},
						]
					}),
				),
			})
		}
		return result
	}

	strip(id: number): Strip | undefined {
		return this.strips().find((s) => s.id === id)
	}

	/**
	 * Whether a group is collapsed on a bus (its strips are then shown as
	 * one group strip there). Null when the group isn't in the state.
	 */
	groupCollapsedOn(groupId: number, busId: number): boolean | null {
		const group = arr(this.mixer.groups)
			.map(obj)
			.find((g) => num(g.id, -1) === groupId)
		const collapsed = group ? arr(group.collapsed_on_bus)[busId] : undefined
		return typeof collapsed === 'boolean' ? collapsed : null
	}

	/**
	 * The level a bus's REF puts its master at (mixer settings, tenths of a
	 * dB). A bus's own `ref` field is only a trigger: the Anubis resets it
	 * without saying so, so it says nothing about the bus.
	 */
	get refLevel(): number | null {
		const level = obj(this.mixer.settings).ref_level
		return typeof level === 'number' ? level : null
	}

	busses(): Bus[] {
		return arr(this.mixer.busses)
			.map(obj)
			.filter((b) => b.enabled !== false)
			.map((b) => {
				const type = num(b.type, -1)
				const monitors = type === 1 || (type === 2 && num(b.cue_mode, -1) === 1)
				return {
					id: num(b.id, -1),
					name: str(b.name),
					type,
					masterGain: num(b.master_gain, GAIN_MIN),
					mute: bool(b.mute),
					dim: bool(b.dim),
					mono: bool(b.downmix),
					hasSolo: bool(b.has_solo),
					monitors,
					panEditable: monitors || !bool(b.pan_linked),
				}
			})
	}

	bus(id: number): Bus | undefined {
		return this.busses().find((b) => b.id === id)
	}

	/** Preamps of the shown strips' inputs, where the input has one */
	preamps(): Preamp[] {
		const inputs = this.inputs()
		const modules = new Map(arr(this.tree._modules).map((m) => [num(obj(m).id, -1), obj(m)]))
		const result: Preamp[] = []
		for (const strip of this.strips()) {
			const input = inputs.get(strip.id)
			if (!input) continue
			const moduleId = num(input.module_id, -1)
			const channel = num(input.channel_id, -1)
			const ins = obj(obj(modules.get(moduleId)?.custom).ins)
			const ch = obj(arr(ins.channels)[channel])
			if (Object.keys(ch).length === 0) continue
			const offline = typeof ch.inputMode !== 'number'
			const mode = num(ch.inputMode)
			const gainField = GAIN_FIELDS[mode] ?? 'micGain'
			result.push({
				inputId: strip.id,
				name: strip.name,
				moduleId,
				channel,
				mode,
				offline,
				gainField,
				gain: num(ch[gainField]),
				phantom: bool(ch.m48V),
				pad: bool(ch.pad),
				lift: bool(ch.lift),
				phase: bool(ch.phase),
				cut: bool(ch.cut),
				lowCut: bool(ch.lowCut),
				lowCutFreq: num(ch.lowCut_freq, -1),
				lock: bool(ch.lock),
				capabilities: obj(obj(ins.capabilities).channel),
			})
		}
		return result
	}

	preamp(inputId: number): Preamp | undefined {
		return this.preamps().find((p) => p.inputId === inputId)
	}
}

/** Tenths of a dB as text: "-12.5", "+6.0", "-inf" */
export function formatGain(tenths: number): string {
	if (tenths <= GAIN_MIN) return '-inf'
	const db = (tenths / 10).toFixed(1)
	return tenths > 0 ? `+${db}` : db
}

/** A strip's name for lists: a linked pair shown as one strip gets both names */
export function stripLabel(strip: Strip, strips: Strip[]): string {
	if (strip.partnerId === null) return strip.name
	const partner = strips.find((s) => s.id === strip.partnerId)
	return partner ? `${strip.name} + ${partner.name}` : strip.name
}
