import { describe, it, expect } from 'vitest'
import { compileGraph, diagnosticsByNode, effectsFromNode, outputMix } from '../audio/graph/compile.js'
import { migrateProject, migrateV2toV3, CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'
import { createNodeData, NODE_TYPES, NODE_TYPE_ORDER, GRAPH_ONLY_TYPES, effectsDefaults } from '../audio/graph/nodeTypes.js'
import { isValidConnection } from '../audio/graph/connections.js'
import { buildMidiFromScore, parseMidi, assignChannels, GM_PROGRAMS } from '../audio/midiWriter.js'
import { buildTrackFromNotes, unrollScore, isTrackAudible } from '../audio/engine/score.js'
import { BUILT_IN_PRESETS, MULTITRACK_PRESETS } from '../stores/usePresetStore.js'
import { laneLayout, pitchLayout, defaultCellWidth, rulerMarks, followScroll, MAX_LANE_NOTES } from '../components/timeline/pianoRoll.js'
import { stemFileNames } from '../composables/usePlayback.js'

const N = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data })
let n = 0
const E = (source, sourceHandle, target, targetHandle) => ({ id: `e${++n}`, source, target, sourceHandle, targetHandle })

/** Steps → Voice → [effects…] → Output */
function track(prefix, { steps = 'x...x...x...x...', voice = {}, effects = [], output = {} } = {}) {
  const nodes = [
    N(`${prefix}S`, 'steps', { steps: Array.from(steps, c => c === 'x') }),
    N(`${prefix}V`, 'voice', { instrument: 'Synth', volume: 0.8, pan: 0, melodyMode: 'fixed', ...voice }),
    N(`${prefix}O`, 'output', output)
  ]
  const edges = [E(`${prefix}S`, 'pattern', `${prefix}V`, 'notes')]
  let last = `${prefix}V`
  effects.forEach((data, i) => {
    const id = `${prefix}F${i}`
    nodes.push(N(id, 'effects', data))
    edges.push(E(last, 'audio', id, 'in'))
    last = id
  })
  edges.push(E(last, 'audio', `${prefix}O`, 'audio'))
  return { nodes, edges }
}
const merge = (...g) => ({ nodes: g.flatMap(x => x.nodes), edges: g.flatMap(x => x.edges) })
const onlyReverb = { reverb: { enabled: true, amount: 0.4, decay: 3 } }

