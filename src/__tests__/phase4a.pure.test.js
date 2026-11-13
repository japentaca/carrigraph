// Fase 4A — pure helpers: persisted graph / signature, auto layout, transport
// helpers (position, tap tempo), context menu placement, level meter, global
// swing, save status label, version summary, node registry.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import {
  persistedNode, persistedEdge, graphSignature, changedKeys, settingsFromMetadata, DEFAULT_SETTINGS
} from '../editor/graphState.js'
import { autoLayoutPositions } from '../editor/layout.js'
import { formatPosition, createTapTempo } from '../editor/transport.js'
import { menuPlacement } from '../composables/useContextMenu.js'
import { measureLevel, toDb, meterPosition, createLevelMeter, METER_FLOOR_DB } from '../audio/engine/meter.js'
import { applySwing, MAX_SWING_OFFSET } from '../audio/engine/score.js'
import { saveStatusLabel } from '../composables/useAutosave.js'
import { versionSummary } from '../composables/useVersionHistory.js'
import { compileWithSwing, scoreFromGraph } from '../composables/usePlayback.js'
import { compileGraph } from '../audio/graph/compile.js'
import { NODE_TYPES, NODE_TYPE_ORDER } from '../audio/graph/nodeTypes.js'
import {
  NODE_REGISTRY, nodeTypeKeys, getNodeComponent, getNodeEntry, paletteEntries, nodeDisplayName, NODE_COMPONENTS
} from '../components/nodes/nodeRegistry.js'
import { NODE_COMPONENTS as LEGACY_COMPONENTS } from '../components/nodes/index.js'
import { MULTITRACK_PRESETS, BUILT_IN_PRESETS } from '../stores/usePresetStore'
import { FakeAudioContext } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify([...MULTITRACK_PRESETS, ...BUILT_IN_PRESETS].find(p => p.id === id)))

describe('graphState: what is saved and what counts as a change', () => {
  // What Vue Flow writes back into the store through v-model
  const graphNode = {
    id: 'a', type: 'pattern', position: { x: 10, y: 20 }, data: { density: 0.5 },
    computedPosition: { x: 10, y: 20, z: 0 }, dimensions: { width: 200, height: 100 },
    handleBounds: { source: [], target: [] }, selected: true, dragging: false, resizing: false,
    initialized: true, isParent: false, events: {}, draggable: undefined
  }
  const graphEdge = {
    id: 'e', source: 'a', target: 'b', sourceHandle: 'pattern', targetHandle: 'notes',
    style: { stroke: '#f59e0b' }, sourceNode: graphNode, targetNode: { id: 'b' }, selected: false, events: {},
    sourceX: 1, sourceY: 2, targetX: 3, targetY: 4
  }

  it('persistedNode / persistedEdge drop Vue Flow runtime fields (no whole nodes inside edges)', () => {
    expect(persistedNode(graphNode)).toEqual({ id: 'a', type: 'pattern', position: { x: 10, y: 20 }, data: { density: 0.5 } })
    expect(persistedEdge(graphEdge)).toEqual({
      id: 'e', source: 'a', target: 'b', sourceHandle: 'pattern', targetHandle: 'notes', style: { stroke: '#f59e0b' }
    })
    // deep copies
    const p = persistedNode(graphNode)
    p.data.density = 1
    expect(graphNode.data.density).toBe(0.5)
  })

  it('selection, sizes and other runtime state do not change the signature; data, position, edges and settings do', () => {
    const base = graphSignature([graphNode], [graphEdge], DEFAULT_SETTINGS)
    expect(graphSignature([{ ...graphNode, selected: false, dimensions: { width: 1, height: 1 } }], [{ ...graphEdge, selected: true }])).toBe(base)
    expect(graphSignature([{ ...graphNode, data: { density: 0.6 } }], [graphEdge])).not.toBe(base)
    expect(graphSignature([{ ...graphNode, position: { x: 11, y: 20 } }], [graphEdge])).not.toBe(base)
    expect(graphSignature([graphNode], [])).not.toBe(base)
    expect(graphSignature([graphNode], [graphEdge], { tempo: 121, swing: 0 })).not.toBe(base)
    expect(graphSignature([graphNode], [graphEdge], { tempo: 120, swing: 0.2 })).not.toBe(base)
  })

  it('changedKeys lists the fields that differ', () => {
    expect(changedKeys({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 })).toEqual(['b', 'd'])
    expect(changedKeys({ a: 1 }, { a: 1 })).toEqual([])
  })

  it('settingsFromMetadata: defaults and limits', () => {
    expect(settingsFromMetadata(undefined)).toEqual({ tempo: 120, swing: 0 })
    expect(settingsFromMetadata({ tempo: 90, swing: 0.25 })).toEqual({ tempo: 90, swing: 0.25 })
    expect(settingsFromMetadata({ tempo: 999, swing: 3 })).toEqual({ tempo: 200, swing: 1 })
    expect(settingsFromMetadata({ tempo: 'x', swing: -1 })).toEqual({ tempo: 120, swing: 0 })
  })
})

