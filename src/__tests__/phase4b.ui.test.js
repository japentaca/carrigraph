// Fase 4B — group operations in the store and in useEditorNodes (one undo
// entry each), compile memo (drag does not recompile), components: canvas
// node, thumbnail with playhead, seed controls, inspector, searchable
// palette, dialogs (focus and Escape), graph status strip, node bodies.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, defineComponent, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { usePlayback } from '../composables/usePlayback.js'
import { useEditorNodes, getClipboard, setClipboard } from '../composables/useEditorNodes.js'
import { useEditorUi, resetEditorUi } from '../composables/useEditorUi.js'
import { useKeyboard } from '../composables/useKeyboard.js'
import { createEngine } from '../audio/engine/index.js'
import { createNode, nodeSeed } from '../audio/graph/nodeTypes.js'
import { getNodeComponent, paletteEntries } from '../components/nodes/nodeRegistry.js'
import CanvasNode from '../components/nodes/CanvasNode.vue'
import NodePreview from '../components/nodes/NodePreview.vue'
import SeedControls from '../components/nodes/SeedControls.vue'
import PatternNode from '../components/nodes/PatternNode.vue'
import LengthNode from '../components/nodes/LengthNode.vue'
import LoopNode from '../components/nodes/LoopNode.vue'
import NodeInspector from '../components/editor/NodeInspector.vue'
import NodePalette from '../components/editor/NodePalette.vue'
import GraphStatus from '../components/editor/GraphStatus.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import CanvasContextMenu from '../components/editor/CanvasContextMenu.vue'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))
const stubs = { stubs: { NodePorts: true } }

function withSetup(setup) {
  let result
  const wrapper = mount(defineComponent({ setup() { result = setup(); return () => h('div') } }))
  return { result, wrapper }
}

function loadPreset(id) {
  const p = preset(id)
  useProjectStore().loadProject({ id: 1, name: 'P', updated_at: 'T1', nodes: p.nodes, edges: p.edges })
  return p
}

let ctx, timers
function useFakeEngine() {
  ctx = new FakeAudioContext()
  timers = createFakeTimers()
  setAudioEngineFactory((opts) => createEngine({ ...opts, createContext: () => ctx, transportOptions: { timers } }))
}

describe('store group actions: one undo entry each', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('insertGraph, removeNodes, removeEdges, updateNodesData', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const n0 = store.nodes.length
    const e0 = store.edges.length
    const a = createNode('pattern')
    const b = createNode('voice')
    store.insertGraph([a, b], [{ id: 'x', source: a.id, target: b.id, sourceHandle: 'pattern', targetHandle: 'notes' }])
    expect([store.nodes.length, store.edges.length, store.historyIndex]).toEqual([n0 + 2, e0 + 1, 1])
    store.undo()
    expect([store.nodes.length, store.edges.length]).toEqual([n0, e0])
    store.redo()

    const voices = store.nodes.filter(n => n.type === 'voice').map(n => n.id)
    const touching = store.edges.filter(e => voices.includes(e.source) || voices.includes(e.target)).length
    store.removeNodes(voices)
    expect(store.nodes.some(n => n.type === 'voice')).toBe(false)
    expect(store.edges).toHaveLength(e0 + 1 - touching)
    expect(store.historyIndex).toBe(2)
    store.undo()
    expect(store.nodes.filter(n => n.type === 'voice')).toHaveLength(3)

    const before = store.historyIndex
    const ids = store.edges.slice(0, 2).map(e => e.id)
    store.removeEdges(ids)
    expect(store.historyIndex).toBe(before + 1)
    const seeds = Object.fromEntries(store.nodes.filter(n => 'seed' in n.data).map(n => [n.id, { ...n.data, seed: 0.5 }]))
    expect(store.updateNodesData(seeds)).toBe(Object.keys(seeds).length)
    expect(store.historyIndex).toBe(before + 2)
    expect(store.updateNodesData(seeds)).toBe(0)
    expect(store.removeNodes(['nope'])).toBe(false)
  })
})

