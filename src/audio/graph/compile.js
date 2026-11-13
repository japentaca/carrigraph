/**
 * compile.js — graph compiler: (nodes, edges) → multitrack engine score +
 * diagnostics. Pure (no Vue, no Pinia, no Web Audio). Replaces the old
 * graphTraversal.js.
 *
 * Two modes:
 *  - 'tracks': the graph has at least one Output node. Every chain that ends
 *    in an Output is a track; tracks play together, each cycling over its
 *    own length (polymetry). Edges are directed and typed (see nodeTypes.js).
 *  - 'compat': no Output node. Behaves like the pre-Fase-3 editor: the first
 *    Pattern node plus the Length / Loop / Voice nodes directly connected to
 *    it (in any direction) make ONE track. Nodes new in Fase 3 have no effect
 *    here (a diagnostic says so).
 *  ('empty' when there are no nodes.)
 *
 * Values flowing through output ports:
 *   number   → number
 *   pattern  → { kind:'pattern', length, steps: boolean[], seed }
 *   notes    → { kind:'notes', length, seed, scale: {root, scale, octave}|null,
 *                events: [{ step, time, midi: number|null, vel }] }
 *   audio    → { kind:'audio', voiceId, instrument, octave, melody, drumPiece,
 *                volume, pan, notes, effects: EffectSpec[] }
 *              (each Effects node appends its enabled effects, see effectsFromNode)
 *
 * Output nodes are the mixer strips: track volume = voice volume × output
 * volume, pan = voice pan + output pan (clamped), plus mute / solo (resolved
 * by the engine: src/audio/engine/score.js isTrackAudible).
 *
 * Seeds are deterministic: a node's stored seed (0 included) or, if missing,
 * one derived from its id (nodeSeed). Never Math.random().
 */

import { GRAPH_ONLY_TYPES, NODE_TYPES, nodeSeed, nodeLabel } from './nodeTypes.js'
import { resolvePorts, reaches } from './connections.js'
import {
  buildScore, buildRhythm, buildMelody, buildTrackFromNotes, createRng,
  SCALES, rootToPitchClass
} from '../engine/score.js'
import { rotatePattern } from '../patternGenerators.js'
import { EFFECT_TYPES, normalizeEffect } from '../engine/effects.js'

const key = (id) => String(id)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const MAX_STEPS = 1024

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** pattern → notes (one unpitched note per hit); notes pass through. */
export function toNotes(value) {
  if (!value) return null
  if (value.kind === 'notes') return value
  if (value.kind !== 'pattern') return null
  const events = []
  value.steps.forEach((on, step) => { if (on) events.push({ step, time: step, midi: null, vel: 1 }) })
  return { kind: 'notes', length: value.length, seed: value.seed, scale: null, events }
}

const asPattern = (v) => (v && v.kind === 'pattern' ? v : null)
const makePattern = (steps, seed) => ({ kind: 'pattern', length: steps.length, steps, seed })
const sortByTime = (events) => events
  .map((e, i) => ({ e, i }))
  .sort((a, b) => a.e.time - b.e.time || a.i - b.i)
  .map(x => x.e)

/** Pitch-class shapes for scales that do not have 7 notes. */
const CHROMATIC_SHAPES = { triad: [0, 4, 7], seventh: [0, 4, 7, 10] }

/**
 * MIDI notes of the chord built on `midi` inside a scale context.
 *  - triad / seventh: stack every other scale degree (diatonic chord). On
 *    the chromatic scale, a major triad / dominant seventh.
 *  - fifths: root + fifth + octave (power chord).
 */
export function chordTones(midi, { root = 'C', scale = 'pentatonic' } = {}, type = 'triad') {
  if (type === 'fifths') return [midi, midi + 7, midi + 12].filter(m => m <= 127)
  const intervals = SCALES[scale] || SCALES.pentatonic
  const n = intervals.length
  if (n === 12) {
    return (CHROMATIC_SHAPES[type] || CHROMATIC_SHAPES.triad).map(s => midi + s).filter(m => m <= 127)
  }
  const rootPc = rootToPitchClass(root)
  const rel = midi - rootPc
  const octave = Math.floor(rel / 12)
  const pc = ((rel % 12) + 12) % 12
  let idx = 0
  for (let i = 0; i < n; i++) if (intervals[i] <= pc) idx = i
  const degree = octave * n + idx
  const toMidi = (d) => rootPc + 12 * Math.floor(d / n) + intervals[((d % n) + n) % n]
  const offsets = type === 'seventh' ? [0, 2, 4, 6] : [0, 2, 4]
  // Keep the played note as the chord root even if it was outside the scale.
  return offsets.map((o, i) => (i === 0 ? midi : toMidi(degree + o) + (midi - toMidi(degree))))
    .filter(m => m <= 127)
}

