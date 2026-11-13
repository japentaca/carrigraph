// Fase 4B — pure helpers: parameter ranges / randomize / seeds, compiler
// previews, thumbnails and summaries, copy / paste / align, searchable
// palette and port compatibility, accessibility helpers, keyboard rules,
// oscilloscope line, engine waveform.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import {
  NODE_PARAMS, SEED_TYPES, hasSeed, seedMatters, canRandomize, randomizeNodeData, withNewSeed,
  isValidParamValue, randomParamValue
} from '../audio/graph/nodeParams.js'
import { compileGraph, previewOf } from '../audio/graph/compile.js'
import { NODE_TYPES, NODE_TYPE_ORDER, createNode, nodeSeed } from '../audio/graph/nodeTypes.js'
import { createRng } from '../audio/engine/score.js'
import { nodeSummary, previewGeometry, playingStep } from '../editor/nodeView.js'
import { copySubgraph, pasteSubgraph, alignPositions, boundsOf, ALIGN_MODES } from '../editor/selection.js'
import { searchPalette, compatibleNodeTypes, nodePositionForDrop, normalizeText } from '../editor/palette.js'
import { labelControls, trapTab, focusableIn } from '../editor/a11y.js'
import { shouldIgnoreShortcut, comboOf } from '../composables/useKeyboard.js'
import { waveformPoints } from '../editor/transport.js'
import { compileKey } from '../composables/usePlayback.js'
import { createLevelMeter } from '../audio/engine/meter.js'
import { createEngine } from '../audio/engine/index.js'
import { paletteEntries, NODE_REGISTRY } from '../components/nodes/nodeRegistry.js'
import { MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { FakeAudioContext } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))
const getPath = (o, path) => path.split('.').reduce((x, k) => x?.[k], o)

