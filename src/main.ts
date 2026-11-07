import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, variableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { busChoices, preampChoices, stripChoices, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { AnubisConnection } from './anubis.js'
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
	 * Build a write from the current state and send it. Anything refused,
	 * unacknowledged or not reported back is logged as a warning.
	 */
	async write(build: (model: AnubisModel) => Write | null): Promise<void> {
		const model = this.anubis?.model
		if (!this.anubis || !model) {
			this.log('warn', 'Not connected to the Anubis; nothing sent')
			return
		}
		let write: Write | null = null
		try {
			write = build(model)
			if (!write) return // already in that state
			const confirmed = await this.anubis.write(write)
			if (confirmed === false) this.log('warn', `${write.description}: the Anubis didn't report the change back`)
		} catch (e) {
			const what = write ? `${write.description}: ` : ''
			this.log('warn', `${what}${e instanceof Error ? e.message : String(e)}`)
		}
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
			model.strips().map((s) => [s.id, s.type, s.collapsedLink]),
			model.busses().map((b) => [b.id, b.monitors, b.panEditable]),
		])
		if (key !== this.definitionsKey) {
			this.definitionsKey = key
			this.updateActions()
			this.updateFeedbacks()
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