describe('nodo Efectos en el compilador', () => {
  it('está registrado con puertos de audio y forma parte de la paleta', () => {
    expect(NODE_TYPES.effects.inputs).toEqual([{ id: 'in', type: 'audio', label: 'Audio' }])
    expect(NODE_TYPES.effects.outputs[0].type).toBe('audio')
    expect(NODE_TYPE_ORDER.indexOf('effects')).toBe(NODE_TYPE_ORDER.indexOf('voice') + 1)
    expect(GRAPH_ONLY_TYPES).toContain('effects')
    const d = createNodeData('effects')
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['distortion', 'filter', 'delay', 'reverb']))
    expect(d.reverb.enabled).toBe(true)
  })

  it('Voz → Efectos → Salida pone los efectos activados en la pista, con ids estables', () => {
    const g = track('a', { effects: [{ ...effectsDefaults(), filter: { enabled: true, amount: 1, mode: 'highpass', cutoff: 500, resonance: 2 } }] })
    const r = compileGraph(g.nodes, g.edges)
    expect(r.mode).toBe('tracks')
    const fx = r.score.tracks[0].effects
    expect(fx.map(e => e.type)).toEqual(['filter', 'reverb']) // fixed order
    expect(fx[0]).toMatchObject({ id: 'aF0:filter', mode: 'highpass', cutoff: 500, resonance: 2 })
    expect(compileGraph(g.nodes, g.edges).score.tracks[0].effects).toEqual(fx)
    expect(r.diagnostics.filter(d => d.level !== 'info')).toEqual([])
  })

  it('dos nodos Efectos encadenados suman en orden; los apagados no cuentan', () => {
    const first = { delay: { enabled: true, amount: 0.3, time: 0.2, feedback: 0.3 }, reverb: { enabled: false } }
    const g = track('b', { effects: [first, onlyReverb] })
    const fx = compileGraph(g.nodes, g.edges).score.tracks[0].effects
    expect(fx.map(e => e.id)).toEqual(['bF0:delay', 'bF1:reverb'])
  })

  it('una voz hacia dos salidas, una con efectos y otra sin', () => {
    const g = track('c', { effects: [onlyReverb] })
    g.nodes.push(N('c2', 'output', { name: 'seca' }))
    g.edges.push(E('cV', 'audio', 'c2', 'audio'))
    const r = compileGraph(g.nodes, g.edges)
    const byId = Object.fromEntries(r.score.tracks.map(t => [t.id, t]))
    expect(byId.cO.effects).toHaveLength(1)
    expect(byId.c2.effects).toBeUndefined()
  })

  it('diagnósticos: sin entrada, sin efectos activos, y sin Salida (modo compatibilidad)', () => {
    const g = track('d', { effects: [{ reverb: { enabled: false } }] })
    const r = compileGraph(g.nodes, g.edges)
    expect(diagnosticsByNode(r.diagnostics).dF0.map(d => d.code)).toContain('no-effects')
    expect(r.score.tracks[0].effects).toBeUndefined()

    const lonely = [N('x', 'effects', onlyReverb), N('o', 'output')]
    const r2 = compileGraph(lonely, [E('x', 'audio', 'o', 'audio')])
    expect(diagnosticsByNode(r2.diagnostics).x.map(d => d.code)).toContain('missing-input')

    const compat = compileGraph([N('p', 'pattern', { seed: 1 }), N('v', 'voice'), N('f', 'effects', onlyReverb)], [E('p', 'pattern', 'v', 'notes'), E('v', 'audio', 'f', 'in')])
    expect(compat.mode).toBe('compat')
    expect(diagnosticsByNode(compat.diagnostics).f.map(d => d.code)).toContain('needs-output')
  })

  it('Patrón → Efectos es una conexión inválida (tipos)', () => {
    const nodes = [N('p', 'steps'), N('f', 'effects')]
    expect(isValidConnection({ source: 'p', sourceHandle: 'pattern', target: 'f', targetHandle: 'in' }, nodes, [])).toBe(false)
  })

  it('effectsFromNode tolera datos viejos o rotos', () => {
    expect(effectsFromNode({ id: 'z', data: null })).toEqual([])
    expect(effectsFromNode({ id: 'z', data: { reverb: { enabled: true, amount: 9 } } })[0]).toMatchObject({ amount: 1, decay: 2.5 })
  })
})

describe('mezcla en la Salida', () => {
  it('volumen multiplica el de la voz, paneo se suma (acotado), mute y solo pasan a la pista', () => {
    const g = merge(
      track('a', { voice: { volume: 0.8, pan: 0.6 }, output: { volume: 0.5, pan: 0.7, mute: true } }),
      track('b', { output: { solo: true } })
    )
    const [a, b] = compileGraph(g.nodes, g.edges).score.tracks
    expect(a.volume).toBeCloseTo(0.4)
    expect(a.pan).toBe(1)
    expect(a.mute).toBe(true)
    expect(b.solo).toBe(true)
    expect(isTrackAudible(a, [a, b])).toBe(false)
    expect(isTrackAudible(b, [a, b])).toBe(true)
  })

  it('una Salida con valores por defecto deja la pista igual que antes (sin campos nuevos)', () => {
    const old = track('a')
    old.nodes[2].data = {} // esquema 2
    const now = track('a', { output: NODE_TYPES.output.defaults() })
    expect(compileGraph(now.nodes, now.edges).score).toEqual(compileGraph(old.nodes, old.edges).score)
    const t = compileGraph(now.nodes, now.edges).score.tracks[0]
    expect('mute' in t || 'solo' in t || 'effects' in t).toBe(false)
  })

  it('outputMix con datos raros', () => {
    expect(outputMix({ data: { volume: 'x', pan: -5 } })).toEqual({ volume: 1, pan: -1, mute: false, solo: false })
    expect(outputMix(null)).toEqual({ volume: 1, pan: 0, mute: false, solo: false })
  })
})