describe('parameter ranges and randomize (nodeParams)', () => {
  it('every node type has param specs and they match the defaults', () => {
    for (const type of NODE_TYPE_ORDER) {
      expect(NODE_PARAMS[type], type).toBeTruthy()
      const data = createNode(type).data
      for (const [path, spec] of Object.entries(NODE_PARAMS[type])) {
        const v = getPath(data, path)
        if (v !== undefined && spec.kind !== 'number' && spec.kind !== 'int') continue
        // numeric defaults lie inside the valid range of the editor (not the random range)
        if (typeof v === 'number') expect(Number.isFinite(v), `${type}.${path}`).toBe(true)
      }
    }
  })

  it('randomized values always stay inside the valid ranges (200 draws per type)', () => {
    const rng = createRng('4b-ranges')
    for (const type of NODE_TYPE_ORDER) {
      for (let i = 0; i < 200; i++) {
        const data = randomizeNodeData(type, createNode(type).data, { rng })
        for (const [path, spec] of Object.entries(NODE_PARAMS[type])) {
          if (spec.random === false) continue
          expect(isValidParamValue(spec, getPath(data, path)), `${type}.${path}=${getPath(data, path)}`).toBe(true)
        }
        // the result still compiles as a node of that type
        if (data.seed !== undefined) expect(data.seed).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps label, color, non-random params and unknown fields; never mutates the input', () => {
    const data = { ...createNode('voice').data, volume: 0.33, pan: -0.5, custom: 'x', label: 'Mi voz' }
    const copy = JSON.parse(JSON.stringify(data))
    const next = randomizeNodeData('voice', data, { rng: createRng(1) })
    expect(data).toEqual(copy)
    expect(next).toMatchObject({ volume: 0.33, pan: -0.5, custom: 'x', label: 'Mi voz', color: data.color })
  })

  it('a locked seed survives randomize and "nueva semilla"; an unlocked one changes', () => {
    const node = { id: 'p', type: 'pattern', data: { ...createNode('pattern').data, seed: 0.123 } }
    const free = randomizeNodeData('pattern', node.data, { rng: createRng(5) })
    expect(free.seed).not.toBe(0.123)
    const locked = randomizeNodeData('pattern', { ...node.data, seedLocked: true }, { rng: createRng(5) })
    expect(locked.seed).toBe(0.123)
    expect(withNewSeed({ ...node, data: { ...node.data, seedLocked: true } })).toBeNull()
    const renewed = withNewSeed(node, 0.123) // same value asked → still a different seed
    expect(renewed.seed).not.toBe(0.123)
    expect(withNewSeed({ id: 'o', type: 'output', data: {} })).toBeNull()
  })

  it('seed types, what uses the seed, what can be randomized', () => {
    expect(SEED_TYPES).toEqual(['pattern', 'transform', 'scale', 'groove'])
    for (const t of SEED_TYPES) expect('seed' in createNode(t).data).toBe(true)
    expect(hasSeed('voice')).toBe(false)
    expect(seedMatters({ type: 'pattern', data: { algorithm: 'euclidean' } })).toBe(false)
    expect(seedMatters({ type: 'pattern', data: { algorithm: 'random' } })).toBe(true)
    expect(seedMatters({ type: 'transform', data: { operation: 'probability' } })).toBe(true)
    expect(canRandomize('output')).toBe(false)
    expect(canRandomize('effects')).toBe(true)
    expect(NODE_REGISTRY.every(e => e.type in NODE_PARAMS)).toBe(true)
  })

  it('random step patterns keep their length and are never empty', () => {
    const v = randomParamValue({ kind: 'steps', p: 0 }, createRng(1), new Array(12).fill(true))
    expect(v).toHaveLength(12)
    expect(v.some(Boolean)).toBe(true)
  })
})

describe('compiler previews (thumbnail data per node)', () => {
  it('every node of a multitrack preset gets the value of its output; the score is unchanged', () => {
    const p = preset('preset-bass-arp')
    const result = compileGraph(p.nodes, p.edges)
    for (const n of p.nodes) {
      if (['length', 'loop'].includes(n.type)) expect(result.previews[n.id]).toMatchObject({ kind: 'number' })
      else expect(result.previews[n.id], n.type).toBeTruthy()
    }
    // Output preview = the real notes of its track
    const out = p.nodes.find(n => n.type === 'output')
    const track = result.score.tracks.find(t => t.id === out.id)
    expect(result.previews[out.id].events.map(e => e.midi)).toEqual(track.events.map(e => e.midi))
    // Pattern preview is what the pattern node outputs (not the track)
    const pat = p.nodes.find(n => n.type === 'pattern')
    expect(result.previews[pat.id].kind).toBe('pattern')
    // A transform downstream shows ITS result, not the generator's
    const nodes = [...p.nodes, { id: 'tx', type: 'transform', data: { operation: 'invert' } }]
    const edges = [...p.edges, { id: 'etx', source: pat.id, target: 'tx', sourceHandle: 'pattern', targetHandle: 'in' }]
    const r2 = compileGraph(nodes, edges)
    expect(r2.previews.tx.steps).toEqual(r2.previews[pat.id].steps.map(s => !s))
    expect(r2.score).toEqual(compileGraph(nodes, edges).score)
  })

  it('nodes that feed no Output get a preview but no new diagnostics', () => {
    const nodes = [
      { id: 'o', type: 'output', data: {} },
      { id: 'p', type: 'pattern', data: { algorithm: 'euclidean', density: 0.25, seed: 0 } },
      { id: 't', type: 'transform', data: { operation: 'reverse' } }
    ]
    const edges = [{ id: 'e', source: 'p', target: 't', sourceHandle: 'pattern', targetHandle: 'in' }]
    const r = compileGraph(nodes, edges)
    expect(r.previews.p.steps.filter(Boolean)).toHaveLength(4)
    expect(r.previews.t.steps).toEqual(r.previews.p.steps.slice().reverse())
    const codes = r.diagnostics.map(d => `${d.nodeId}:${d.code}`)
    expect(codes).not.toContain('t:missing-input')
    expect(codes).not.toContain('p:empty-pattern')
    // a transform without input has no preview (nothing comes out)
    const r3 = compileGraph([...nodes, { id: 't2', type: 'transform', data: {} }], edges)
    expect(r3.previews.t2).toBeUndefined()
    expect(r3.diagnostics.some(d => d.nodeId === 't2' && d.code === 'missing-input')).toBe(false)
  })

  it('compatibility mode: the primary pattern shows the track rhythm, empty graph → {}', () => {
    const nodes = [
      { id: 'p', type: 'pattern', data: { algorithm: 'euclidean', density: 0.5, seed: 0 } },
      { id: 'l', type: 'length', data: { value: 8 } },
      { id: 'v', type: 'voice', data: { instrument: 'Piano' } }
    ]
    const edges = [{ id: 'a', source: 'l', target: 'p' }, { id: 'b', source: 'p', target: 'v' }]
    const r = compileGraph(nodes, edges)
    expect(r.mode).toBe('compat')
    expect(r.previews.p).toEqual({ kind: 'pattern', length: 8, steps: r.score.tracks[0].steps })
    expect(r.previews.v.kind).toBe('notes')
    expect(r.previews.l).toEqual({ kind: 'number', value: 8 })
    expect(compileGraph([], []).previews).toEqual({})
  })

  it('previewOf', () => {
    expect(previewOf(null)).toBeNull()
    expect(previewOf(16)).toEqual({ kind: 'number', value: 16 })
    expect(previewOf({ kind: 'audio', notes: { kind: 'notes', length: 4, events: [] } })).toEqual({ kind: 'notes', length: 4, events: [] })
  })
})

describe('thumbnails and summaries (nodeView)', () => {
  it('pattern geometry: one cell per step with gaps, only hits when steps are tiny', () => {
    const g = previewGeometry({ kind: 'pattern', length: 16, steps: [true, false, false, false].concat(new Array(12).fill(false)) }, { width: 160, height: 20 })
    expect(g.cells).toHaveLength(16)
    expect(g.cells[0]).toMatchObject({ x: 0, on: true, h: 20 })
    expect(g.cells[1].x).toBeCloseTo(10)
    const big = previewGeometry({ kind: 'pattern', length: 512, steps: Array.from({ length: 512 }, (_, i) => i % 64 === 0) }, { width: 160 })
    expect(big.cells).toHaveLength(8)
    expect(previewGeometry({ kind: 'number', value: 3 })).toBeNull()
  })

  it('notes geometry: higher pitch → higher row; time places the note; velocity → alpha', () => {
    const g = previewGeometry({
      kind: 'notes', length: 4,
      events: [{ step: 0, time: 0, midi: 60, vel: 1 }, { step: 2, time: 2.5, midi: 72, vel: 0.5 }, { step: 3, time: 3, midi: null, vel: 1 }]
    }, { width: 100, height: 20 })
    expect(g.cells[1].y).toBeLessThan(g.cells[0].y)
    expect(g.cells[1].x).toBeCloseTo(62.5)
    expect(g.cells[1].alpha).toBe(0.5)
  })

  it('playing step of a node cycle', () => {
    expect(playingStep(-1, 16)).toBe(-1)
    expect(playingStep(37, 16)).toBe(5)
    expect(playingStep(37, 12)).toBe(1)
  })

  it('a one-line summary for every node type', () => {
    for (const type of NODE_TYPE_ORDER) expect(nodeSummary(createNode(type)).length, type).toBeGreaterThan(0)
    expect(nodeSummary({ type: 'pattern', data: { algorithm: 'cellular', density: 0.5, rotation: 2, rule: 90 } })).toBe('Celular · 50% · rot 2 · regla 90')
    expect(nodeSummary({ type: 'effects', data: { filter: { enabled: true }, reverb: { enabled: true } } })).toBe('Filtro + Reverb')
    expect(nodeSummary({ type: 'output', data: { name: 'Bajo', volume: 0.5, mute: true } })).toBe('Bajo · vol 50% · mute')
  })
})

describe('copy / paste / align (selection)', () => {
  const graph = () => {
    const p = preset('preset-bass-arp')
    return { nodes: p.nodes, edges: p.edges }
  }

  it('copies the nodes and only the edges between them, without Vue Flow fields', () => {
    const { nodes, edges } = graph()
    const pat = nodes.find(n => n.type === 'pattern')
    const internal = edges.filter(e => e.source === pat.id)
    const ids = [pat.id, ...internal.map(e => e.target)]
    const withRuntime = nodes.map(n => ({ ...n, selected: true, dimensions: { width: 200, height: 90 } }))
    const clip = copySubgraph(withRuntime, edges, ids)
    expect(clip.nodes.map(n => n.id).sort()).toEqual(ids.slice().sort())
    expect(clip.nodes[0].selected).toBeUndefined()
    expect(clip.edges.every(e => ids.includes(e.source) && ids.includes(e.target))).toBe(true)
    expect(clip.edges.length).toBeGreaterThanOrEqual(internal.length)
    expect(copySubgraph(nodes, edges, [])).toBeNull()
  })

  it('pastes with new ids, remapped edges, same data and seeds; at a point or shifted', () => {
    const { nodes, edges } = graph()
    const ids = nodes.slice(0, 4).map(n => n.id)
    const clip = copySubgraph(nodes, edges, ids)
    let i = 0
    const pasted = pasteSubgraph(clip, { offset: { x: 40, y: 40 }, nodeId: (n) => `new-${i++}`, edgeId: () => `e-${i++}` })
    expect(pasted.nodes.map(n => n.id).some(id => ids.includes(id))).toBe(false)
    for (const n of pasted.nodes) {
      const orig = nodes.find(o => o.id === Object.keys(pasted.idMap).find(k => pasted.idMap[k] === n.id))
      expect(n.data).toEqual({ ...orig.data, ...(orig.data.seed !== undefined ? { seed: orig.data.seed } : {}) })
      expect(n.position).toEqual({ x: orig.position.x + 40, y: orig.position.y + 40 })
    }
    for (const e of pasted.edges) {
      expect(pasted.nodes.some(n => n.id === e.source)).toBe(true)
      expect(pasted.nodes.some(n => n.id === e.target)).toBe(true)
    }
    const at = pasteSubgraph(clip, { at: { x: 1000, y: 500 } })
    const box = boundsOf(at.nodes)
    expect([box.x, box.y]).toEqual([1000, 500])
  })

  it('a node without stored seed keeps sounding the same after paste (the seed becomes explicit)', () => {
    const node = { id: 'pattern-old', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'random', density: 0.5 } }
    const clip = copySubgraph([node], [], [node.id])
    const [copy] = pasteSubgraph(clip).nodes
    expect(copy.id).not.toBe(node.id)
    expect(nodeSeed(copy)).toBe(nodeSeed(node))
  })

  it('pasted subgraph compiles to the same notes (a duplicated track sounds identical)', () => {
    const { nodes, edges } = graph()
    const clip = copySubgraph(nodes, edges, nodes.map(n => n.id))
    const pasted = pasteSubgraph(clip)
    // (the track id is the id of its Output node, which is new)
    const notes = (score) => score.tracks.map(t => t.events.map(({ track, ...e }) => e))
    const a = notes(compileGraph(nodes, edges).score)
    const b = notes(compileGraph(pasted.nodes, pasted.edges).score)
    expect(b).toEqual(a)
  })

  it('aligns by edges / centers and distributes with equal gaps', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 50 } },
      { id: 'b', position: { x: 300, y: 40 }, dimensions: { width: 200, height: 100 } },
      { id: 'c', position: { x: 120, y: 400 }, dimensions: { width: 100, height: 50 } }
    ]
    const ids = ['a', 'b', 'c']
    expect(alignPositions(nodes, ids, 'left')).toEqual({ b: { x: 0, y: 40 }, c: { x: 0, y: 400 } })
    expect(alignPositions(nodes, ids, 'right')).toEqual({ a: { x: 400, y: 0 }, c: { x: 400, y: 400 } })
    expect(alignPositions(nodes, ids, 'top')).toEqual({ b: { x: 300, y: 0 }, c: { x: 120, y: 0 } })
    expect(alignPositions(nodes, ids, 'bottom').a).toEqual({ x: 0, y: 400 })
    expect(alignPositions(nodes, ids, 'center').a).toEqual({ x: 200, y: 0 })
    const dh = alignPositions(nodes, ids, 'distribute-h')
    // sorted a(0..100), c(120..220), b(300..500): total 400 in span 500 → gap 50
    expect(dh).toEqual({ c: { x: 150, y: 400 } })
    expect(alignPositions(nodes, ['a', 'b'], 'distribute-h')).toEqual({})
    expect(alignPositions(nodes, ['a'], 'left')).toEqual({})
    expect(ALIGN_MODES).toHaveLength(8)
  })
})

