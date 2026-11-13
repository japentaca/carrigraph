import { describe, it, expect } from 'vitest'
import { compileGraph, diagnosticsByNode, chordTones, toNotes, legacyTrackSpec } from '../audio/graph/compile.js'
import { buildScore, scoreLength, eventsAtStep, unrollScore, buildMelody } from '../audio/engine/score.js'
import { createTransport } from '../audio/engine/transport.js'
import { buildMidiFromScore, parseMidi } from '../audio/midiWriter.js'

// --- tiny graph builder -----------------------------------------------------
const N = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data })
let edgeCounter = 0
const E = (source, sourceHandle, target, targetHandle) =>
  ({ id: `e${++edgeCounter}`, source, target, sourceHandle, targetHandle })

const pattern = (id, data = {}) => N(id, 'pattern', { algorithm: 'euclidean', density: 0.25, rotation: 0, seed: 0.5, ...data })
const voice = (id, data = {}) => N(id, 'voice', { instrument: 'Synth', octave: 4, melodyMode: 'fixed', root: 'C', scale: 'major', volume: 0.8, pan: 0, ...data })

/** Pattern(len) → Voice → Output */
function chain(prefix, { len = 16, patternData = {}, voiceData = {}, between = [] } = {}) {
  const nodes = [
    N(`${prefix}L`, 'length', { value: len }),
    pattern(`${prefix}P`, patternData),
    voice(`${prefix}V`, voiceData),
    N(`${prefix}O`, 'output')
  ]
  const edges = [E(`${prefix}L`, 'value', `${prefix}P`, 'length')]
  let last = { id: `${prefix}P`, port: 'pattern' }
  for (const node of between) {
    nodes.push(node)
    const inPort = { scale: 'in', chord: 'in', groove: 'in', transform: 'in', logic: 'a' }[node.type]
    edges.push(E(last.id, last.port, node.id, inPort))
    last = { id: node.id, port: node.type === 'transform' || node.type === 'logic' ? 'pattern' : 'notes' }
  }
  edges.push(E(last.id, last.port, `${prefix}V`, 'notes'))
  edges.push(E(`${prefix}V`, 'audio', `${prefix}O`, 'audio'))
  return { nodes, edges }
}

const merge = (...graphs) => ({ nodes: graphs.flatMap(g => g.nodes), edges: graphs.flatMap(g => g.edges) })
const hitSteps = (track) => [...new Set(track.events.map(e => e.step))]
const codes = (result, nodeId) => (diagnosticsByNode(result.diagnostics)[nodeId] || []).map(d => d.code)