// ---------------------------------------------------------------------------
// Node evaluators. Each gets (node, ctx) and returns the value of its single
// output port (or null). ctx = { input(portId), hasInput(portId), diag(level, code, message) }.
// ---------------------------------------------------------------------------

export const NODE_EVALUATORS = {
  length(node) {
    return clamp(Math.round(num(node.data?.value, 0)) || 16, 1, 512)
  },

  loop(node) {
    return clamp(Math.round(num(node.data?.value, 0)) || 8, 1, 512)
  },

  pattern(node, ctx) {
    const d = node.data || {}
    const seed = nodeSeed(node)
    const loop = ctx.input('loop')
    const steps = buildRhythm({
      algorithm: d.algorithm || 'euclidean',
      density: d.density ?? 0.5,
      rotation: d.rotation || 0,
      seed,
      length: ctx.input('length') ?? 16,
      loop: loop ?? undefined,
      rule: d.rule,
      generations: d.generations,
      noiseScale: d.noiseScale
    })
    if (!steps.some(Boolean)) ctx.diag('info', 'empty-pattern', 'El patrón no tiene golpes')
    return makePattern(steps, seed)
  },

  steps(node) {
    const raw = Array.isArray(node.data?.steps) ? node.data.steps.slice(0, 64) : []
    const steps = raw.length ? raw.map(Boolean) : new Array(16).fill(false)
    return makePattern(steps, nodeSeed(node))
  },

  logic(node, ctx) {
    const op = node.data?.operation || 'and'
    const a = asPattern(ctx.input('a'))
    const b = asPattern(ctx.input('b'))
    if (!a) {
      ctx.diag('warning', 'missing-input', 'Falta el patrón A')
      return null
    }
    if (op === 'not') return makePattern(a.steps.map(s => !s), a.seed)
    if (!b) {
      ctx.diag('warning', 'missing-input', 'Falta el patrón B: pasa A sin cambios')
      return a
    }
    const len = Math.max(a.length, b.length)
    const out = new Array(len)
    for (let i = 0; i < len; i++) {
      const x = a.steps[i % a.length]
      const y = b.steps[i % b.length]
      out[i] = op === 'or' ? x || y : op === 'xor' ? x !== y : x && y
    }
    return makePattern(out, a.seed)
  },

  transform(node, ctx) {
    const d = node.data || {}
    const p = asPattern(ctx.input('in'))
    if (!p) {
      ctx.diag('warning', 'missing-input', 'Conectá un patrón a la entrada')
      return null
    }
    const s = p.steps
    const L = s.length
    switch (d.operation || 'reverse') {
      case 'invert':
        return makePattern(s.map(x => !x), p.seed)
      case 'reverse':
        return makePattern(s.slice().reverse(), p.seed)
      case 'rotate':
        return makePattern(rotatePattern(s, num(d.amount, 1)), p.seed)
      case 'double': {
        // Twice as fast: the cycle halves (odd steps cannot be represented).
        const len = Math.max(1, Math.ceil(L / 2))
        return makePattern(Array.from({ length: len }, (_, i) => !!s[2 * i]), p.seed)
      }
      case 'half': {
        // Half as fast: the cycle doubles, each hit lands on an even step.
        const len = Math.min(MAX_STEPS, L * 2)
        return makePattern(Array.from({ length: len }, (_, i) => i % 2 === 0 && !!s[i / 2]), p.seed)
      }
      case 'probability': {
        const prob = clamp(num(d.probability, 0.75), 0, 1)
        const rng = createRng(`prob:${nodeSeed(node)}`)
        return makePattern(s.map(x => { const r = rng(); return x && r < prob }), p.seed)
      }
      default:
        return p
    }
  },

  scale(node, ctx) {
    const notes = toNotes(ctx.input('in'))
    if (!notes) {
      ctx.diag('warning', 'missing-input', 'Conectá un patrón a la entrada')
      return null
    }
    const d = node.data || {}
    const scale = SCALES[d.scale] ? d.scale : 'pentatonic'
    const root = d.root || 'C'
    const octave = clamp(Math.round(num(d.octave, 4)), 0, 8)
    const ordered = sortByTime(notes.events)
    const melody = buildMelody(ordered.length, {
      mode: d.mode || 'ascending', root, scale, octave, range: d.range ?? 2, seed: nodeSeed(node)
    })
    return {
      ...notes,
      events: ordered.map((e, i) => ({ ...e, midi: melody[i] })),
      scale: { root, scale, octave }
    }
  },

  chord(node, ctx) {
    const notes = toNotes(ctx.input('in'))
    if (!notes) {
      ctx.diag('warning', 'missing-input', 'Conectá notas a la entrada')
      return null
    }
    if (!notes.scale || !notes.events.some(e => Number.isFinite(e.midi))) {
      ctx.diag('warning', 'needs-scale', 'Acorde sin notas: conectá un nodo Escala / Melodía antes')
      return notes
    }
    const type = ['triad', 'seventh', 'fifths'].includes(node.data?.chord) ? node.data.chord : 'triad'
    const events = []
    for (const e of notes.events) {
      if (!Number.isFinite(e.midi)) { events.push(e); continue }
      const tones = chordTones(e.midi, notes.scale, type)
      const vel = tones.length > 1 ? e.vel * 0.8 : e.vel
      for (const midi of tones) events.push({ ...e, midi, vel })
    }
    return { ...notes, events }
  },

  groove(node, ctx) {
    const notes = toNotes(ctx.input('in'))
    if (!notes) {
      ctx.diag('warning', 'missing-input', 'Conectá un patrón o notas a la entrada')
      return null
    }
    const d = node.data || {}
    const swing = clamp(num(d.swing, 0), 0, 1)
    const timing = clamp(num(d.timing, 0), 0, 1)
    const velocity = clamp(num(d.velocity, 0), 0, 1)
    const every = Math.max(0, Math.round(num(d.accentEvery, 0)))
    const amount = clamp(num(d.accentAmount, 0), 0, 1)
    const rng = createRng(`groove:${nodeSeed(node)}`)
    const events = notes.events.map(e => {
      const r1 = rng()
      const r2 = rng()
      let offset = e.time - e.step
      if (e.step % 2 === 1) offset += swing * 0.5 // swing: late off-beat 16ths
      offset += r1 * timing * 0.2 // humanize: only late, never before the step
      offset = clamp(offset, 0, 0.9)
      let vel = e.vel
      if (every > 0) vel *= e.step % every === 0 ? 1 + amount : 1 - amount * 0.3
      vel *= 1 + (r2 * 2 - 1) * velocity * 0.3
      return { ...e, time: e.step + offset, vel: Math.max(0, vel) }
    })
    return { ...notes, events }
  },

  voice(node, ctx) {
    const notes = toNotes(ctx.input('notes'))
    if (!notes) {
      ctx.diag('warning', 'voice-no-input', 'Voz sin patrón: conectá un patrón o notas')
      return null
    }
    const d = node.data || {}
    const instrument = d.instrument || 'Piano'
    if (instrument === 'Drums' && notes.events.some(e => Number.isFinite(e.midi))) {
      ctx.diag('info', 'drums-ignore-pitch', 'La batería ignora las alturas: usa la pieza elegida')
    }
    return {
      kind: 'audio',
      voiceId: key(node.id),
      instrument,
      octave: d.octave || 4,
      melody: voiceMelody(d),
      drumPiece: d.drumPiece || 'auto',
      volume: d.volume ?? 0.8,
      pan: d.pan ?? 0,
      notes,
      effects: []
    }
  },

  effects(node, ctx) {
    const audio = ctx.input('in')
    if (!audio || audio.kind !== 'audio') {
      ctx.diag('warning', 'missing-input', 'Conectá una Voz (o más efectos) a la entrada')
      return null
    }
    const own = effectsFromNode(node)
    if (own.length === 0) ctx.diag('info', 'no-effects', 'Ningún efecto activado: el sonido pasa sin cambios')
    return { ...audio, effects: [...(audio.effects || []), ...own] }
  }
}