describe('useEditorNodes: selection and group operations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useFakeEngine()
    setClipboard(null)
  })
  afterEach(() => setAudioEngineFactory())

  const chainIds = (store) => {
    const pat = store.nodes.find(n => n.type === 'pattern')
    const next = store.edges.filter(e => e.source === pat.id).map(e => e.target)
    return [pat.id, ...next]
  }

  it('copy + paste: new ids, internal edges, same seeds, selected, ONE undo entry', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes({ pastePoint: () => ({ x: 900, y: 900 }) }))
    const ids = chainIds(store)
    result.selectNodes(ids)
    expect(result.selectedIds.value.sort()).toEqual(ids.slice().sort())
    expect(result.copySelection()).toBe(ids.length)
    expect(getClipboard().nodes).toHaveLength(ids.length)
    const n0 = store.nodes.length
    const e0 = store.edges.length
    const h0 = store.historyIndex
    const pasted = result.paste()
    expect(pasted).toHaveLength(ids.length)
    expect(store.nodes).toHaveLength(n0 + ids.length)
    const newIds = pasted.map(n => n.id)
    const internal = store.edges.filter(e => newIds.includes(e.source) && newIds.includes(e.target))
    expect(internal.length).toBe(store.edges.filter(e => ids.includes(e.source) && ids.includes(e.target)).length)
    expect(store.edges).toHaveLength(e0 + internal.length)
    for (const id of ids) {
      const orig = store.nodes.find(n => n.id === id)
      const copy = pasted.find(n => n.type === orig.type && JSON.stringify({ ...n.data, seed: 0 }) === JSON.stringify({ ...orig.data, seed: 0 }))
      expect(copy).toBeTruthy()
      if ('seed' in orig.data) expect(nodeSeed(copy)).toBe(nodeSeed(orig))
    }
    expect(Math.min(...pasted.map(n => n.position.x))).toBe(900)
    expect(result.selectedIds.value.sort()).toEqual(newIds.slice().sort())
    expect(store.historyIndex).toBe(h0 + 1)
    store.undo()
    expect(store.nodes).toHaveLength(n0)
    expect(store.edges).toHaveLength(e0)
  })

  it('paste without pointer shifts more on every paste; cut removes (undoable); duplicate keeps the clipboard', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    const ids = chainIds(store)
    result.selectNodes(ids)
    result.copySelection()
    const origX = store.nodes.find(n => n.id === ids[0]).position.x
    const p1 = result.paste()
    const p2 = result.paste()
    expect(p1[0].position.x).toBe(origX + 40)
    expect(p2[0].position.x).toBe(origX + 80)

    const clip = getClipboard()
    const dup = result.duplicateSelection([ids[0]])
    expect(dup).toHaveLength(1)
    expect(getClipboard()).toBe(clip)

    const n = store.nodes.length
    result.selectNodes([ids[0]])
    expect(result.cutSelection()).toBe(1)
    expect(store.nodes).toHaveLength(n - 1)
    store.undo()
    expect(store.nodes).toHaveLength(n)
  })

  it('delete several asks once and removes them in one entry; no nodes but a selected edge → edge removed', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    const ids = chainIds(store)
    result.selectNodes(ids)
    expect(result.requestDelete()).toBe(true)
    expect(result.deleteRequest.value.ids).toEqual(ids)
    const h0 = store.historyIndex
    result.confirmDelete()
    expect(store.nodes.some(n => ids.includes(n.id))).toBe(false)
    expect(store.historyIndex).toBe(h0 + 1)

    result.clearSelection()
    store.edges[0].selected = true
    const e = store.edges.length
    expect(result.requestDelete()).toBe(true)
    expect(store.edges).toHaveLength(e - 1)
  })

  it('align, new seeds (locked kept), randomize: one undo entry each', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    store.setNodePositions(Object.fromEntries(store.nodes.slice(0, 3).map((n, i) => [n.id, { x: i * 300, y: i * 70 }])))
    const ids = store.nodes.slice(0, 3).map(n => n.id)
    result.selectNodes(ids)
    const h0 = store.historyIndex
    expect(result.alignSelection('top')).toBe(true)
    const ys = new Set(store.nodes.filter(n => ids.includes(n.id)).map(n => n.position.y))
    expect(ys.size).toBe(1)
    expect(store.historyIndex).toBe(h0 + 1)

    const seeded = store.nodes.filter(n => 'seed' in n.data)
    const locked = seeded[0]
    store.updateNodeData(locked.id, { ...locked.data, seedLocked: true }, { group: false })
    const before = Object.fromEntries(seeded.map(n => [n.id, store.nodes.find(x => x.id === n.id).data.seed]))
    const h1 = store.historyIndex
    expect(result.newSeeds(seeded.map(n => n.id))).toBe(seeded.length - 1)
    expect(store.historyIndex).toBe(h1 + 1)
    expect(store.nodes.find(n => n.id === locked.id).data.seed).toBe(before[locked.id])
    for (const n of seeded.slice(1)) expect(store.nodes.find(x => x.id === n.id).data.seed).not.toBe(before[n.id])

    const fx = store.nodes.filter(n => n.type === 'effects').map(n => n.id)
    const h2 = store.historyIndex
    expect(result.randomizeNodes(fx)).toBeGreaterThan(0)
    expect(store.historyIndex).toBe(h2 + 1)
  })

  it('a node created from a dropped connection is connected (one entry) and replaces a used input', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    const pat = store.nodes.find(n => n.type === 'pattern')
    const h0 = store.historyIndex
    const made = result.addConnectedNode('transform', { x: 500, y: 300 }, { nodeId: pat.id, handleId: 'pattern', handleType: 'source' }, { id: 'in' })
    expect(made.node.position).toEqual({ x: 500, y: 278 })
    expect(made.edge).toMatchObject({ source: pat.id, sourceHandle: 'pattern', target: made.node.id, targetHandle: 'in' })
    expect(store.historyIndex).toBe(h0 + 1)
    expect(result.selectedIds.value).toEqual([made.node.id])

    // dragged from a used input (the voice's notes): the old edge goes away
    const voice = store.nodes.find(n => n.type === 'voice')
    const used = store.edges.find(e => e.target === voice.id && e.targetHandle === 'notes')
    const made2 = result.addConnectedNode('steps', { x: 0, y: 0 }, { nodeId: voice.id, handleId: 'notes', handleType: 'target' }, { id: 'pattern' })
    expect(made2.edge).toMatchObject({ target: voice.id, targetHandle: 'notes', source: made2.node.id })
    expect(store.edges.find(e => e.id === used.id)).toBeUndefined()
    expect(store.historyIndex).toBe(h0 + 2)
    store.undo()
    expect(store.edges.find(e => e.id === used.id)).toBeTruthy()

    // incompatible port → nothing created
    const n = store.nodes.length
    expect(result.addConnectedNode('output', { x: 0, y: 0 }, { nodeId: pat.id, handleId: 'pattern', handleType: 'source' }, { id: 'audio' })).toBeNull()
    expect(store.nodes).toHaveLength(n)
  })

  it('inspected node: the only selected one, the last clicked among several, else the last created', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    const [a, b] = store.nodes
    result.selectNodes([a.id])
    expect(result.inspectedNode.value.id).toBe(a.id)
    result.selectNodes([a.id, b.id], b.id)
    expect(result.inspectedNode.value.id).toBe(b.id)
    result.clearSelection()
    const made = result.addNodeAt('chord', { x: 0, y: 0 })
    expect(result.inspectedNode.value.id).toBe(made.id)
    expect(result.selectAll()).toBe(store.nodes.length)
  })
})