describe('compileGraph — modo pistas', () => {
  it('una cadena Patrón → Voz → Salida es una pista con id estable (el de la Salida)', () => {
    const g = chain('a')
    const r = compileGraph(g.nodes, g.edges, { tempo: 100 })
    expect(r.mode).toBe('tracks')
    expect(r.score.tempo).toBe(100)
    expect(r.score.tracks).toHaveLength(1)
    const t = r.score.tracks[0]
    expect(t.id).toBe('aO')
    expect(t.instrument).toBe('Synth')
    expect(t.length).toBe(16)
    expect(hitSteps(t)).toEqual([3, 7, 11, 15]) // euclidean 4/16
    expect(r.tracks[0]).toMatchObject({ id: 'aO', outputId: 'aO', voiceId: 'aV' })
    expect(r.tracks[0].nodeIds.sort()).toEqual(['aL', 'aP', 'aV'])
  })

  it('una cadena simple suena igual que el modo compatibilidad (mismos eventos)', () => {
    const g = chain('a', { voiceData: { melodyMode: 'random' }, patternData: { algorithm: 'random', density: 0.5, seed: 0.37 } })
    const tracks = compileGraph(g.nodes, g.edges).score.tracks[0]
    const compatNodes = g.nodes.filter(n => n.type !== 'output')
    const compatEdges = g.edges.filter(e => e.target !== 'aO')
    const compat = compileGraph(compatNodes, compatEdges)
    expect(compat.mode).toBe('compat')
    expect(tracks.events.map(({ track, ...e }) => e)).toEqual(compat.score.tracks[0].events.map(({ track, ...e }) => e))
  })

  it('varias pistas simultáneas con longitudes distintas (polimetría)', () => {
    const g = merge(chain('a', { len: 12 }), chain('b', { len: 16, voiceData: { instrument: 'Drums' } }))
    const r = compileGraph(g.nodes, g.edges)
    expect(r.score.tracks.map(t => [t.id, t.length])).toEqual([['aO', 12], ['bO', 16]])
    expect(scoreLength(r.score)).toBe(16)
    // Each track cycles over its own length
    const a = r.score.tracks[0]
    expect(hitSteps(a)).toEqual([3, 7, 11])
    expect(eventsAtStep(a, 15)).toEqual(eventsAtStep(a, 3))
    expect(eventsAtStep(a, 15).length).toBeGreaterThan(0)
    // The transport schedules both tracks at once
    const played = []
    const output = { play: (track, note) => { played.push({ track: track.id, step: note.step }); return { end: 0, stop () {} } }, stopAll () {}, syncTracks () {}, prune () {} }
    let now = 0
    const transport = createTransport({ output, clock: () => now, timers: { setInterval: () => 1, clearInterval () {} }, lookahead: 10, startDelay: 0 })
    transport.start({ score: r.score, loop: true })
    const at3 = played.filter(p => p.step === 3).map(p => p.track).sort()
    expect(at3).toEqual(['aO', 'bO'])
    // a (12 steps) plays its first hit again at global step 15; b plays it at 19
    expect(played.some(p => p.track === 'aO' && p.step === 15)).toBe(true)
    expect(played.some(p => p.track === 'bO' && p.step === 15)).toBe(true) // b's 4th hit
    expect(played.some(p => p.track === 'aO' && p.step === 19)).toBe(true) // a: 19 % 12 = 7
    expect(played.some(p => p.track === 'bO' && p.step === 19)).toBe(true) // b: 19 % 16 = 3
    transport.stop()
  })

  it('MIDI y unroll recorren todas las pistas', () => {
    const g = merge(chain('a', { len: 12 }), chain('b', { len: 16, voiceData: { instrument: 'Bass' } }))
    const score = compileGraph(g.nodes, g.edges).score
    const unrolled = unrollScore(score)
    expect(new Set(unrolled.map(e => e.track))).toEqual(new Set(['aO', 'bO']))
    const midi = parseMidi(buildMidiFromScore(score))
    const channels = new Set(midi.notes.map(n => n.channel))
    expect(channels.size).toBe(2)
  })

  it('una voz que va a dos Salidas son dos pistas', () => {
    const g = chain('a')
    g.nodes.push(N('aO2', 'output'))
    g.edges.push(E('aV', 'audio', 'aO2', 'audio'))
    const r = compileGraph(g.nodes, g.edges)
    expect(r.score.tracks.map(t => t.id)).toEqual(['aO', 'aO2'])
  })

  it('la dirección importa: Voz → Patrón no forma pista y se informa', () => {
    const nodes = [pattern('p'), voice('v'), N('o', 'output')]
    const edges = [E('v', null, 'p', null), E('v', 'audio', 'o', 'audio')]
    const r = compileGraph(nodes, edges)
    expect(r.score.tracks).toHaveLength(0)
    expect(codes(r, 'p')).toContain('invalid-edge')
    expect(codes(r, 'v')).toContain('voice-no-input')
  })

  it('ignora aristas que forman ciclos', () => {
    const g = chain('a', { between: [N('t1', 'transform', { operation: 'reverse' }), N('t2', 'transform', { operation: 'reverse' })] })
    g.edges.push(E('t2', 'pattern', 't1', 'in')) // cycle t1 → t2 → t1 (t1's input is also taken)
    const r = compileGraph(g.nodes, g.edges)
    expect(r.score.tracks).toHaveLength(1)
    expect(codes(r, 't1')).toContain('cycle')
  })

  it('una entrada acepta una sola conexión', () => {
    const g = chain('a')
    g.nodes.push(N('L2', 'length', { value: 8 }))
    g.edges.push(E('L2', 'value', 'aP', 'length'))
    const r = compileGraph(g.nodes, g.edges)
    expect(r.score.tracks[0].length).toBe(16)
    expect(codes(r, 'aP')).toContain('input-taken')
  })

  it('diagnósticos: salida sin voz, nodo sin conectar, nodo que no llega a la salida', () => {
    const g = chain('a')
    g.nodes.push(N('lonely', 'pattern', { seed: 1 }), N('o2', 'output'), pattern('dangling'), voice('v2'))
    g.edges.push(E('dangling', 'pattern', 'v2', 'notes'))
    const r = compileGraph(g.nodes, g.edges)
    expect(codes(r, 'o2')).toEqual(expect.arrayContaining(['disconnected', 'output-no-input']))
    expect(codes(r, 'lonely')).toContain('disconnected')
    expect(codes(r, 'dangling')).toContain('unused')
    expect(codes(r, 'v2')).toContain('unused')
    for (const d of r.diagnostics) {
      expect(['error', 'warning', 'info']).toContain(d.level)
      expect(typeof d.message).toBe('string')
    }
  })

  it('las semillas son deterministas: sin semilla se deriva del id; 0 es válida', () => {
    const g1 = chain('a', { patternData: { algorithm: 'random', density: 0.5, seed: undefined } })
    const r1 = compileGraph(g1.nodes, g1.edges)
    const r2 = compileGraph(g1.nodes, g1.edges)
    expect(r1.score.tracks[0].steps).toEqual(r2.score.tracks[0].steps)

    const zero = chain('a', { patternData: { algorithm: 'random', density: 0.5, seed: 0 } })
    const z1 = compileGraph(zero.nodes, zero.edges).score.tracks[0].steps
    const z2 = compileGraph(zero.nodes, zero.edges).score.tracks[0].steps
    expect(z1).toEqual(z2)
  })

  it('un grafo vacío no produce pistas', () => {
    const r = compileGraph([], [])
    expect(r.mode).toBe('empty')
    expect(r.score.tracks).toEqual([])
  })
})

