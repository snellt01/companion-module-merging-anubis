import { describe, expect, it } from 'vitest'
import { busChoices, preampChoices, stripChoices } from '../feedbacks.js'
import { AnubisModel, formatGain, TESTED_FIRMWARE } from '../model.js'
import { applyChange } from '../tree.js'
import { variableDefinitions, variableValues } from '../variables.js'
import { fixtureState } from './fake-anubis.js'

const model = () => new AnubisModel(fixtureState())

describe('AnubisModel', () => {
	it('reads the device', () => {
		const m = model()
		expect(m.deviceName).toBe('Anubis')
		expect(m.mission).toBe(3)
		expect(m.firmware).toBe(TESTED_FIRMWARE)
	})

	it('lists the shown strips in on-screen order, with linked pairs', () => {
		const strips = model().strips()
		expect(strips.map((s) => s.id)).toEqual([1000, 1001, 1002, 1003, 1200, 1201, 1210, 4, 5])
		const avio = strips.find((s) => s.id === 1200)
		expect(avio).toMatchObject({ name: 'Stream-L', partnerId: 1201, isPairLeader: true, connected: true })
		expect(strips.find((s) => s.id === 1201)).toMatchObject({ partnerId: 1200, isPairLeader: false })
		expect(strips.find((s) => s.id === 1000)).toMatchObject({ partnerId: null, isPairLeader: false })
		expect(avio?.sends.get(0)).toEqual({
			bus: 0,
			gain: -165,
			faderGain: -165,
			pan: -100,
			mute: false,
			solo: false,
			visible: true,
		})
		expect(avio).toMatchObject({ type: 1, groupId: -1, hasMuteSolo: true, hasFader: true })
		expect(strips.find((s) => s.id === 4)).toMatchObject({
			name: 'CUE1-L',
			type: 6,
			hasMuteSolo: false,
			hasFader: false,
		})
	})

	it("shows a collapsed pair's fader as link_gain, which can differ from its own gain", () => {
		const tree = fixtureState()
		applyChange(tree, `$._oem_ui_process_engine.music.mixer.strips[?(@.id==1200)][0].sends[?(@.id==0)][0]`, {
			gain: -170,
			link_gain: -120,
		})
		const send = new AnubisModel(tree).strip(1200)?.sends.get(0)
		expect(send).toMatchObject({ gain: -170, faderGain: -120 })
		expect(new AnubisModel(tree).strip(1210)?.sends.get(0)?.faderGain).toBe(0)
	})

	it('follows on-screen order when strips move', () => {
		const tree = fixtureState()
		applyChange(tree, '$._oem_ui_process_engine.music.mixer', {
			displayed_strips: [
				{ id: 1200, display_number: 0 },
				{ id: 1000, display_number: 1 },
			],
		})
		expect(new AnubisModel(tree).strips().map((s) => s.id)).toEqual([1200, 1000])
	})

	it('reads the buses', () => {
		const busses = model().busses()
		expect(busses.map((b) => b.name)).toEqual([
			'MIXER',
			'MIXER-ALT',
			'CUE1',
			'CUE2',
			'CUE3',
			'CUE4',
			'CUE5',
			'REVERB',
			'DYNAMICS',
			'SEND1',
			'SEND2',
			'SEND3',
		])
		expect(busses[0]).toMatchObject({ id: 0, mute: false, dim: false, mono: false })
	})

	it('reads the preamps of the shown strips, with what each one offers', () => {
		const preamps = model().preamps()
		expect(preamps.map((p) => p.inputId)).toEqual([1000, 1001, 1002, 1003])
		const mic1 = preamps[0]
		expect(mic1).toMatchObject({ name: 'MIC 1', moduleId: 154, channel: 0, mode: 0, gain: 560, phantom: false })
		expect(mic1.capabilities['48V']).toBe(true)
		const line1 = preamps[2]
		expect(line1).toMatchObject({ name: 'LINE 1', moduleId: 155, channel: 0, mode: 2 })
		expect(line1.capabilities['48V']).toBe(false)
	})
})

describe('formatGain', () => {
	it('shows tenths of a dB as dB', () => {
		expect(formatGain(-1445)).toBe('-inf')
		expect(formatGain(-165)).toBe('-16.5')
		expect(formatGain(0)).toBe('0.0')
		expect(formatGain(60)).toBe('+6.0')
	})
})

describe('choices for actions and feedbacks', () => {
	it('lists a linked pair shown as one strip once', () => {
		expect(stripChoices(model())).toEqual([
			{ id: 1000, label: 'MIC 1' },
			{ id: 1001, label: 'MIC 2' },
			{ id: 1002, label: 'LINE 1 + LINE 2' },
			{ id: 1200, label: 'Stream-L + Stream-R' },
			{ id: 1210, label: 'Stream 3' },
			{ id: 4, label: 'CUE1-L + CUE1-R' },
		])
		expect(busChoices(model())[0]).toEqual({ id: 0, label: 'MIXER' })
		expect(preampChoices(model()).map((c) => c.label)).toEqual(['MIC 1', 'MIC 2', 'LINE 1', 'LINE 2'])
	})

	it('is empty before the Anubis has been read', () => {
		expect(stripChoices(null)).toEqual([])
	})
})

describe('variables', () => {
	it('defines and fills the same variables', () => {
		const m = model()
		expect(Object.keys(variableValues(m)).sort()).toEqual(Object.keys(variableDefinitions(m)).sort())
	})

	it('shows the state', () => {
		const values = variableValues(model())
		expect(values).toMatchObject({
			device_name: 'Anubis',
			strip_1001_name: 'MIC 2',
			strip_1001_gain: '-inf',
			strip_1001_mute: true,
			strip_1200_gain: '-16.5',
			strip_1200_pan: -100,
			bus_0_name: 'MIXER',
			bus_0_mute: false,
			preamp_1000_mode: 'Mic',
			preamp_1000_gain: '56.0',
			preamp_1000_48v: false,
			preamp_1002_mode: 'Instrument',
		})
		// No 48 V variable where the preamp has no 48 V
		expect(values).not.toHaveProperty('preamp_1002_48v')
	})
})