/**
 * Enabled effects of an Effects node, in the fixed order distortion →
 * filter → delay → reverb, as engine effect specs with stable ids
 * (`<nodeId>:<type>`, so a live change updates the same chain).
 * Node data: { distortion: { enabled, amount, drive, tone }, filter: { enabled,
 * amount, mode, cutoff, resonance }, delay: { enabled, amount, time, feedback },
 * reverb: { enabled, amount, decay } }.
 */
export function effectsFromNode(node) {
  const d = node?.data || {}
  const out = []
  for (const type of EFFECT_TYPES) {
    const cfg = d[type]
    if (!cfg || !cfg.enabled) continue
    const spec = normalizeEffect({ ...cfg, type, id: `${key(node.id)}:${type}` })
    if (spec) out.push(spec)
  }
  return out
}

/** Fallback melody of a VoiceNode (used for notes that have no pitch). */
export function voiceMelody(d = {}) {
  return {
    mode: d.melodyMode || 'ascending',
    root: d.root || 'C',
    scale: d.scale || 'pentatonic',
    range: d.range ?? 2
  }
}

// ---------------------------------------------------------------------------
// Compatibility mode (no Output node): the pre-Fase-3 single-track behaviour.
// ---------------------------------------------------------------------------

/**
 * Parameters of the single compat-mode track: the first Pattern node and the
 * Length / Loop / Voice nodes connected to it in either direction. Same
 * semantics as the old graphTraversal.getConnectedPatternData, except that a
 * missing seed is derived from the node id (deterministic) and 0 is a valid seed.
 */
