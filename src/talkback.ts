// What a TALK key does on press and release: a tap turns talkback on and
// leaves it on (or turns it off when it's on); holding it talks only while
// held, off again on release.

export type TalkEvent = 'press' | 'release'

/** Held at least this long, a press is momentary (ms) */
export const DEFAULT_HOLD_MS = 500
// The Anubis's state can lag a write by this much; until then, a key goes
// by what it last sent rather than by the state.
const SETTLE_MS = 1000

export class TalkButtons {
	// When each key held now was pressed (only presses that turned talk on)
	private pressed = new Map<string, number>()
	private sent = new Map<string, { on: boolean; at: number }>()

	/**
	 * What to send for a press or release of the key `key`, given whether
	 * the Anubis shows talkback on; null for nothing.
	 */
	handle(
		key: string,
		event: TalkEvent,
		talking: boolean,
		holdMs = DEFAULT_HOLD_MS,
		now = Date.now(),
	): 'on' | 'off' | null {
		if (event === 'press') {
			const recent = this.sent.get(key)
			const on = recent && now - recent.at < SETTLE_MS ? recent.on : talking
			if (on) this.pressed.delete(key)
			else this.pressed.set(key, now)
			return this.send(key, !on, now)
		}
		const since = this.pressed.get(key)
		this.pressed.delete(key)
		return since !== undefined && now - since >= holdMs ? this.send(key, false, now) : null
	}

	private send(key: string, on: boolean, now: number): 'on' | 'off' {
		this.sent.set(key, { on, at: now })
		return on ? 'on' : 'off'
	}
}