describe('migración al esquema 3', () => {
  const v2 = () => ({
    name: 'v2',
    metadata: { schemaVersion: 2 },
    nodes: [
      N('s', 'steps', { steps: [true, false, true, false] }),
      N('v', 'voice', { instrument: 'Piano', volume: 0.7, effects: ['reverb', 'delay'] }),
      N('o', 'output', { name: 'Uno' })
    ],
    edges: [E('s', 'pattern', 'v', 'notes'), E('v', 'audio', 'o', 'audio')]
  })

  it('agrega la mezcla a las Salidas y descarta los efectos viejos de la Voz', () => {
    const original = v2()
    const frozen = JSON.stringify(original)
    const p = migrateProject(original)
    expect(JSON.stringify(original)).toBe(frozen)
    expect(CURRENT_SCHEMA_VERSION).toBe(3)
    expect(p.metadata.schemaVersion).toBe(3)
    expect(p.nodes.find(x => x.id === 'o').data).toEqual({ name: 'Uno', volume: 1, pan: 0, mute: false, solo: false })
    expect('effects' in p.nodes.find(x => x.id === 'v').data).toBe(false)
    expect(p.edges).toEqual(original.edges)
  })

  it('suena igual antes y después, y es idempotente', () => {
    const before = v2()
    const after = migrateProject(before)
    expect(compileGraph(after.nodes, after.edges).score).toEqual(compileGraph(before.nodes, before.edges).score)
    expect(migrateProject(after)).toEqual(after)
  })

  it('respeta mezcla ya guardada y tolera nodos raros', () => {
    const nodes = migrateV2toV3([N('o', 'output', { volume: 0.3, solo: true }), null, { id: 'q', type: 'voice' }])
    expect(nodes[0].data).toEqual({ volume: 0.3, pan: 0, mute: false, solo: true })
    expect(nodes[1]).toBe(null)
    expect(nodes[2].data).toEqual({})
  })

  it('un proyecto del esquema 1 llega directo al 3', () => {
    const p = migrateProject({ nodes: [N('o', 'output')], edges: [] })
    expect(p.metadata.schemaVersion).toBe(3)
    expect(p.nodes[0].data.mute).toBe(false)
  })
})