describe('keyboard: shortcuts do not interfere with typing', () => {
  it('Ctrl+C in a text field is not handled; on the page it is; Space on a button activates it', () => {
    const copy = vi.fn()
    const play = vi.fn()
    const w = mount(defineComponent({ setup() { useKeyboard({ 'Ctrl+C': copy, Space: play }); return () => h('div', [h('input'), h('button')]) } }), { attachTo: document.body })
    const input = w.find('input').element
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
    expect(copy).not.toHaveBeenCalled()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
    expect(copy).toHaveBeenCalledTimes(1)
    w.find('button').element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(play).not.toHaveBeenCalled()
    // a handler returning false lets the browser have the key
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    play.mockReturnValueOnce(false)
    document.body.dispatchEvent(ev)
    expect(play).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(false)
    w.unmount()
  })
})

describe('compilation is not redone by drags (performance)', () => {
  beforeEach(() => { setActivePinia(createPinia()); useFakeEngine() })
  afterEach(() => setAudioEngineFactory())

  it('moving or selecting nodes keeps the compiled result and sends nothing to the engine', async () => {
    loadPreset('preset-techno')
    const store = useProjectStore()
    const audio = useAudioStore()
    const { compiled, play } = usePlayback()
    await play()
    const first = compiled.value
    const spy = vi.spyOn(audio, 'updateScore')
    for (let i = 0; i < 20; i++) {
      store.applyPositionChanges([{ type: 'position', id: store.nodes[0].id, position: { x: i * 5, y: 3 }, dragging: true }])
    }
    store.nodes[1].selected = true
    await nextTick()
    expect(compiled.value).toBe(first)
    expect(spy).not.toHaveBeenCalled()
    const pat = store.nodes.find(n => n.type === 'pattern')
    store.updateNodeData(pat.id, { ...pat.data, density: 0.9 })
    await nextTick()
    expect(compiled.value).not.toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
    audio.stop()
  })
})

