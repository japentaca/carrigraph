/**
 * macros.js — performance macros (Fase 5B). Pure (no Vue).
 *
 * A macro is one control (0..1) that moves one or more node parameters, each
 * inside the range the node registry gives it (NODE_PARAMS in nodeParams.js):
 *   number / int  → linear between min and max (snapped to step / integer)
 *   enum          → walks the list of values (e.g. Largo: 8, 12, 16 … 64)
 * A target can be inverted (1 → min). Booleans and step grids cannot be
 * assigned. Macros are saved with the project (metadata.macros).
 *
 * Shape: { id: 'm1', name: 'Macro 1', value: 0..1,
 *          targets: [{ nodeId: string, path: 'filter.cutoff', invert?: true }] }
 */

import { NODE_PARAMS, getParamValue, setParamValue } from './nodeParams.js'

export const MACRO_COUNT = 4
const ASSIGNABLE = ['number', 'int', 'enum']

const clamp01 = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

const decimals = (step) => {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/** Param spec for a node type and path, or null. */
export function paramSpec(type, path) {
  return NODE_PARAMS[type]?.[path] || null
}

/**
 * Can this param be driven by a macro? Numbers, integers and lists of
 * numbers (Largo, Delay · tiempo…). Lists of names (algorithm, scale,
 * instrument) are left out: sweeping them is not a continuous gesture.
 */
export function isAssignable(spec) {
  if (!spec || !ASSIGNABLE.includes(spec.kind)) return false
  if (spec.kind === 'enum') return spec.values.length > 1 && spec.values.every(v => typeof v === 'number')
  return true
}

/** Spanish names of the assignable params (UI). */
export const PARAM_LABELS = {
  density: 'Densidad',
  rotation: 'Rotación',
  rule: 'Regla',
  generations: 'Generaciones',
  noiseScale: 'Suavidad',
  value: 'Valor',
  amount: 'Cantidad',
  probability: 'Probabilidad',
  octave: 'Octava',
  range: 'Rango',
  swing: 'Swing',
  timing: 'Humanizar tiempo',
  velocity: 'Humanizar intensidad',
  accentEvery: 'Acento cada',
  accentAmount: 'Fuerza del acento',
  volume: 'Volumen',
  pan: 'Paneo',
  'distortion.amount': 'Distorsión · cantidad',
  'distortion.drive': 'Distorsión · drive',
  'distortion.tone': 'Distorsión · tono',
  'filter.amount': 'Filtro · cantidad',
  'filter.cutoff': 'Filtro · corte',
  'filter.resonance': 'Filtro · resonancia',
  'delay.amount': 'Delay · cantidad',
  'delay.time': 'Delay · tiempo',
  'delay.feedback': 'Delay · realimentación',
  'reverb.amount': 'Reverb · cantidad',
  'reverb.decay': 'Reverb · duración'
}

export const paramLabel = (path) => PARAM_LABELS[path] || path

/** "min–max" (or the list) of a spec, for the UI. */
export function rangeLabel(spec) {
  if (!spec) return ''
  if (spec.kind === 'enum') return spec.values.join(' · ')
  return `${spec.min}–${spec.max}`
}

/** Assignable params of a node type: [{ path, spec }]. */
export function assignableParams(type) {
  return Object.entries(NODE_PARAMS[type] || {})
    .filter(([, spec]) => isAssignable(spec))
    .map(([path, spec]) => ({ path, spec }))
}

/** Param value for a control position 0..1 (inside the spec's range). */
export function valueFromPosition(spec, position) {
  const t = clamp01(position)
  switch (spec?.kind) {
    case 'number': {
      const raw = spec.min + t * (spec.max - spec.min)
      const snapped = spec.min + Math.round((raw - spec.min) / spec.step) * spec.step
      return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(decimals(spec.step)))
    }
    case 'int':
      return Math.round(spec.min + t * (spec.max - spec.min))
    case 'enum':
      return spec.values[Math.min(spec.values.length - 1, Math.floor(t * spec.values.length))]
    default:
      return undefined
  }
}

/** Control position 0..1 of a current value (inverse of valueFromPosition). */
export function positionFromValue(spec, value) {
  switch (spec?.kind) {
    case 'number':
    case 'int': {
      const span = spec.max - spec.min
      return span > 0 ? clamp01((Number(value) - spec.min) / span) : 0
    }
    case 'enum': {
      const i = spec.values.indexOf(value)
      return i < 0 || spec.values.length < 2 ? 0 : i / (spec.values.length - 1)
    }
    default:
      return 0
  }
}

/** The empty macro set (MACRO_COUNT slots). */
export function defaultMacros() {
  return Array.from({ length: MACRO_COUNT }, (_, i) => ({ id: `m${i + 1}`, name: `Macro ${i + 1}`, value: 0.5, targets: [] }))
}

/**
 * Clean macros read from a project (or anything): always MACRO_COUNT slots,
 * names trimmed to 40 characters, values clamped, targets with a string
 * node id and a path; duplicates dropped. Unknown fields are not kept.
 */
export function normalizeMacros(raw) {
  const list = Array.isArray(raw) ? raw : []
  return defaultMacros().map((slot, i) => {
    const m = list[i] && typeof list[i] === 'object' ? list[i] : {}
    const seen = new Set()
    const targets = (Array.isArray(m.targets) ? m.targets : [])
      .filter(t => t && (typeof t.nodeId === 'string' || typeof t.nodeId === 'number') && typeof t.path === 'string' && t.path)
      .map(t => ({ nodeId: String(t.nodeId), path: t.path, ...(t.invert ? { invert: true } : {}) }))
      .filter(t => {
        const k = `${t.nodeId}|${t.path}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 40) : slot.name
    return { id: slot.id, name, value: m.value === undefined ? slot.value : clamp01(m.value), targets }
  })
}

/** Are these macros all empty defaults? (then they are not saved) */
export function isDefaultMacros(macros) {
  return JSON.stringify(normalizeMacros(macros)) === JSON.stringify(defaultMacros())
}

/** Stable text for change detection (unsaved changes). */
export function macrosSignature(macros) {
  return isDefaultMacros(macros) ? '' : JSON.stringify(normalizeMacros(macros))
}

/**
 * New node data for moving a macro to `value`: { [nodeId]: data } for the
 * nodes whose params change (targets on missing nodes or on params that are
 * not assignable are skipped). Pure: never mutates the nodes.
 */
export function applyMacro(macro, value, nodes = []) {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const out = {}
  for (const target of macro?.targets || []) {
    const node = byId.get(String(target.nodeId))
    const spec = node && paramSpec(node.type, target.path)
    if (!isAssignable(spec)) continue
    const position = target.invert ? 1 - clamp01(value) : clamp01(value)
    const next = valueFromPosition(spec, position)
    const id = String(node.id)
    const data = out[id] || JSON.parse(JSON.stringify(node.data || {}))
    if (getParamValue(data, target.path) === next && !out[id]) continue
    setParamValue(data, target.path, next)
    out[id] = data
  }
  return out
}

/** Targets whose node no longer exists (to show them as broken). */
export function missingTargets(macro, nodes = []) {
  const ids = new Set(nodes.map(n => String(n.id)))
  return (macro?.targets || []).filter(t => !ids.has(String(t.nodeId)))
}
