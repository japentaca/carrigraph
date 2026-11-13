/**
 * nodeParams.js — valid ranges of the parameters of every node type (Fase 4B).
 * Pure (no Vue). Used by "Aleatorizar parámetros" and by the seed controls;
 * the node registry (components/nodes/nodeRegistry.js) exposes them as
 * `entry.params`.
 *
 * A param is addressed by a path inside `node.data` ('density',
 * 'filter.cutoff'). Kinds:
 *   number  { min, max, step }         uniform, snapped to step
 *   int     { min, max }               integer
 *   enum    { values: [...] }          one of the values
 *   bool    { p }                      true with probability p (0.5)
 *   steps   { p }                      boolean[] of the current length, each true with p
 * `random: false` keeps a param out of the randomizer (volume, pan, names:
 * randomizing them would only make the node silent or confusing). Ranges for
 * random values can be narrower than what the node accepts (e.g. Length is
 * valid up to 512 but is randomized among musical lengths), never wider.
 *
 * Seeds: the node types in SEED_TYPES have `data.seed` (0..0.999, shown ×1000)
 * and may have `data.seedLocked`. A locked seed is kept by "nueva semilla"
 * and by the randomizer. Copy / paste / duplicate always keep seeds.
 */

import { SCALES, NOTE_NAMES, MELODY_MODES, DRUM_PIECES, INSTRUMENT_NAMES, createRng } from '../engine/score.js'
import { EFFECT_RANGES, FILTER_MODES, EFFECT_TYPES } from '../engine/effects.js'
import { CELLULAR_RULES } from '../patternGenerators.js'
import { newSeed } from './nodeTypes.js'

const number = (min, max, step, extra = {}) => ({ kind: 'number', min, max, step, ...extra })
const int = (min, max, extra = {}) => ({ kind: 'int', min, max, ...extra })
const choice = (values, extra = {}) => ({ kind: 'enum', values, ...extra })
const bool = (p = 0.5, extra = {}) => ({ kind: 'bool', p, ...extra })

const effectParams = () => {
  const r = (name, step) => number(EFFECT_RANGES[name][0], EFFECT_RANGES[name][1], step)
  return {
    'distortion.enabled': bool(0.25),
    'distortion.amount': r('amount', 0.05),
    'distortion.drive': r('drive', 0.05),
    'distortion.tone': number(1000, 9000, 100),
    'filter.enabled': bool(0.5),
    'filter.amount': number(0.5, 1, 0.05),
    'filter.mode': choice(FILTER_MODES),
    'filter.cutoff': number(200, 8000, 10),
    'filter.resonance': number(0.5, 8, 0.1),
    'delay.enabled': bool(0.4),
    'delay.amount': number(0.1, 0.6, 0.05),
    'delay.time': choice([0.125, 0.1875, 0.25, 0.375, 0.5, 0.75]),
    'delay.feedback': number(0.1, 0.7, 0.05),
    'reverb.enabled': bool(0.6),
    'reverb.amount': number(0.1, 0.6, 0.05),
    'reverb.decay': number(0.5, 5, 0.1)
  }
}

/** Parameter specs by node type. */
export const NODE_PARAMS = {
  pattern: {
    algorithm: choice(['euclidean', 'random', 'binary', 'fibonacci', 'cellular', 'noise']),
    density: number(0.1, 0.9, 0.1),
    rotation: int(0, 15),
    rule: choice(CELLULAR_RULES),
    generations: int(1, 16),
    noiseScale: int(1, 16)
  },
  steps: { steps: { kind: 'steps', p: 0.35 } },
  length: { value: choice([8, 12, 16, 24, 32, 48, 64]) },
  loop: { value: choice([2, 3, 4, 5, 6, 8, 12]) },
  logic: { operation: choice(['and', 'or', 'xor', 'not']) },
  transform: {
    operation: choice(['invert', 'reverse', 'rotate', 'double', 'half', 'probability']),
    amount: int(-8, 8),
    probability: number(0.3, 1, 0.05)
  },
  scale: {
    root: choice(NOTE_NAMES),
    scale: choice(Object.keys(SCALES)),
    mode: choice(MELODY_MODES),
    octave: int(2, 6),
    range: int(1, 4)
  },
  chord: { chord: choice(['triad', 'seventh', 'fifths']) },
  groove: {
    swing: number(0, 0.8, 0.05),
    timing: number(0, 0.6, 0.05),
    velocity: number(0, 0.6, 0.05),
    accentEvery: choice([0, 2, 3, 4, 8]),
    accentAmount: number(0, 0.8, 0.05)
  },
  voice: {
    instrument: choice(INSTRUMENT_NAMES),
    volume: number(0, 1, 0.05, { random: false }),
    pan: number(-1, 1, 0.1, { random: false }),
    octave: int(2, 6),
    melodyMode: choice(MELODY_MODES),
    root: choice(NOTE_NAMES),
    scale: choice(Object.keys(SCALES)),
    range: int(1, 4),
    drumPiece: choice(DRUM_PIECES)
  },
  effects: effectParams(),
  output: {
    volume: number(0, 1, 0.01, { random: false }),
    pan: number(-1, 1, 0.05, { random: false }),
    mute: bool(0, { random: false }),
    solo: bool(0, { random: false })
  }
}

