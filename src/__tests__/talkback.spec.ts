import { describe, expect, it } from 'vitest'
import { TalkButtons } from '../talkback.js'

describe('TALK keys', () => {
	it('latches on a tap and turns off on the next tap', () => {
		const keys = new TalkButtons()
		expect(keys.handle('bus 3', 'press', false, 500, 0)).toBe('on')
		expect(keys.handle('bus 3', 'release', false, 500, 200)).toBeNull()
		expect(keys.handle('bus 3', 'press', true, 500, 3000)).toBe('off')
		expect(keys.handle('bus 3', 'release', false, 500, 3100)).toBeNull()
	})

	it('talks only while held', () => {
		const keys = new TalkButtons()
		expect(keys.handle('bus 3', 'press', false, 500, 0)).toBe('on')
		expect(keys.handle('bus 3', 'release', true, 500, 800)).toBe('off')
	})

	it('turns talk off on press when it is already on, and not again on a long release', () => {
		const keys = new TalkButtons()
		expect(keys.handle('all', 'press', true, 500, 0)).toBe('off')
		expect(keys.handle('all', 'release', false, 500, 2000)).toBeNull()
	})

	it('goes by what it sent until the Anubis has had time to report it', () => {
		const keys = new TalkButtons()
		expect(keys.handle('bus 3', 'press', false, 500, 0)).toBe('on')
		expect(keys.handle('bus 3', 'release', false, 500, 100)).toBeNull()
		// Tapped again before the state shows talk on
		expect(keys.handle('bus 3', 'press', false, 500, 300)).toBe('off')
		expect(keys.handle('bus 3', 'release', false, 500, 400)).toBeNull()
		// Later, someone turned it on at the unit: the state counts again
		expect(keys.handle('bus 3', 'press', true, 500, 5000)).toBe('off')
	})

	it('keeps each key separate', () => {
		const keys = new TalkButtons()
		expect(keys.handle('bus 3', 'press', false, 500, 0)).toBe('on')
		expect(keys.handle('bus 4', 'press', false, 500, 10)).toBe('on')
		expect(keys.handle('bus 4', 'release', true, 500, 100)).toBeNull()
		expect(keys.handle('bus 3', 'release', true, 500, 900)).toBe('off')
	})
})
