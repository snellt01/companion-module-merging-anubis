import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, variableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import {
	busChoices,
	preampChoices,
	soundIdChoices,
	stripChoices,
	UpdateFeedbacks,
	type FeedbacksSchema,
} from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { AnubisConnection } from './anubis.js'
import { TalkButtons } from './talkback.js'
import { type AnubisModel, MUSIC_MISSION, TESTED_FIRMWARE } from './model.js'
import type { Write } from './writes.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	anubis: AnubisConnection | null = null
	readonly talkButtons = new TalkButtons()
	// What the variable and feedback definitions were last built from
	private definitionsKey = ''
	private lastValues = new Map<string, string>()
	private firmwareWarned = ''

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions
		this.connect()
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		await this.anubis?.stop()
		this.anubis = null
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		await this.anubis?.stop()
		this.connect()
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/**
	 * Build a write (or a short sequence, as the web UI sends for pad/boost
	 * and low cut) from the current state and send it, in order. Anything
	 * refused, unacknowledged or not reported back is logged as a warning,
	 * and stops the rest of a sequence. With `together`, the writes (to
	 * different controls) go out back to back without waiting for each to
	 * come back, as the web UI sends TALK ALL.
	 */
	async write(build: (model: AnubisModel) => Write | Write[] | null, { together = false } = {}): Promise<void> {
		const anubis = this.anubis
		const model = anubis?.model
		if (!anubis || !model) {
			this.log('warn', 'Not connected to the Anubis; nothing sent')
			return
		}
		let built: Write | Write[] | null
		try {
			built = build(model)
		} catch (e) {
			this.log('warn', e instanceof Error ? e.message : String(e))
			return
		}
		if (!built) return // already in that state
		const send = async (write: Write): Promise<boolean> => {
			try {
				if ((await anubis.write(write)) !== false) return true
				this.log('warn', `${write.description}: the Anubis didn't report the change back`)
			} catch (e) {
				this.log('warn', `${write.description}: ${e instanceof Error ? e.message : String(e)}`)
			}
			return false
		}
		const writes = Array.isArray(built) ? built : [built]
		if (together) {
			await Promise.all(writes.map(send))
			return
		}
		for (const write of writes) if (!(await send(write))) return
	}

	private connect(): void {
		this.anubis = null
		const host = this.config.host?.trim()
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Set the Anubis IP address')
			return
		}
		const anubis = new AnubisConnection(
			{ url: `http://${host}` },
			{
				log: (level, message) => this.log(level, message),
				status: (status, message) => {
					if (status === 'ok') this.updateStatus(InstanceStatus.Ok)
					else if (status === 'connecting') this.updateStatus(InstanceStatus.Connecting)
					else this.updateStatus(InstanceStatus.ConnectionFailure, message)
				},
				loaded: (model) => this.loaded(model),
				changed: (model) => this.changed(model),
			},
		)
		this.anubis = anubis
		anubis.start()
	}

	private loaded(model: AnubisModel): void {
		if (model.mission !== MUSIC_MISSION) {
			this.updateStatus(InstanceStatus.UnknownWarning, "The Anubis isn't in the Music mission")
		}
		if (model.firmware !== TESTED_FIRMWARE && model.firmware !== this.firmwareWarned) {
			this.firmwareWarned = model.firmware
			this.log(
				'warn',
				`Anubis firmware ${model.firmware} hasn't been tested with this module (tested: ${TESTED_FIRMWARE})`,
			)
		}
		this.changed(model)
	}

	private changed(model: AnubisModel): void {
		const key = JSON.stringify([
			stripChoices(model),
			busChoices(model),
			preampChoices(model),
			// What the action lists filter on
			model.strips().map((s) => [
				s.id,
				s.type,
				s.collapsedLink,
				// The buses it's shown on (its per-bus variables)
				[...s.sends.values()].filter((send) => send.visible).map((send) => send.bus),
			]),
			model.busses().map((b) => [b.id, b.monitors, b.panEditable, b.hasTalk, b.hasSoundId]),
			soundIdChoices(model),
		])
		if (key !== this.definitionsKey) {
			this.definitionsKey = key
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariableDefinitions()
		}
		const changedValues: VariablesSchema = {}
		for (const [id, value] of Object.entries(variableValues(model))) {
			const text = JSON.stringify(value)
			if (this.lastValues.get(id) !== text) {
				this.lastValues.set(id, text)
				changedValues[id] = value
			}
		}
		if (Object.keys(changedValues).length > 0) this.setVariableValues(changedValues)
		this.checkAllFeedbacks()
	}
}