export function legacyGraphParams(nodes = [], edges = []) {
  let pattern = { algorithm: 'euclidean', density: 0.5, rotation: 0, seed: 0 }
  let length = 16
  let loopSize = 8
  let instrument = 'Piano'
  let octave = 4

  const patternNodes = nodes.filter(n => n.type === 'pattern')
  if (patternNodes.length === 0) {
    const lengthNode = nodes.find(n => n.type === 'length')
    const loopNode = nodes.find(n => n.type === 'loop')
    const voiceNode = nodes.find(n => n.type === 'voice')
    if (lengthNode) length = lengthNode.data?.value || 16
    if (loopNode) loopSize = loopNode.data?.value || 8
    if (voiceNode) instrument = voiceNode.data?.instrument || 'Piano'
    return {
      pattern, length, loopSize, instrument, octave,
      ...legacyVoiceParams(voiceNode), hasLoopNode: !!loopNode,
      patternId: null, voiceId: voiceNode ? key(voiceNode.id) : null
    }
  }

  const primary = patternNodes[0]
  const pid = key(primary.id)
  const connectedIds = new Set()
  for (const e of edges) {
    if (!e) continue
    if (key(e.target) === pid) connectedIds.add(key(e.source))
    if (key(e.source) === pid) connectedIds.add(key(e.target))
  }
  const connected = nodes.filter(n => connectedIds.has(key(n.id)))
  const connectedLength = connected.find(n => n.type === 'length')
  const connectedLoop = connected.find(n => n.type === 'loop')
  const connectedVoice = connected.find(n => n.type === 'voice')

  if (connectedLength) length = connectedLength.data?.value || 16
  if (connectedLoop) loopSize = connectedLoop.data?.value || 8
  if (connectedVoice) {
    instrument = connectedVoice.data?.instrument || 'Piano'
    octave = connectedVoice.data?.octave || 4
  }
  const d = primary.data || {}
  pattern = {
    algorithm: d.algorithm || 'euclidean',
    density: d.density ?? 0.5,
    rotation: d.rotation || 0,
    seed: nodeSeed(primary),
    rule: d.rule,
    generations: d.generations,
    noiseScale: d.noiseScale
  }
  return {
    pattern, length, loopSize, instrument, octave,
    ...legacyVoiceParams(connectedVoice),
    hasLoopNode: !!connectedLoop,
    patternId: pid,
    voiceId: connectedVoice ? key(connectedVoice.id) : null,
    nodeIds: [pid, ...connected.filter(n => ['length', 'loop', 'voice'].includes(n.type)).map(n => key(n.id))]
  }
}