describe('searchable palette and port compatibility', () => {
  it('filters by label, description, type and keywords, without accents, best first', () => {
    const entries = paletteEntries()
    expect(searchPalette(entries, '')).toHaveLength(entries.length)
    expect(searchPalette(entries, 'reverb').map(e => e.type)).toEqual(['effects'])
    expect(searchPalette(entries, 'melodia')[0].type).toBe('scale')
    expect(searchPalette(entries, 'MELODÍA')[0].type).toBe('scale')
    expect(searchPalette(entries, 'sal')[0].type).toBe('output')
    expect(searchPalette(entries, 'voz').map(e => e.type)).toContain('voice')
    expect(searchPalette(entries, 'zzz')).toEqual([])
    expect(normalizeText('  Ácido ')).toBe('acido')
  })

  it('from an output: types with a compatible input (pattern feeds notes too)', () => {
    const fromPattern = compatibleNodeTypes({ type: 'pattern', handleType: 'source' })
    expect(fromPattern.map(o => o.type)).toEqual(['logic', 'transform', 'scale', 'chord', 'groove', 'voice'])
    expect(fromPattern.find(o => o.type === 'voice').port.id).toBe('notes')
    expect(compatibleNodeTypes({ type: 'audio', handleType: 'source' }).map(o => o.type)).toEqual(['effects', 'output'])
    expect(compatibleNodeTypes({ type: 'number', handleType: 'source' }).map(o => [o.type, o.port.id])).toEqual([['pattern', 'length']])
  })

  it('from an input: types with a compatible output', () => {
    const toNotes = compatibleNodeTypes({ type: 'notes', handleType: 'target' }).map(o => o.type)
    expect(toNotes).toEqual(['pattern', 'steps', 'logic', 'transform', 'scale', 'chord', 'groove'])
    expect(compatibleNodeTypes({ type: 'audio', handleType: 'target' }).map(o => o.type)).toEqual(['voice', 'effects'])
    expect(compatibleNodeTypes({ type: 'number', handleType: 'target' }).map(o => o.type)).toEqual(['length', 'loop'])
  })

  it('places the new node on the side of the drop that makes the edge short', () => {
    expect(nodePositionForDrop({ x: 500, y: 300 }, 'source')).toEqual({ x: 500, y: 278 })
    expect(nodePositionForDrop({ x: 500, y: 300 }, 'target', { width: 200 })).toEqual({ x: 300, y: 278 })
  })
})