describe('Auto Layout (layout.js)', () => {
  it('puts each node in the column of its longest path from a source, following the signal', () => {
    const p = preset('preset-bass-arp')
    const pos = autoLayoutPositions(p.nodes, p.edges)
    expect(Object.keys(pos).sort()).toEqual(p.nodes.map(n => String(n.id)).sort())
    for (const e of p.edges) {
      expect(pos[e.target].x).toBeGreaterThan(pos[e.source].x)
    }
  })

  it('stacks nodes of a column without overlap, using measured heights when known', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 300 } },
      { id: 'b', position: { x: 0, y: 10 }, dimensions: { width: 100, height: 50 } },
      { id: 'c', position: { x: 0, y: 20 } }
    ]
    const pos = autoLayoutPositions(nodes, [])
    expect(pos.a.x).toBe(pos.b.x)
    expect(pos.b.y).toBeGreaterThanOrEqual(pos.a.y + 300)
    expect(pos.c.y).toBeGreaterThanOrEqual(pos.b.y + 50)
  })

  it('tolerates edges to missing nodes and self loops', () => {
    const pos = autoLayoutPositions([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'a' }, { source: 'x', target: 'b' }, { source: 'a', target: 'b' }])
    expect(pos.b.x).toBeGreaterThan(pos.a.x)
  })
})

describe('transport helpers', () => {
  it('formatPosition: bar.beat.sixteenth from the global step', () => {
    expect(formatPosition(0).label).toBe('1.1.1')
    expect(formatPosition(5).label).toBe('1.2.2')
    expect(formatPosition(21).label).toBe('2.2.2')
    expect(formatPosition(63).label).toBe('4.4.4')
    expect(formatPosition(-1)).toBeNull()
  })

  it('tap tempo averages the taps, ignores the first one and restarts after a pause', () => {
    const tap = createTapTempo()
    expect(tap.tap(0)).toBeNull()
    expect(tap.tap(500)).toBe(120)
    expect(tap.tap(1000)).toBe(120)
    expect(tap.tap(1400)).toBe(129) // average of 500, 500, 400 ms
    // pause > 2 s: starts over
    expect(tap.tap(5000)).toBeNull()
    expect(tap.tap(5400)).toBe(150)
    // clamped to the tempo range
    expect(tap.tap(5500)).toBe(200)
  })
})

describe('context menu placement', () => {
  it('opens at the cursor and stays inside the window', () => {
    expect(menuPlacement(100, 100, { width: 200, height: 300, viewportWidth: 1000, viewportHeight: 800 }))
      .toEqual({ left: 100, top: 100, maxHeight: 692 })
    const corner = menuPlacement(990, 790, { width: 200, height: 300, viewportWidth: 1000, viewportHeight: 800 })
    expect(corner.left).toBe(792)
    expect(corner.top).toBe(492)
  })
})

describe('level meter (engine/meter.js)', () => {
  it('measures peak and RMS', () => {
    expect(measureLevel([0, 0.5, -1, 0.5])).toEqual({ peak: 1, rms: Math.sqrt((0.25 + 1 + 0.25) / 4) })
    expect(measureLevel([])).toEqual({ peak: 0, rms: 0 })
    expect(toDb(1)).toBe(0)
    expect(toDb(0)).toBe(METER_FLOOR_DB)
    expect(Math.round(toDb(0.5))).toBe(-6)
    expect(meterPosition(0)).toBe(1)
    expect(meterPosition(-60)).toBe(0)
    expect(meterPosition(-30)).toBe(0.5)
  })

  it('taps a node with an analyser that only listens', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const meter = createLevelMeter(ctx, source)
    expect(source.connections).toContain(meter.analyser)
    expect(meter.analyser.connections).toEqual([])
    meter.analyser.signal = 0.5
    const level = meter.read()
    expect(level.peak).toBe(0.5)
    expect(Math.round(level.rmsDb)).toBe(-6)
    meter.disconnect()
    expect(source.connections).not.toContain(meter.analyser)
    expect(createLevelMeter({}, source)).toBeNull()
  })
})