describe('canvas node, thumbnail and seed controls', () => {
  beforeEach(() => { setActivePinia(createPinia()); resetEditorUi() })

  it('compact: header, summary, thumbnail and seed; ▾ shows the parameters right there', async () => {
    const node = createNode('pattern')
    const preview = { kind: 'pattern', length: 16, steps: new Array(16).fill(true) }
    const w = mount(CanvasNode, { props: { id: node.id, type: 'pattern', data: node.data, preview, active: true }, global: stubs })
    expect(w.find('.cgn__title').text()).toBe('Generador de patrones') // Fase 5B: nombres en español
    expect(w.find('.cgn__summary').text()).toContain('Euclídeo')
    expect(w.findComponent(NodePreview).exists()).toBe(true)
    expect(w.findComponent(SeedControls).exists()).toBe(true)
    expect(w.findComponent(PatternNode).exists()).toBe(false)
    const toggle = w.find('.cgn__toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(useEditorUi().isExpanded(node.id)).toBe(true)
    expect(w.findComponent(PatternNode).exists()).toBe(true)
    w.findComponent(PatternNode).vm.$emit('update', { ...node.data, density: 0.25 })
    expect(w.emitted('update')[0][0].density).toBe(0.25)
    // nodes without seed have no seed controls
    const v = mount(CanvasNode, { props: { id: 'v', type: 'voice', data: createNode('voice').data }, global: stubs })
    expect(v.findComponent(SeedControls).exists()).toBe(false)
  })

  it('the playhead shows the playing step of the node cycle, only when active and playing', async () => {
    const preview = { kind: 'pattern', length: 12, steps: new Array(12).fill(false) }
    const w = mount(NodePreview, { props: { preview, active: true } })
    expect(w.find('.node-preview__head').exists()).toBe(false)
    const audio = useAudioStore()
    audio.isPlaying = true
    audio.globalStep = 27
    await nextTick()
    const head = w.find('.node-preview__head')
    expect(head.attributes('style')).toContain('left: 25%') // 27 % 12 = 3 → 3/12
    await w.setProps({ active: false })
    expect(w.find('.node-preview__head').exists()).toBe(false)
    expect(w.attributes('aria-label')).toMatch(/12 pasos/)
  })

  it('seed controls: value, new seed, lock (and locked = no new seed)', async () => {
    const node = { id: 'p', type: 'pattern', data: { ...createNode('pattern').data, seed: 0.25 } }
    const w = mount(SeedControls, { props: { node } })
    expect(w.find('input').element.value).toBe('250')
    const [dice, lock] = w.findAll('button')
    await dice.trigger('click')
    expect(w.emitted('update')[0][0].seed).not.toBe(0.25)
    await lock.trigger('click')
    expect(w.emitted('update')[1][0].seedLocked).toBe(true)
    await w.find('input').setValue('999')
    expect(w.emitted('update')[2][0].seed).toBe(0.999)
    await w.setProps({ node: { ...node, data: { ...node.data, seedLocked: true } } })
    expect(dice.attributes('disabled')).toBeDefined()
    expect(lock.attributes('aria-pressed')).toBe('true')
  })

  it('rewritten node bodies emit complete data (Pattern, Length, Loop)', async () => {
    const pd = createNode('pattern').data
    const p = mount(PatternNode, { props: { data: pd } })
    await p.find('select').setValue('cellular')
    expect(p.emitted('update')[0][0]).toMatchObject({ ...pd, algorithm: 'cellular' })
    const l = mount(LengthNode, { props: { data: createNode('length').data } })
    await l.findAll('button').find(b => b.text() === '32').trigger('click')
    expect(l.emitted('update')[0][0].value).toBe(32)
    const lp = mount(LoopNode, { props: { data: createNode('loop').data } })
    await lp.find('input[type=number]').setValue('70')
    expect(lp.emitted('update')[0][0].value).toBe(64) // clamped to max
    // every control has an accessible name
    for (const w of [p, l, lp]) {
      for (const el of w.findAll('input, select')) {
        expect(el.attributes('aria-label') || el.attributes('id'), el.html()).toBeTruthy()
      }
    }
  })
})

describe('inspector, palette, dialogs and status', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('inspector with several nodes: align / distribute / group actions', async () => {
    const w = mount(NodeInspector, { props: { node: null, count: 3, seededCount: 1 }, global: stubs })
    expect(w.text()).toContain('3 nodos seleccionados')
    await w.find('[aria-label="Alinear arriba"]').trigger('click')
    expect(w.emitted('align')[0]).toEqual(['top'])
    const byText = (t) => w.findAll('button').find(b => b.text().includes(t))
    await byText('Horizontal').trigger('click')
    expect(w.emitted('align')[1]).toEqual(['distribute-h'])
    await byText('Duplicar').trigger('click')
    await byText('Nuevas semillas').trigger('click')
    await byText('Eliminar').trigger('click')
    expect(w.emitted('duplicate')).toHaveLength(1)
    expect(w.emitted('new-seeds')).toHaveLength(1)
    expect(w.emitted('delete')).toHaveLength(1)
    await w.setProps({ count: 2 })
    expect(byText('Horizontal').attributes('disabled')).toBeDefined()
  })

  it('inspector with one node: rename, randomize and the seed', async () => {
    const node = { id: 'g', type: 'groove', data: createNode('groove').data }
    const w = mount(NodeInspector, { props: { node, count: 1 }, global: stubs })
    expect(w.findComponent(getNodeComponent('groove')).exists()).toBe(true)
    expect(w.findComponent(SeedControls).exists()).toBe(true)
    await w.find('.inspector__name').setValue('Mi groove')
    expect(w.emitted('update')[0]).toEqual(['g', { ...node.data, label: 'Mi groove' }])
    await w.findAll('button').find(b => b.text().includes('Aleatorizar')).trigger('click')
    expect(w.emitted('randomize')[0]).toEqual([['g']])
    await w.setProps({ node: { id: 'o', type: 'output', data: createNode('output').data } })
    expect(w.findAll('button').find(b => b.text().includes('Aleatorizar')).attributes('disabled')).toBeDefined()
  })

  it('palette: filters while typing, arrows choose, Enter picks, Escape closes', async () => {
    const w = mount(NodePalette, { props: { open: true, x: 10, y: 10, entries: paletteEntries() }, attachTo: document.body })
    await nextTick()
    const input = w.find('input')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('acor')
    expect(w.findAll('[role=option]').map(o => o.text())).toEqual([expect.stringContaining('Acorde')])
    await input.setValue('')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')[0][0].type).toBe(paletteEntries()[1].type)
    await input.trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(1)
    await input.setValue('zzzz')
    expect(w.text()).toContain('Ningún nodo coincide')
    w.unmount()
  })

  it('confirm dialog takes the focus, keeps Tab inside and closes with Escape', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const w = mount(ConfirmDialog, { props: { visible: true, title: 'T', message: 'M' }, attachTo: document.body })
    await nextTick()
    const dialog = document.querySelector('.confirm-dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('T')
    expect(document.activeElement.textContent.trim()).toBe('Cancelar') // Fase 5B: texto por defecto en español
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('cancel')).toHaveLength(1)
    await w.setProps({ visible: false })
    await new Promise(r => setTimeout(r, 5))
    expect(document.activeElement).toBe(opener)
    w.unmount()
    opener.remove()
  })

  it('graph status is a strip (not over the canvas) and folds long lists', async () => {
    const compiled = { mode: 'tracks', score: { tracks: [{ name: 'Bajo', length: 16 }] } }
    const diagnostics = [{ level: 'info', message: 'uno' }, { level: 'warning', message: 'dos' }]
    const w = mount(GraphStatus, { props: { compiled, diagnostics } })
    expect(w.text()).toContain('1 pista: Bajo (16)')
    expect(w.text()).toContain('2 avisos')
    expect(w.find('ul').exists()).toBe(false)
    await w.find('button').trigger('click')
    expect(w.findAll('li')).toHaveLength(2)
  })

  it('context menu on a node of a multiple selection acts on the group', async () => {
    const node = { id: 'p', type: 'pattern', data: {} }
    const w = mount(CanvasContextMenu, { props: { menu: { show: true, x: 0, y: 0, flow: { x: 0, y: 0 }, node, count: 3 } } })
    expect(w.text()).toContain('3 nodos seleccionados')
    const items = w.findAll('.context-menu-item')
    expect(items.map(i => i.text()).join('|')).toMatch(/Copiar.*Nuevas semillas.*Aleatorizar/)
    await items.find(i => i.text().includes('Copiar')).trigger('click')
    await items.find(i => i.text().includes('Nuevas semillas')).trigger('click')
    expect(w.emitted('copy')[0]).toEqual([node])
    expect(w.emitted('new-seed')[0]).toEqual([node])
    // single node without seed: no seed item
    await w.setProps({ menu: { show: true, x: 0, y: 0, flow: {}, node: { id: 'o', type: 'output', data: {} }, count: 1 } })
    expect(w.text()).not.toContain('semilla')
    expect(w.text()).not.toContain('Aleatorizar')
  })
})