function legacyVoiceParams(voiceNode) {
  const d = voiceNode?.data || {}
  return {
    melody: voiceMelody(d),
    drumPiece: d.drumPiece || 'auto',
    volume: d.volume ?? 0.8,
    pan: d.pan ?? 0
  }
}

/** Track spec for buildScore() in compat mode (old getTrackSpec). */
export function legacyTrackSpec(nodes = [], edges = []) {
  const p = legacyGraphParams(nodes, edges)
  return {
    id: 'track-1',
    name: p.instrument,
    instrument: p.instrument,
    pattern: p.pattern,
    length: p.length,
    loop: p.hasLoopNode ? p.loopSize : undefined,
    octave: p.octave,
    melody: p.melody,
    drumPiece: p.drumPiece,
    volume: p.volume,
    pan: p.pan
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * @param {object[]} nodes  Vue Flow nodes ({ id, type, data })
 * @param {object[]} edges  Vue Flow edges ({ id, source, target, sourceHandle, targetHandle })
 * @param {{ tempo?: number }} [opts]
 * @returns {{
 *   score: { tempo, stepsPerBeat, tracks },
 *   mode: 'tracks'|'compat'|'empty',
 *   tracks: { id, outputId, voiceId, nodeIds: string[] }[],
 *   diagnostics: { nodeId: string|null, level: 'error'|'warning'|'info', code: string, message: string, edgeId? }[],
 *   previews: { [nodeId]: Preview }   what each node outputs (thumbnails; see previewOf). Fase 4B.
 * }}
 */
export function compileGraph(nodes = [], edges = [], { tempo = 120 } = {}) {
  const nodeList = (nodes || []).filter(n => n && n.id != null)
  const edgeList = (edges || []).filter(e => e && e.source != null && e.target != null)
  const diagnostics = []
  const diag = (nodeId, level, code, message, extra = {}) => {
    diagnostics.push({ nodeId: nodeId == null ? null : key(nodeId), level, code, message, ...extra })
  }

  if (nodeList.length === 0) {
    return { score: buildScore({ tempo, tracks: [] }), mode: 'empty', tracks: [], diagnostics, previews: {} }
  }

  const touched = new Set()
  for (const e of edgeList) { touched.add(key(e.source)); touched.add(key(e.target)) }
  for (const n of nodeList) {
    if (!NODE_TYPES[n.type]) diag(n.id, 'warning', 'unknown-type', `Tipo de nodo desconocido: ${n.type}`)
    else if (!touched.has(key(n.id))) diag(n.id, 'warning', 'disconnected', 'Nodo sin conectar')
  }

  if (!nodeList.some(n => n.type === 'output')) {
    return compileCompat(nodeList, edgeList, tempo, diagnostics, diag)
  }
  return compileTracks(nodeList, edgeList, tempo, diagnostics, diag)
}

function compileCompat(nodes, edges, tempo, diagnostics, diag) {
  const params = legacyGraphParams(nodes, edges)
  const score = buildScore({ tempo, tracks: [legacyTrackSpec(nodes, edges)] })
  diag(null, 'info', 'compat-mode',
    'Sin nodo Salida: modo compatibilidad (una sola pista con el primer patrón). Agregá un nodo Salida para usar varias pistas y los nodos nuevos.')
  for (const n of nodes) {
    if (GRAPH_ONLY_TYPES.includes(n.type)) {
      diag(n.id, 'info', 'needs-output', 'Sin efecto hasta que la cadena termine en un nodo Salida')
    }
  }
  return {
    score,
    mode: 'compat',
    tracks: [{ id: 'track-1', outputId: null, voiceId: params.voiceId, nodeIds: params.nodeIds || [] }],
    diagnostics,
    previews: compatPreviews(nodes, params, score.tracks[0])
  }
}

/**
 * Compat mode previews: the primary Pattern shows the track rhythm, its Voice
 * the track notes; other Pattern / Length / Loop nodes their own value.
 */
function compatPreviews(nodes, params, track) {
  const previews = {}
  const quiet = { input: () => undefined, hasInput: () => false, diag: () => {} }
  for (const n of nodes) {
    const id = key(n.id)
    if (track && id === params.patternId) {
      previews[id] = { kind: 'pattern', length: track.length, steps: track.steps }
    } else if (track && id === params.voiceId) {
      previews[id] = trackPreview(track)
    } else if (['pattern', 'steps', 'length', 'loop'].includes(n.type)) {
      previews[id] = previewOf(NODE_EVALUATORS[n.type](n, quiet))
    }
    if (!previews[id]) delete previews[id]
  }
  return previews
}

function compileTracks(nodes, edges, tempo, diagnostics, diag) {
  const byId = new Map(nodes.map(n => [key(n.id), n]))
  const label = (n) => nodeLabel(n)

  // 1. Accept edges: typed, directed, acyclic, one edge per input.
  const inputs = new Map() // nodeId → Map(portId → { source, sourcePort, edgeId })
  const accepted = []
  for (const e of edges) {
    const s = byId.get(key(e.source))
    const t = byId.get(key(e.target))
    if (!s || !t) {
      const known = s || t
      diag(known ? known.id : null, 'error', 'invalid-edge', 'Conexión a un nodo que no existe', { edgeId: e.id })
      continue
    }
    const ports = resolvePorts(s, t, e.sourceHandle, e.targetHandle)
    if (!ports) {
      diag(t.id, 'error', 'invalid-edge', `Conexión inválida desde "${label(s)}": tipos incompatibles o dirección al revés`, { edgeId: e.id })
      continue
    }
    if (reaches(t.id, s.id, accepted)) {
      diag(t.id, 'error', 'cycle', 'Conexión ignorada: forma un ciclo', { edgeId: e.id })
      continue
    }
    const tid = key(t.id)
    if (!inputs.has(tid)) inputs.set(tid, new Map())
    const slots = inputs.get(tid)
    if (slots.has(ports.targetPort.id)) {
      diag(t.id, 'warning', 'input-taken', `La entrada "${ports.targetPort.label}" ya tiene una conexión; se ignora la otra`, { edgeId: e.id })
      continue
    }
    slots.set(ports.targetPort.id, { source: key(s.id), sourcePort: ports.sourcePort.id, edgeId: e.id })
    accepted.push({ source: key(s.id), target: tid })
  }

  // 2. Lazy, memoized evaluation of output ports.
  const memo = new Map()
  let silent = false // previews of nodes that feed no Output: no diagnostics
  const evaluate = (nodeId) => {
    if (memo.has(nodeId)) return memo.get(nodeId)
    memo.set(nodeId, null)
    const node = byId.get(nodeId)
    const fn = NODE_EVALUATORS[node?.type]
    const ctx = {
      input: (portId) => {
        const slot = inputs.get(nodeId)?.get(portId)
        return slot ? evaluate(slot.source) ?? undefined : undefined
      },
      hasInput: (portId) => !!inputs.get(nodeId)?.get(portId),
      diag: (level, code, message) => { if (!silent) diag(nodeId, level, code, message) }
    }
    const value = fn ? fn(node, ctx) ?? null : null
    memo.set(nodeId, value)
    return value
  }

  const upstreamOf = (nodeId) => {
    const seen = new Set()
    const stack = [nodeId]
    while (stack.length) {
      const id = stack.pop()
      for (const slot of inputs.get(id)?.values() || []) {
        if (!seen.has(slot.source)) { seen.add(slot.source); stack.push(slot.source) }
      }
    }
    return seen
  }

  // 3. One track per Output node.
  const tracks = []
  const trackInfo = []
  const feeding = new Set()
  for (const out of nodes.filter(n => n.type === 'output')) {
    const oid = key(out.id)
    const up = upstreamOf(oid)
    up.forEach(id => feeding.add(id))
    const slot = inputs.get(oid)?.get('audio')
    if (!slot) {
      diag(oid, 'warning', 'output-no-input', 'Salida sin voz: conectá una Voz')
      continue
    }
    const audio = evaluate(slot.source)
    if (!audio || audio.kind !== 'audio') {
      diag(oid, 'warning', 'track-no-notes', 'Lo que llega a esta Salida no tiene notas: revisá la cadena')
      continue
    }
    const mix = outputMix(out)
    const track = buildTrackFromNotes({
      id: oid,
      name: out.data?.name || audio.instrument,
      instrument: audio.instrument,
      length: audio.notes.length,
      notes: audio.notes.events,
      melody: audio.melody,
      octave: audio.octave,
      seed: audio.notes.seed,
      drumPiece: audio.drumPiece,
      volume: clamp(num(audio.volume, 0.8), 0, 1) * mix.volume,
      pan: clamp(num(audio.pan, 0) + mix.pan, -1, 1)
    }, tracks.length)
    // Only non-default mix fields are added (keeps old scores identical).
    if (audio.effects?.length) track.effects = audio.effects
    if (mix.mute) track.mute = true
    if (mix.solo) track.solo = true
    if (track.events.length === 0) diag(oid, 'info', 'track-silent', 'La pista no tiene golpes')
    tracks.push(track)
    trackInfo.push({ id: oid, outputId: oid, voiceId: audio.voiceId, nodeIds: [...up] })
  }

  // 4. Nodes that do not reach any Output.
  for (const n of nodes) {
    const id = key(n.id)
    if (n.type === 'output' || feeding.has(id) || !NODE_TYPES[n.type]) continue
    const hasEdges = edges.some(e => key(e.source) === id || key(e.target) === id)
    if (hasEdges) diag(id, 'info', 'unused', 'No llega a ninguna Salida: no suena')
  }
  if (tracks.length === 0) diag(null, 'info', 'no-tracks', 'Ninguna pista suena: conectá Patrón → Voz → Salida')

  // 5. Previews (Fase 4B): what comes out of every node, for the thumbnails.
  // Nodes that feed no Output are evaluated now, silently (the diagnostics
  // stay exactly as before); everything else is already memoized.
  silent = true
  for (const n of nodes) if (NODE_EVALUATORS[n.type]) evaluate(key(n.id))
  silent = false
  const previews = {}
  for (const n of nodes) {
    const p = previewOf(memo.get(key(n.id)))
    if (p) previews[key(n.id)] = p
  }
  for (const t of tracks) previews[t.id] = trackPreview(t)

  const score = buildScore({ tempo, tracks: [] })
  score.tracks = tracks
  return { score, mode: 'tracks', tracks: trackInfo, diagnostics, previews }
}

/**
 * Compact value of an output port for the node thumbnails (Fase 4B). Shares
 * the arrays of the compiled values (do not mutate).
 *   number  → { kind:'number', value }
 *   pattern → { kind:'pattern', length, steps }
 *   notes / audio → { kind:'notes', length, events: [{ step, time, midi, vel }] }
 */
export function previewOf(value) {
  if (value == null) return null
  if (typeof value === 'number') return { kind: 'number', value }
  if (value.kind === 'pattern') return { kind: 'pattern', length: value.length, steps: value.steps }
  if (value.kind === 'notes') return { kind: 'notes', length: value.length, events: value.events }
  if (value.kind === 'audio' && value.notes) return previewOf(value.notes)
  return null
}

/** Preview of a compiled track (Output nodes, compat voice): its real notes. */
function trackPreview(track) {
  return {
    kind: 'notes',
    length: track.length,
    events: track.events.map(e => ({ step: e.step, time: e.time, midi: e.midi, vel: e.velocity }))
  }
}

/** Mixer strip of an Output node: { volume 0..1 (default 1), pan -1..1, mute, solo }. */
export function outputMix(node) {
  const d = node?.data || {}
  return {
    volume: clamp(num(d.volume, 1), 0, 1),
    pan: clamp(num(d.pan, 0), -1, 1),
    mute: !!d.mute,
    solo: !!d.solo
  }
}

/** Group diagnostics by node id ({ [nodeId]: Diagnostic[] }); global ones under '' . */
export function diagnosticsByNode(diagnostics = []) {
  const map = {}
  for (const d of diagnostics) {
    const k = d.nodeId ?? ''
    if (!map[k]) map[k] = []
    map[k].push(d)
  }
  return map
}
