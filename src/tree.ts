// The Anubis's state is one JSON tree. Changes arrive as {path, value}: a
// JSONPath to one node and a partial value to merge into it.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

type Step = { key: string } | { index: number } | { id: number }

// The path forms the Anubis uses: `.name`, `[n]` and `[?(@.id==n)][0]`.
const STEP = /^(?:\.([A-Za-z0-9_]+)|\[(\d+)\]|\[\?\(@\.id==(-?\d+)\)\]\[0\])/

export function parsePath(path: string): Step[] | null {
	if (!path.startsWith('$')) return null
	const steps: Step[] = []
	let rest = path.slice(1)
	while (rest.length > 0) {
		const m = STEP.exec(rest)
		if (!m) return null
		if (m[1] !== undefined) steps.push({ key: m[1] })
		else if (m[2] !== undefined) steps.push({ index: Number(m[2]) })
		else steps.push({ id: Number(m[3]) })
		rest = rest.slice(m[0].length)
	}
	return steps
}

function isObject(v: Json | undefined): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function child(node: Json | undefined, step: Step): Json | undefined {
	if ('key' in step) return isObject(node) ? node[step.key] : undefined
	if (!Array.isArray(node)) return undefined
	if ('index' in step) return node[step.index]
	return node.find((item) => isObject(item) && item.id === step.id)
}

export function getAt(root: Json, path: string): Json | undefined {
	const steps = parsePath(path)
	if (!steps) return undefined
	let node: Json | undefined = root
	for (const step of steps) node = child(node, step)
	return node
}

/** The items' ids, when every item is an object with a numeric id */
function idsOf(items: Json[]): number[] | null {
	const ids: number[] = []
	for (const item of items) {
		if (!isObject(item) || typeof item.id !== 'number') return null
		ids.push(item.id)
	}
	return ids
}

/** Called when a change adds or leaves out items of a list kept by id: the state should be read again */
export type OnReshape = () => void

// Objects merge key by key. Arrays of objects with ids (strips, sends,
// inputs, buses) merge by id and keep the items not sent: the Anubis sends
// just the items that changed, e.g. one send of each strip when the
// muted-DAWs view changes. Other arrays merge item by item and take the new
// length. Anything else is replaced.
export function merge(target: Json, source: Json, onReshape?: OnReshape): Json {
	if (isObject(target) && isObject(source)) {
		for (const [key, value] of Object.entries(source)) {
			target[key] = key in target ? merge(target[key], value, onReshape) : value
		}
		return target
	}
	const targetIds = Array.isArray(target) ? idsOf(target) : null
	const sourceIds = Array.isArray(source) ? idsOf(source) : null
	if (Array.isArray(target) && Array.isArray(source) && targetIds && sourceIds) {
		const known = new Set(targetIds)
		if (sourceIds.length !== known.size || sourceIds.some((id) => !known.has(id))) onReshape?.()
		for (const item of source as JsonObject[]) {
			const existing = target.find((t) => (t as JsonObject).id === item.id)
			if (existing) merge(existing, item, onReshape)
			else target.push(item)
		}
		return target
	}
	if (Array.isArray(target) && Array.isArray(source)) {
		target.length = Math.min(target.length, source.length)
		source.forEach((value, i) => {
			target[i] = i < target.length ? merge(target[i], value) : value
		})
		return target
	}
	return source
}

/**
 * Apply one change to the tree. Returns false when the path isn't one we
 * understand or doesn't exist in the tree (the change is then ignored).
 * `onReshape` is called when the change adds or leaves out items of a list
 * kept by id, or addresses an id the tree doesn't have.
 */
export function applyChange(root: JsonObject, path: string, value: Json, onReshape?: OnReshape): boolean {
	const steps = parsePath(path)
	if (!steps || steps.length === 0) return false
	let parent: Json | undefined = root
	for (const step of steps.slice(0, -1)) {
		const next = child(parent, step)
		if (next === undefined && 'id' in step && Array.isArray(parent)) onReshape?.()
		parent = next
	}
	const last = steps[steps.length - 1]
	if (isObject(parent) && 'key' in last) {
		parent[last.key] = last.key in parent ? merge(parent[last.key], value, onReshape) : value
		return true
	}
	if (Array.isArray(parent) && !('key' in last)) {
		const i = 'index' in last ? last.index : parent.findIndex((item) => isObject(item) && item.id === last.id)
		if (i < 0 || i >= parent.length) {
			if ('id' in last) onReshape?.()
			return false
		}
		parent[i] = merge(parent[i], value, onReshape)
		return true
	}
	return false
}
