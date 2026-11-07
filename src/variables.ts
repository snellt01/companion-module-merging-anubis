import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { type AnubisModel, formatGain, INPUT_MODES } from './model.js'

export type VariablesSchema = CompanionVariableValues

// strip_<id>_* are for the MIXER bus. Level and pan on the other buses are
// strip_<id>_bus<B>_*, for each bus the strip is shown on (as the web UI
// draws it); mute and solo there are in the feedbacks.
const MIXER_BUS = 0

/** The sends, other than MIXER's, that get their own variables */
function otherSends(model: AnubisModel, strip: ReturnType<AnubisModel['strips']>[number]) {
	return [...strip.sends.values()].filter((send) => send.bus !== MIXER_BUS && send.visible && model.bus(send.bus))
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(variableDefinitions(self.anubis?.model ?? null))
}

export function variableDefinitions(model: AnubisModel | null): CompanionVariableDefinitions<VariablesSchema> {
	const defs: CompanionVariableDefinitions<VariablesSchema> = {
		device_name: { name: 'Anubis name' },
		firmware: { name: 'Anubis firmware version' },
	}
	if (!model) return defs
	for (const s of model.strips()) {
		defs[`strip_${s.id}_name`] = { name: `${s.name}: name` }
		defs[`strip_${s.id}_gain`] = { name: `${s.name}: level on MIXER (dB)` }
		defs[`strip_${s.id}_mute`] = { name: `${s.name}: muted on MIXER` }
		defs[`strip_${s.id}_solo`] = { name: `${s.name}: solo on MIXER` }
		defs[`strip_${s.id}_pan`] = { name: `${s.name}: pan on MIXER (-100 left to 100 right)` }
		for (const send of otherSends(model, s)) {
			const bus = model.bus(send.bus)!.name
			defs[`strip_${s.id}_bus${send.bus}_gain`] = { name: `${s.name}: level on ${bus} (dB)` }
			defs[`strip_${s.id}_bus${send.bus}_pan`] = { name: `${s.name}: pan on ${bus}` }
		}
	}
	for (const b of model.busses()) {
		defs[`bus_${b.id}_name`] = { name: `${b.name}: name` }
		defs[`bus_${b.id}_gain`] = { name: `${b.name}: master level (dB)` }
		defs[`bus_${b.id}_mute`] = { name: `${b.name}: muted` }
		defs[`bus_${b.id}_dim`] = { name: `${b.name}: dimmed` }
		defs[`bus_${b.id}_mono`] = { name: `${b.name}: mono` }
		if (b.hasTalk) defs[`bus_${b.id}_talk`] = { name: `${b.name}: talkback on` }
	}
	defs.talk_input = { name: 'Talkback source (strip name)' }
	defs.talk_input_id = { name: 'Talkback source (strip id; 998 is the built-in talk mic)' }
	for (const p of model.preamps()) {
		const caps = p.capabilities
		defs[`preamp_${p.inputId}_mode`] = { name: `${p.name} preamp: input type` }
		defs[`preamp_${p.inputId}_gain`] = { name: `${p.name} preamp: gain (dB)` }
		if (caps['48V'] === true) defs[`preamp_${p.inputId}_48v`] = { name: `${p.name} preamp: 48 V` }
		if (caps.pad === true) defs[`preamp_${p.inputId}_pad`] = { name: `${p.name} preamp: pad` }
		if (caps.lift === true) defs[`preamp_${p.inputId}_lift`] = { name: `${p.name} preamp: boost` }
		defs[`preamp_${p.inputId}_phase`] = { name: `${p.name} preamp: phase invert` }
		defs[`preamp_${p.inputId}_lowcut`] = { name: `${p.name} preamp: low cut` }
		defs[`preamp_${p.inputId}_cut`] = { name: `${p.name} preamp: cut` }
		defs[`preamp_${p.inputId}_lock`] = { name: `${p.name} preamp: locked` }
	}
	return defs
}

export function variableValues(model: AnubisModel): CompanionVariableValues {
	const values: CompanionVariableValues = {
		device_name: model.deviceName,
		firmware: model.firmware,
	}
	for (const s of model.strips()) {
		const send = s.sends.get(MIXER_BUS)
		values[`strip_${s.id}_name`] = s.name
		values[`strip_${s.id}_gain`] = send ? formatGain(send.faderGain) : ''
		values[`strip_${s.id}_mute`] = send?.mute ?? false
		values[`strip_${s.id}_solo`] = send?.solo ?? false
		values[`strip_${s.id}_pan`] = send?.pan ?? 0
		for (const other of otherSends(model, s)) {
			values[`strip_${s.id}_bus${other.bus}_gain`] = formatGain(other.faderGain)
			values[`strip_${s.id}_bus${other.bus}_pan`] = other.pan
		}
	}
	for (const b of model.busses()) {
		values[`bus_${b.id}_name`] = b.name
		values[`bus_${b.id}_gain`] = formatGain(b.masterGain)
		values[`bus_${b.id}_mute`] = b.mute
		values[`bus_${b.id}_dim`] = b.dim
		values[`bus_${b.id}_mono`] = b.mono
		if (b.hasTalk) values[`bus_${b.id}_talk`] = b.talking
	}
	const talk = model.talkInput
	values.talk_input = talk === null ? '' : (model.strip(talk)?.name ?? String(talk))
	values.talk_input_id = talk ?? ''
	for (const p of model.preamps()) {
		values[`preamp_${p.inputId}_mode`] = INPUT_MODES[p.mode] ?? String(p.mode)
		values[`preamp_${p.inputId}_gain`] = (p.gain / 10).toFixed(1)
		if (p.capabilities['48V'] === true) values[`preamp_${p.inputId}_48v`] = p.phantom
		if (p.capabilities.pad === true) values[`preamp_${p.inputId}_pad`] = p.pad
		if (p.capabilities.lift === true) values[`preamp_${p.inputId}_lift`] = p.lift
		values[`preamp_${p.inputId}_phase`] = p.phase
		values[`preamp_${p.inputId}_lowcut`] = p.lowCut
		values[`preamp_${p.inputId}_cut`] = p.cut
		values[`preamp_${p.inputId}_lock`] = p.lock
	}
	return values
}