describe('compileGraph — modo compatibilidad (sin Salida)', () => {
  it('se comporta como el editor anterior: primer patrón + Length/Loop/Voice conectados', () => {
    const nodes = [pattern('p', { density: 0.5 }), N('l', 'length', { value: 8 }), N('lp', 'loop', { value: 4 }), voice('v', { instrument: 'Bass' })]
    const edges = [E('l', 'length-output', 'p', 'length-input'), E('v', 'output', 'p', 'voice'), E('lp', null, 'p', null)]
    const r = compileGraph(nodes, edges)
    expect(r.mode).toBe('compat')
    expect(r.score.tracks).toHaveLength(1)
    const t = r.score.tracks[0]
    expect(t.id).toBe('track-1')
    expect(t.instrument).toBe('Bass')
    expect(t.length).toBe(8)
    expect(t.steps.slice(0, 4)).toEqual(t.steps.slice(4, 8))
    expect(r.diagnostics.find(d => d.nodeId === null).code).toBe('compat-mode')
  })

  it('los nodos nuevos avisan que necesitan una Salida', () => {
    const nodes = [pattern('p'), voice('v'), N('s', 'scale')]
    const edges = [E('p', 'pattern', 's', 'in'), E('s', 'notes', 'v', 'notes')]
    const r = compileGraph(nodes, edges)
    expect(codes(r, 's')).toContain('needs-output')
  })

  it('PatternNode sin semilla ya no usa Math.random()', () => {
    const nodes = [N('p', 'pattern', { algorithm: 'random', density: 0.5 }), voice('v')]
    const edges = [E('p', 'pattern', 'v', 'notes')]
    expect(legacyTrackSpec(nodes, edges).pattern.seed).toBe(legacyTrackSpec(nodes, edges).pattern.seed)
    expect(compileGraph(nodes, edges).score.tracks[0].steps).toEqual(compileGraph(nodes, edges).score.tracks[0].steps)
  })
})