describe('global swing (applySwing)', () => {
  const graph = () => preset('preset-bass-arp')

  it('0 leaves the score untouched (same object)', () => {
    const score = compileGraph(graph().nodes, graph().edges).score
    expect(applySwing(score, 0)).toBe(score)
  })

  it('delays only odd steps by swing × 0.5, on top of Groove, capped at 0.9, without mutating', () => {
    const { nodes, edges } = graph()
    const score = compileGraph(nodes, edges).score
    const copy = JSON.parse(JSON.stringify(score))
    const swung = applySwing(score, 0.6)
    expect(score).toEqual(copy)
    expect(swung.swing).toBe(0.6)
    swung.tracks.forEach((track, ti) => {
      track.events.forEach((ev, i) => {
        const orig = score.tracks[ti].events[i]
        if (orig.step % 2 === 0) expect(ev.time).toBe(orig.time)
        else expect(ev.time).toBeCloseTo(orig.step + Math.min(MAX_SWING_OFFSET, orig.time - orig.step + 0.3))
        expect(ev.midi).toBe(orig.midi)
      })
    })
    const max = applySwing(score, 1)
    for (const t of max.tracks) for (const ev of t.events) expect(ev.time - ev.step).toBeLessThanOrEqual(MAX_SWING_OFFSET + 1e-9)
  })

  it('compileWithSwing / scoreFromGraph apply it to what plays and exports', () => {
    const { nodes, edges } = graph()
    const plain = compileGraph(nodes, edges).score
    const swung = compileWithSwing(nodes, edges, { swing: 0.5 }).score
    expect(swung).toEqual(applySwing(plain, 0.5))
    expect(scoreFromGraph(nodes, edges, 120, 0.5)).toEqual(swung)
  })
})

describe('save status label', () => {
  it('describes every state', () => {
    expect(saveStatusLabel({ saveStatus: 'idle', isDirty: false, isPersisted: true, lastSavedAt: 1 })).toEqual({ key: 'saved', label: 'Guardado' })
    expect(saveStatusLabel({ saveStatus: 'idle', isDirty: true, isPersisted: true }).key).toBe('dirty')
    expect(saveStatusLabel({ saveStatus: 'idle', isDirty: true, isPersisted: false }).label).toMatch(/proyecto nuevo/)
    expect(saveStatusLabel({ saveStatus: 'saving' }).key).toBe('saving')
    expect(saveStatusLabel({ saveStatus: 'conflict' }).key).toBe('conflict')
    expect(saveStatusLabel({ saveStatus: 'error', isDirty: true, isPersisted: true, hasConflict: true }).label).toMatch(/Conflicto sin resolver/)
    expect(saveStatusLabel({ saveStatus: 'error', isDirty: true, isPersisted: true }).key).toBe('error')
  })
})

describe('version summary (preview)', () => {
  it('compiles the version with its own tempo and swing and lists its tracks', () => {
    const p = preset('preset-bass-arp')
    const s = versionSummary({ version_number: 3, nodes: p.nodes, edges: p.edges, metadata: { schemaVersion: 3, tempo: 90, swing: 0.2 } })
    expect(s.settings).toEqual({ tempo: 90, swing: 0.2 })
    expect(s.compiled.score.tempo).toBe(90)
    expect(s.tracks).toHaveLength(2)
    expect(s.mode).toBe('tracks')
    expect(s.nodeCounts.reduce((a, c) => a + c.count, 0)).toBe(p.nodes.length)
    expect(versionSummary(null)).toBeNull()
  })
})

describe('node registry (nodeRegistry.js)', () => {
  it('has every type of nodeTypes.js, in palette order, each with its component, ports and defaults', () => {
    expect(nodeTypeKeys).toEqual(NODE_TYPE_ORDER)
    expect(Object.keys(NODE_TYPES).sort()).toEqual([...NODE_TYPE_ORDER].sort())
    for (const entry of NODE_REGISTRY) {
      expect(entry.component, entry.type).toBeTruthy()
      expect(getNodeComponent(entry.type)).toBe(entry.component)
      expect(entry.inputs).toBe(NODE_TYPES[entry.type].inputs)
      expect(entry.outputs).toBe(NODE_TYPES[entry.type].outputs)
      expect(typeof entry.defaults).toBe('function')
      expect(getNodeEntry(entry.type).label).toBe(NODE_TYPES[entry.type].label)
    }
    expect(paletteEntries().map(e => e.type)).toEqual(NODE_TYPE_ORDER)
    expect(Object.keys(NODE_COMPONENTS)).toEqual(NODE_TYPE_ORDER)
    expect(LEGACY_COMPONENTS).toBe(NODE_COMPONENTS)
    expect(getNodeComponent('nope')).toBeNull()
  })

  it('nodeDisplayName prefers the node label, then the type label', () => {
    expect(nodeDisplayName({ type: 'voice', data: { label: 'Bajo' } })).toBe('Bajo')
    expect(nodeDisplayName({ type: 'voice', data: {} })).toBe('Voz') // Fase 5B: nombres en español
    expect(nodeDisplayName({ type: 'zzz' })).toBe('zzz')
  })
})