/** Node types with a seed (data.seed) in their defaults. */
export const SEED_TYPES = ['pattern', 'transform', 'scale', 'groove']

export const hasSeed = (type) => SEED_TYPES.includes(type)

/**
 * Does the seed of this node change what it produces right now? (Euclidean
 * patterns, Transform other than "probability", Scale other than "random"
 * ignore it.) The UI still shows the seed controls, dimmed.
 */
export function seedMatters(node) {
  const d = node?.data || {}
  switch (node?.type) {
    case 'pattern': return (d.algorithm || 'euclidean') !== 'euclidean'
    case 'transform': return d.operation === 'probability'
    case 'scale': return d.mode === 'random'
    case 'groove': return (d.timing ?? 0) > 0 || (d.velocity ?? 0) > 0
    default: return false
  }
}

/** Are there params the randomizer may change for this type? */
export function canRandomize(type) {
  const params = NODE_PARAMS[type]
  return !!params && Object.values(params).some(p => p.random !== false)
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
/** Value of a param path ('filter.cutoff') inside node data. */
export const getParamValue = getPath
/** Set a param path inside node data (mutates `obj`; creates missing objects). */
export const setParamValue = (obj, path, value) => setPath(obj, path, value)
function setPath(obj, path, value) {
  const keys = path.split('.')
  let o = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}
    o = o[keys[i]]
  }
  o[keys[keys.length - 1]] = value
}

const decimals = (step) => {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/** One random value of a param spec (`rng` returns [0, 1)). */
export function randomParamValue(spec, rng, current) {
  switch (spec.kind) {
    case 'number': {
      const n = Math.round((spec.max - spec.min) / spec.step)
      const v = spec.min + Math.floor(rng() * (n + 1)) * spec.step
      return Number(Math.min(spec.max, v).toFixed(decimals(spec.step)))
    }
    case 'int':
      return spec.min + Math.floor(rng() * (spec.max - spec.min + 1))
    case 'enum':
      return spec.values[Math.floor(rng() * spec.values.length)]
    case 'bool':
      return rng() < (spec.p ?? 0.5)
    case 'steps': {
      const len = Array.isArray(current) && current.length ? current.length : 16
      const out = Array.from({ length: len }, () => rng() < (spec.p ?? 0.35))
      if (!out.some(Boolean)) out[0] = true // never an empty pattern
      return out
    }
    default:
      return current
  }
}

/** Is `value` inside the spec's valid range? (tests / sanity) */
export function isValidParamValue(spec, value) {
  switch (spec.kind) {
    case 'number': return typeof value === 'number' && value >= spec.min - 1e-9 && value <= spec.max + 1e-9
    case 'int': return Number.isInteger(value) && value >= spec.min && value <= spec.max
    case 'enum': return spec.values.includes(value)
    case 'bool': return typeof value === 'boolean'
    case 'steps': return Array.isArray(value) && value.every(v => typeof v === 'boolean')
    default: return true
  }
}

/**
 * New data for a node with its randomizable params drawn inside their valid
 * ranges. Keeps label, color, every non-random param and unknown fields. The
 * seed is renewed too unless the node has `seedLocked` (or `keepSeed`).
 * Pure: returns a new object, never mutates `data`.
 * @param {string} type
 * @param {object} data
 * @param {object} [opts]
 * @param {() => number} [opts.rng]  default: seeded from Math.random
 * @param {boolean} [opts.keepSeed]
 */
export function randomizeNodeData(type, data = {}, { rng, keepSeed = false } = {}) {
  const random = rng || createRng(Math.random())
  const next = JSON.parse(JSON.stringify(data || {}))
  const params = NODE_PARAMS[type] || {}
  for (const [path, spec] of Object.entries(params)) {
    if (spec.random === false) continue
    setPath(next, path, randomParamValue(spec, random, getPath(next, path)))
  }
  if (hasSeed(type) && !keepSeed && !data?.seedLocked) {
    next.seed = Math.round(random() * 1000) / 1000
  }
  return next
}

/**
 * New data with a fresh seed, or null when the node has no seed or its seed
 * is locked.
 */
export function withNewSeed(node, seed = newSeed()) {
  if (!node || !hasSeed(node.type) || node.data?.seedLocked) return null
  let s = seed
  if (s === node.data?.seed) s = Math.round(((s * 1000 + 1) % 1000)) / 1000
  return { ...node.data, seed: s }
}

export { EFFECT_TYPES }