describe('MIDI Tipo 1 multipista', () => {
  const score = () => {
    const mk = (id, instrument, name, notes) => buildTrackFromNotes({ id, instrument, name, length: 16, notes, melody: { mode: 'fixed' } })
    return {
      tempo: 96,
      stepsPerBeat: 4,
      tracks: [
        mk('bass', 'Bass', 'Bajo', [{ step: 0, midi: 40 }, { step: 8, midi: 43 }]),
        mk('kit', 'Drums', 'Batería', [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }]),
        mk('lead', 'Synth', 'Ñandú', [{ step: 2, midi: 72 }])
      ]
    }
  }

  it('una pista de control con tempo y una pista con nombre y canal por cada pista del grafo', () => {
    const s = score()
    const midi = parseMidi(buildMidiFromScore(s, { name: 'Mi tema' }))
    expect(midi.format).toBe(1)
    expect(midi.ntracks).toBe(4)
    expect(midi.tempo).toBe(96)
    expect(midi.timeSignature).toEqual([4, 4])
    expect(midi.tracks.map(t => t.name)).toEqual(['Mi tema', 'Bajo', 'Batería', 'Ñandú'])
    expect(midi.tracks[0].notes).toEqual([])
    expect(midi.tracks[1].notes.every(x => x.channel === 0)).toBe(true)
    expect(midi.tracks[2].notes.every(x => x.channel === 9)).toBe(true)
    expect(midi.tracks[3].notes.every(x => x.channel === 1)).toBe(true)
    expect(midi.tracks.map(t => t.notes.length)).toEqual([0, 2, 4, 1])
    expect(midi.tracks[2].programs).toEqual([]) // drums: no program change
    expect(midi.tracks[3].programs).toEqual([{ channel: 1, program: GM_PROGRAMS.Synth }])
    expect(midi.tracks[1].notes.map(x => [x.note, x.start])).toEqual([[40, 0], [43, 8 * 120]])
  })

  it('pistas de largos distintos ciclan sobre el largo de la más larga, y repeticiones', () => {
    const s = score()
    s.tracks[0] = buildTrackFromNotes({ id: 'bass', instrument: 'Bass', length: 12, notes: [{ step: 0, midi: 40 }] })
    const midi = parseMidi(buildMidiFromScore(s, { repeats: 2 }))
    expect(midi.tracks[1].notes.map(x => x.start / 120)).toEqual([0, 12, 24])
    expect(midi.tracks[1].notes).toHaveLength(unrollScore(s, { repeats: 2 }).filter(e => e.track === 'bass').length)
  })

  it('canales: batería siempre en el 10; más de 15 pistas con altura comparten canal sin usar el 10', () => {
    const tracks = Array.from({ length: 17 }, (_, i) => ({ id: `t${i}`, instrument: i === 3 ? 'Drums' : 'Piano' }))
    const ch = assignChannels(tracks)
    expect(ch.get('t3')).toBe(9)
    const melodic = tracks.filter(t => t.instrument !== 'Drums').map(t => ch.get(t.id))
    expect(melodic).not.toContain(9)
    expect(melodic.slice(0, 15)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15])
    expect(melodic[15]).toBe(0)
  })
})

describe('presets multipista', () => {
  it('son 5, en el esquema actual, compilan en modo pistas con varias pistas y sin advertencias', () => {
    expect(MULTITRACK_PRESETS.map(p => p.name)).toEqual(['Batería completa', 'Techno', 'Polirritmo 3:4', 'Ambient generativo', 'Bajo + arpegio'])
    for (const p of MULTITRACK_PRESETS) {
      expect(BUILT_IN_PRESETS).toContain(p)
      expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      const r = compileGraph(p.nodes, p.edges)
      expect(r.mode).toBe('tracks')
      expect(r.score.tracks.length).toBeGreaterThanOrEqual(2)
      expect(r.score.tracks.every(t => t.events.length > 0)).toBe(true)
      expect(r.diagnostics.filter(d => d.level !== 'info')).toEqual([])
      expect(r.diagnostics.filter(d => d.code === 'disconnected' || d.code === 'unused')).toEqual([])
      expect(compileGraph(p.nodes, p.edges).score).toEqual(r.score) // determinista
      expect(migrateProject({ nodes: p.nodes, edges: p.edges, metadata: { schemaVersion: p.schemaVersion } }).nodes).toEqual(p.nodes)
      for (const e of p.edges) expect(isValidConnection(e, p.nodes, p.edges.filter(x => x !== e))).toBe(true)
    }
  })

  it('usan los nodos nuevos: efectos, mezcla y largos distintos', () => {
    const tracksOf = (id) => compileGraph(...(({ nodes, edges }) => [nodes, edges])(MULTITRACK_PRESETS.find(p => p.id === id))).score.tracks
    expect(MULTITRACK_PRESETS.every(p => p.nodes.some(x => x.type === 'effects'))).toBe(true)
    const poly = tracksOf('preset-poly-3-4')
    expect(poly.map(t => t.length)).toEqual([12, 12, 12])
    expect(poly.map(t => new Set(t.events.map(e => e.step)).size)).toEqual([3, 4, 12])
    const amb = tracksOf('preset-ambient-gen')
    expect(amb.map(t => t.length)).toEqual([64, 48, 40])
    expect(amb.every(t => t.effects?.some(e => e.type === 'reverb'))).toBe(true)
    const techno = tracksOf('preset-techno')
    expect(techno.map(t => t.name)).toEqual(['Bombo', 'Hat abierto', 'Bajo', 'Acordes'])
    expect(techno[2].effects.map(e => e.type)).toEqual(['distortion', 'filter'])
    expect(tracksOf('preset-full-kit').map(t => t.events[0].midi)).toEqual([36, 38, 42])
  })
})