describe('nodos de dominio patrón', () => {
  const stepsOf = (between, opts = {}) => {
    const g = chain('a', { between, ...opts })
    return compileGraph(g.nodes, g.edges).score.tracks[0]
  }

  it('Step Pattern: la grilla dibujada define golpes y largo', () => {
    const steps = [true, false, false, true, false, false, true, false]
    const nodes = [N('s', 'steps', { steps }), voice('v'), N('o', 'output')]
    const edges = [E('s', 'pattern', 'v', 'notes'), E('v', 'audio', 'o', 'audio')]
    const t = compileGraph(nodes, edges).score.tracks[0]
    expect(t.length).toBe(8)
    expect(t.steps).toEqual(steps)
  })

  it('Pattern Logic: AND, OR, XOR, NOT', () => {
    const A = [true, true, false, false]
    const B = [true, false, true, false]
    const run = (operation, withB = true) => {
      const nodes = [N('a', 'steps', { steps: A }), N('b', 'steps', { steps: B }), N('x', 'logic', { operation }), voice('v'), N('o', 'output')]
      const edges = [E('a', 'pattern', 'x', 'a'), E('x', 'pattern', 'v', 'notes'), E('v', 'audio', 'o', 'audio')]
      if (withB) edges.push(E('b', 'pattern', 'x', 'b'))
      return compileGraph(nodes, edges)
    }
    expect(run('and').score.tracks[0].steps).toEqual([true, false, false, false])
    expect(run('or').score.tracks[0].steps).toEqual([true, true, true, false])
    expect(run('xor').score.tracks[0].steps).toEqual([false, true, true, false])
    expect(run('not', false).score.tracks[0].steps).toEqual([false, false, true, true])
    const missing = run('and', false)
    expect(missing.score.tracks[0].steps).toEqual(A)
    expect(codes(missing, 'x')).toContain('missing-input')
  })

  it('Pattern Logic con largos distintos: cicla el más corto', () => {
    const nodes = [N('a', 'steps', { steps: [true, false] }), N('b', 'steps', { steps: [true, false, false] }), N('x', 'logic', { operation: 'or' }), voice('v'), N('o', 'output')]
    const edges = [E('a', 'pattern', 'x', 'a'), E('b', 'pattern', 'x', 'b'), E('x', 'pattern', 'v', 'notes'), E('v', 'audio', 'o', 'audio')]
    expect(compileGraph(nodes, edges).score.tracks[0].steps).toEqual([true, false, true])
  })

  it('Transform: invertir, reversa, rotar, doble y media velocidad, probabilidad', () => {
    const base = [true, false, false, false, true, false, true, false]
    const run = (data) => {
      const nodes = [N('s', 'steps', { steps: base }), N('t', 'transform', data), voice('v'), N('o', 'output')]
      const edges = [E('s', 'pattern', 't', 'in'), E('t', 'pattern', 'v', 'notes'), E('v', 'audio', 'o', 'audio')]
      return compileGraph(nodes, edges).score.tracks[0].steps
    }
    expect(run({ operation: 'invert' })).toEqual(base.map(x => !x))
    expect(run({ operation: 'reverse' })).toEqual(base.slice().reverse())
    expect(run({ operation: 'rotate', amount: 1 })).toEqual([false, true, false, false, false, true, false, true])
    expect(run({ operation: 'rotate', amount: -1 })).toEqual([false, false, false, true, false, true, false, true])
    expect(run({ operation: 'double' })).toEqual([true, false, true, true])
    const half = run({ operation: 'half' })
    expect(half).toHaveLength(16)
    expect(half.map((x, i) => (x ? i : -1)).filter(i => i >= 0)).toEqual([0, 8, 12])
    const p1 = run({ operation: 'probability', probability: 0.5, seed: 0.3 })
    expect(run({ operation: 'probability', probability: 0.5, seed: 0.3 })).toEqual(p1)
    expect(p1.every((x, i) => !x || base[i])).toBe(true) // only removes hits
    expect(run({ operation: 'probability', probability: 1, seed: 0.3 })).toEqual(base)
    expect(run({ operation: 'probability', probability: 0, seed: 0.3 }).some(Boolean)).toBe(false)
  })

  it('Scale / Melody: asigna alturas de la escala y la voz las respeta', () => {
    const t = stepsOf([N('s', 'scale', { root: 'D', scale: 'minor', mode: 'ascending', octave: 3, range: 1, seed: 0.1 })], { patternData: { density: 1 } })
    const expected = buildMelody(16, { mode: 'ascending', root: 'D', scale: 'minor', octave: 3, range: 1 })
    expect(t.events.map(e => e.midi)).toEqual(expected)
  })

  it('Scale random: misma semilla → misma melodía; otra semilla → otra', () => {
    const mk = (seed) => stepsOf([N('s', 'scale', { mode: 'random', scale: 'major', seed, range: 2 })], { patternData: { density: 1 } }).events.map(e => e.midi)
    expect(mk(0.2)).toEqual(mk(0.2))
    expect(mk(0.2)).not.toEqual(mk(0.9))
  })

  it('sin Scale, la voz usa su melodía por defecto (compatibilidad)', () => {
    const t = stepsOf([], { voiceData: { melodyMode: 'fixed', root: 'E', octave: 4 } })
    expect(new Set(t.events.map(e => e.midi))).toEqual(new Set([64]))
  })

  it('Chord: tríada, séptima y quintas sobre la escala', () => {
    expect(chordTones(60, { root: 'C', scale: 'major' }, 'triad')).toEqual([60, 64, 67])
    expect(chordTones(62, { root: 'C', scale: 'major' }, 'triad')).toEqual([62, 65, 69]) // D minor
    expect(chordTones(67, { root: 'C', scale: 'major' }, 'seventh')).toEqual([67, 71, 74, 77]) // G7
    expect(chordTones(57, { root: 'A', scale: 'minor' }, 'triad')).toEqual([57, 60, 64]) // A minor
    expect(chordTones(60, { root: 'C', scale: 'major' }, 'fifths')).toEqual([60, 67, 72])
    expect(chordTones(60, { root: 'C', scale: 'chromatic' }, 'triad')).toEqual([60, 64, 67])

    const t = stepsOf([
      N('s', 'scale', { root: 'C', scale: 'major', mode: 'fixed', octave: 4 }),
      N('c', 'chord', { chord: 'triad' })
    ])
    const first = t.events.filter(e => e.step === 3).map(e => e.midi)
    expect(first).toEqual([60, 64, 67])
    expect(t.events).toHaveLength(12)
    // chord notes share the step's duration
    expect(new Set(t.events.filter(e => e.step === 3).map(e => e.duration)).size).toBe(1)
  })

  it('Chord sin Scale avisa y deja pasar las notas', () => {
    const g = chain('a', { between: [N('c', 'chord', { chord: 'triad' })] })
    const r = compileGraph(g.nodes, g.edges)
    expect(codes(r, 'c')).toContain('needs-scale')
    expect(r.score.tracks[0].events).toHaveLength(4)
  })

  it('Groove: swing retrasa los pasos impares, acentos cada N, determinista', () => {
    const groove = (data) => stepsOf([N('g', 'groove', { swing: 0, timing: 0, velocity: 0, accentEvery: 0, accentAmount: 0, seed: 0.4, ...data })], { patternData: { density: 1 } })
    const plain = groove({})
    expect(plain.events.every(e => e.time === e.step)).toBe(true)

    const swung = groove({ swing: 0.5 })
    for (const e of swung.events) expect(e.time - e.step).toBeCloseTo(e.step % 2 === 1 ? 0.25 : 0)

    const accented = groove({ accentEvery: 3, accentAmount: 0.5 })
    const v = (step) => accented.events.find(e => e.step === step).velocity
    expect(v(3)).toBeGreaterThan(v(2)) // step 3: accent; step 2: not (same beat accent group)

    const human = groove({ timing: 1, velocity: 1 })
    expect(groove({ timing: 1, velocity: 1 })).toEqual(human)
    for (const e of human.events) {
      expect(e.time).toBeGreaterThanOrEqual(e.step)
      expect(e.time).toBeLessThan(e.step + 1)
      expect(e.velocity).toBeGreaterThanOrEqual(0)
      expect(e.velocity).toBeLessThanOrEqual(1)
    }
    expect(human.events.some(e => e.time !== e.step)).toBe(true)
  })

  it('Groove funciona en batería (patrón → groove → voz Drums)', () => {
    const t = stepsOf([N('g', 'groove', { swing: 1, timing: 0, velocity: 0, accentEvery: 0, seed: 1 })], { patternData: { density: 1 }, voiceData: { instrument: 'Drums' } })
    expect(t.events.find(e => e.step === 1).time).toBeCloseTo(1.5)
    expect(t.events.find(e => e.step === 0).midi).toBe(36)
  })

  it('Pattern con autómata celular y ruido produce pistas deterministas', () => {
    for (const algorithm of ['cellular', 'noise']) {
      const a = stepsOf([], { patternData: { algorithm, density: 0.5, seed: 0.77, rule: 90 } })
      const b = stepsOf([], { patternData: { algorithm, density: 0.5, seed: 0.77, rule: 90 } })
      expect(a.steps).toEqual(b.steps)
      expect(a.steps.some(Boolean)).toBe(true)
    }
  })
})

describe('utilidades', () => {
  it('toNotes convierte un patrón en notas sin altura', () => {
    const n = toNotes({ kind: 'pattern', length: 4, steps: [true, false, true, false], seed: 3 })
    expect(n.events).toEqual([{ step: 0, time: 0, midi: null, vel: 1 }, { step: 2, time: 2, midi: null, vel: 1 }])
    expect(toNotes(null)).toBe(null)
  })

  it('el buildScore viejo y el compilador comparten la forma de la partitura', () => {
    const g = chain('a')
    const s = compileGraph(g.nodes, g.edges).score
    const ref = buildScore({ tempo: 120, tracks: [] })
    expect(Object.keys(s).sort()).toEqual(Object.keys(ref).sort())
    expect(Object.keys(s.tracks[0]).sort()).toEqual(['events', 'id', 'instrument', 'length', 'name', 'pan', 'steps', 'volume'])
    expect(Object.keys(s.tracks[0].events[0]).sort()).toEqual(['duration', 'midi', 'step', 'time', 'track', 'velocity'])
  })
})