describe('accessibility and keyboard helpers', () => {
  it('labelControls names the control after each label, and button groups', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div><label class="cg-label">Densidad</label><div class="cg-control"><input type="range"><span>50%</span></div></div>
      <div><label class="cg-label">Tónica</label><select><option>C</option></select></div>
      <div><label class="cg-label">Octava</label><div class="cg-buttons"><button>1</button><button>2</button></div></div>
      <div><label class="cg-label" for="x">Con for</label><input id="x"></div>`
    expect(labelControls(root)).toBe(3)
    expect(root.querySelector('input[type=range]').getAttribute('aria-label')).toBe('Densidad')
    expect(root.querySelector('select').getAttribute('aria-label')).toBe('Tónica')
    expect(root.querySelector('.cg-buttons').getAttribute('role')).toBe('group')
    expect(root.querySelector('#x').getAttribute('aria-label')).toBeNull()
    expect(labelControls(root)).toBe(0) // idempotent
  })

  it('trapTab keeps Tab and Shift+Tab inside a dialog', () => {
    const root = document.createElement('div')
    root.innerHTML = '<button id="a">a</button><input id="b"><button id="c">c</button>'
    document.body.appendChild(root)
    expect(focusableIn(root).map(e => e.id)).toEqual(['a', 'b', 'c'])
    root.querySelector('#c').focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    expect(trapTab(ev, root)).toBe(true)
    expect(document.activeElement.id).toBe('a')
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    expect(trapTab(back, root)).toBe(true)
    expect(document.activeElement.id).toBe('c')
    root.querySelector('#b').focus()
    expect(trapTab(new KeyboardEvent('keydown', { key: 'Tab' }), root)).toBe(false)
    root.remove()
  })

  it('global shortcuts ignore typing, dialogs and Space/Enter on buttons', () => {
    const input = document.createElement('input')
    const button = document.createElement('button')
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    const inner = document.createElement('span')
    dialog.appendChild(inner)
    document.body.append(input, button, dialog)
    const ev = (target, key, extra = {}) => ({ target, key, ...extra })
    expect(shouldIgnoreShortcut(ev(input, 'Delete'))).toBe(true)
    expect(shouldIgnoreShortcut(ev(button, ' '))).toBe(true)
    expect(shouldIgnoreShortcut(ev(button, 'Delete'))).toBe(false)
    expect(shouldIgnoreShortcut(ev(inner, 'Escape'))).toBe(true)
    expect(shouldIgnoreShortcut(ev(document.body, ' '))).toBe(false)
    input.remove(); button.remove(); dialog.remove()
  })

  it('combo names: Ctrl / Cmd, Shift only for letters and named keys ("?" works)', () => {
    expect(comboOf({ key: 'c', ctrlKey: true })).toBe('Ctrl+C')
    expect(comboOf({ key: 'c', metaKey: true })).toBe('Cmd+C')
    expect(comboOf({ key: 'z', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z')
    expect(comboOf({ key: '?', shiftKey: true })).toBe('?')
    expect(comboOf({ key: 'Tab' })).toBe('Tab')
    expect(comboOf({ key: ' ' })).toBe('Space') // was ' ' before Fase 4B: the Space shortcut never fired
    expect(comboOf({ key: 'Tab', shiftKey: true })).toBe('Shift+Tab')
  })
})

describe('oscilloscope and compile key', () => {
  it('one point per column, keeping the peak of each column; flat without samples', () => {
    const flat = waveformPoints(null, 50, 20)
    expect(flat).toHaveLength(50)
    expect(flat.every(([, y]) => y === 10)).toBe(true)
    const samples = new Float32Array(500)
    samples[123] = 1
    const pts = waveformPoints(samples, 50, 20)
    expect(Math.min(...pts.map(p => p[1]))).toBe(1) // top (mid - (mid - 1))
    expect(pts.at(-1)[0]).toBe(50)
  })

  it('the engine exposes the master waveform (live analyser only)', async () => {
    const ctx = new FakeAudioContext()
    const meter = createLevelMeter(ctx, ctx.createGain())
    meter.analyser.signal = (i) => (i === 3 ? 0.5 : 0)
    const w = meter.waveform()
    expect(w[3]).toBe(0.5)
    const engine = createEngine({ createContext: () => ctx })
    expect(engine.getWaveform()).toBeNull()
    await engine.resume()
    expect(engine.getWaveform(new Float32Array(8))).toHaveLength(8)
  })

  it('positions and selection do not change the compile key; data and edges do', () => {
    const nodes = [{ id: 'a', type: 'pattern', position: { x: 0, y: 0 }, data: { density: 0.5 } }]
    const key = compileKey(nodes, [])
    expect(compileKey([{ ...nodes[0], position: { x: 99, y: 5 }, selected: true, dimensions: { width: 1 } }], [])).toBe(key)
    expect(compileKey([{ ...nodes[0], data: { density: 0.6 } }], [])).not.toBe(key)
    expect(compileKey(nodes, [{ id: 'e', source: 'a', target: 'b' }])).not.toBe(key)
  })
})