describe('piano roll (layout)', () => {
  const t = (length, events, instrument = 'Synth') => ({ id: 'x', instrument, length, events })
  const ev = (step, midi, extra = {}) => ({ step, time: step, duration: 0.9, midi, velocity: 0.8, ...extra })

  it('filas de altura: rango cromático (mínimo 5) o una fila por pieza de batería', () => {
    const p = pitchLayout(t(16, [ev(0, 60), ev(4, 67)]))
    expect(p.rows).toBe(8)
    expect(p.rowOf(60)).toBe(0)
    expect(p.rowOf(67)).toBe(7)
    expect(pitchLayout(t(16, [ev(0, 60)])).rows).toBe(5)
    const drums = pitchLayout(t(16, [ev(0, 36), ev(4, 38), ev(2, 42)], 'Drums'))
    expect(drums.rows).toBe(3)
    expect(drums.rowOf(42)).toBe(2)
    expect(drums.label(38)).toBe('Redoblante')
  })

  it('notas con posición, duración y fila; groove desplaza dentro del paso', () => {
    const lay = laneLayout(t(16, [ev(0, 60), ev(5, 62, { time: 5.25, duration: 2 })]))
    expect(lay.notes).toHaveLength(2)
    expect(lay.notes[1]).toMatchObject({ x: 5.25, w: 2, row: 3, ghost: false, step: 5 }) // rango 59..63 (mínimo 5 filas, centrado)
    expect(lay.notes[1].title).toMatch(/D4 · paso 6/)
  })

  it('pistas más cortas se repiten como "fantasma" hasta la más larga (polimetría)', () => {
    const lay = laneLayout(t(12, [ev(0, 60), ev(6, 62)]), { maxLength: 16 })
    expect(lay.notes.map(x => [x.x, x.ghost])).toEqual([[0, false], [6, false], [12, true]])
  })

  it('512 pasos: todas las notas, ancho usable y regla por compás', () => {
    const events = Array.from({ length: 512 }, (_, i) => ev(i, 48 + (i % 24)))
    const lay = laneLayout(t(512, events), { maxLength: 512 })
    expect(lay.notes).toHaveLength(512)
    expect(lay.truncated).toBe(false)
    expect(Math.max(...lay.notes.map(x => x.x))).toBe(511)
    expect(512 * defaultCellWidth(512)).toBeLessThanOrEqual(4096)
    expect(defaultCellWidth(16)).toBeGreaterThan(defaultCellWidth(512))
    expect(rulerMarks(512)).toHaveLength(32)
    // a 1-step track against 512 steps stays bounded
    const tiny = laneLayout(t(1, [ev(0, 60), ev(0, 64), ev(0, 67)]), { maxLength: 512, maxNotes: 1000 })
    expect(tiny.notes.length).toBe(1000)
    expect(tiny.truncated).toBe(true)
    expect(MAX_LANE_NOTES).toBeGreaterThanOrEqual(2048)
  })

  it('seguir al cursor', () => {
    expect(followScroll(100, 0, 500)).toBe(null)
    expect(followScroll(600, 0, 500)).toBe(560)
    expect(followScroll(10, 300, 500)).toBe(0)
  })
})

describe('nombres de archivo de los stems', () => {
  it('numerados, con el nombre de la pista y sin caracteres inválidos', () => {
    expect(stemFileNames('Mi: tema', [{ name: 'Bajo' }, { name: 'A/B' }, { instrument: 'Drums' }]))
      .toEqual(['Mi_ tema - 01 Bajo.wav', 'Mi_ tema - 02 A_B.wav', 'Mi_ tema - 03 Drums.wav'])
  })
})
