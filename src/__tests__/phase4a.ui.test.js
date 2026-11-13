// Fase 4A — editor composables and components: live editing without
// auto-start, global swing reaching the engine, level meter, autosave
// (debounce, conflict, leaving), transport bar, sidebar without transport
// controls, context menu in canvas coordinates, useEditorNodes, edit modal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, defineComponent, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import http from '../api/http.js'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { usePlayback } from '../composables/usePlayback.js'
import { useAutosave } from '../composables/useAutosave.js'
import { useContextMenu } from '../composables/useContextMenu.js'
import { useEditorNodes } from '../composables/useEditorNodes.js'
import { createEngine } from '../audio/engine/index.js'
import TransportBar from '../components/editor/TransportBar.vue'
import CanvasContextMenu from '../components/editor/CanvasContextMenu.vue'
// Fase 4B: the edit modal was replaced by the side inspector (same component,
// same live editing); its test below was rewritten for the inspector.
import NodeInspector from '../components/editor/NodeInspector.vue'
import AppSidebar from '../components/AppSidebar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'
import { paletteEntries, getNodeComponent } from '../components/nodes/nodeRegistry.js'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))
const stubs = { stubs: { NodePorts: true, PresetPanel: true } }

/** Mount a host component that runs `setup` (for composables with lifecycle hooks). */
function withSetup(setup) {
  let result
  const wrapper = mount(defineComponent({ setup() { result = setup(); return () => h('div') } }))
  return { result, wrapper }
}

let ctx, timers
function useFakeEngine() {
  ctx = new FakeAudioContext()
  timers = createFakeTimers()
  setAudioEngineFactory((opts) => createEngine({ ...opts, createContext: () => ctx, transportOptions: { timers } }))
}

function loadPreset(id, project = { id: 1, name: 'P', updated_at: 'T1' }) {
  const p = preset(id)
  useProjectStore().loadProject({ ...project, nodes: p.nodes, edges: p.edges })
  return p
}

const findPattern = () => useProjectStore().nodes.find(n => n.type === 'pattern')

describe('live editing (usePlayback)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useFakeEngine()
  })
  afterEach(() => setAudioEngineFactory())

  it('a parameter change while playing goes to the engine without stopping', async () => {
    loadPreset('preset-bass-arp')
    const audio = useAudioStore()
    const playback = usePlayback()
    await playback.play()
    const before = audio.currentScore
    const pattern = findPattern()
    useProjectStore().updateNodeData(pattern.id, { ...pattern.data, density: 0.9 })
    await nextTick()
    expect(audio.isPlaying).toBe(true)
    expect(audio.currentScore).not.toBe(before)
    expect(audio.currentScore).toBe(playback.currentScore())
  })

  it('a connection change while playing is applied too', async () => {
    loadPreset('preset-bass-arp')
    const audio = useAudioStore()
    const playback = usePlayback()
    await playback.play()
    expect(audio.currentScore.tracks).toHaveLength(2)
    const store = useProjectStore()
    const toOut = store.edges.filter(e => store.nodes.find(n => n.id === e.target)?.type === 'output')
    store.removeEdge(toOut[0].id)
    await nextTick()
    expect(audio.isPlaying).toBe(true)
    expect(audio.currentScore.tracks).toHaveLength(1)
  })

  it('nothing starts by itself: editing or connecting while stopped does not play', async () => {
    loadPreset('preset-bass-arp')
    const audio = useAudioStore()
    const playback = usePlayback()
    const spy = vi.spyOn(audio, 'play')
    const pattern = findPattern()
    useProjectStore().updateNodeData(pattern.id, { ...pattern.data, density: 0.9 })
    useProjectStore().addEdge({ id: 'x', source: 'a', target: 'b' })
    await nextTick()
    await new Promise(r => setTimeout(r, 150)) // the old auto-preview waited 100 ms
    expect(spy).not.toHaveBeenCalled()
    expect(audio.isPlaying).toBe(false)
    expect(playback.refresh()).toBe(false)
  })

  it('every component shares one compilation', () => {
    loadPreset('preset-bass-arp')
    expect(usePlayback().compiled).toBe(usePlayback().compiled)
  })

  it('global swing changes the playing score (applied at the next bar) and the exports', async () => {
    loadPreset('preset-bass-arp')
    const audio = useAudioStore()
    const playback = usePlayback()
    await playback.play()
    audio.setSwing(0.5)
    await nextTick()
    expect(audio.currentScore.swing).toBe(0.5)
    expect(ctx && audio.isPlaying).toBe(true)
    const odd = audio.currentScore.tracks.flatMap(t => t.events).find(e => e.step % 2 === 1)
    expect(odd.time - odd.step).toBeGreaterThanOrEqual(0.25)
  })

  it('the level meter reads the master output while playing', async () => {
    loadPreset('preset-bass-arp')
    const audio = useAudioStore()
    expect(audio.getLevel()).toBeNull()
    await usePlayback().play()
    const analyser = ctx.nodes.find(n => n.kind === 'analyser')
    expect(analyser).toBeTruthy()
    analyser.signal = (i) => (i % 2 ? 0.25 : -0.25)
    const level = audio.getLevel()
    expect(level.peak).toBe(0.25)
    expect(Math.round(level.rmsDb)).toBe(-12)
  })
})

describe('autosave (useAutosave)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const edit = (density) => {
    const p = findPattern()
    useProjectStore().updateNodeData(p.id, { ...p.data, density }, { group: false })
  }
  const okPut = (updated_at = 'T2') => http.put.mockResolvedValue({ data: { id: 1, name: 'P', nodes: [], edges: [], updated_at } })

  it('saves a persisted project once, `delay` ms after the last change', async () => {
    loadPreset('preset-bass-arp')
    okPut()
    const { wrapper } = withSetup(() => useAutosave({ delay: 1000 }))
    edit(0.6); await nextTick()
    vi.advanceTimersByTime(600)
    edit(0.7); await nextTick()
    vi.advanceTimersByTime(999)
    expect(http.put).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.runAllTimersAsync()
    expect(http.put).toHaveBeenCalledTimes(1)
    expect(http.put.mock.calls[0][1].base_updated_at).toBe('T1')
    expect(useProjectStore().isDirty).toBe(false)
    wrapper.unmount()
  })

  it('does not create new projects by itself', async () => {
    loadPreset('preset-bass-arp', { id: null, name: 'Nuevo' })
    const { wrapper } = withSetup(() => useAutosave({ delay: 100 }))
    edit(0.6); await nextTick()
    await vi.runAllTimersAsync()
    expect(http.post).not.toHaveBeenCalled()
    expect(http.put).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('a conflict opens the prompt and pauses autosave until resolved', async () => {
    loadPreset('preset-bass-arp')
    http.put.mockRejectedValueOnce(Object.assign(new Error('409'), {
      response: { status: 409, data: { code: 'conflict', current: { id: 1, updated_at: 'T9' } } }
    }))
    const { result, wrapper } = withSetup(() => useAutosave({ delay: 100 }))
    edit(0.6); await nextTick()
    await vi.runAllTimersAsync()
    expect(result.conflictOpen.value).toBe(true)
    expect(result.status.value.key).toBe('conflict')

    result.resolveLater()
    expect(result.conflictOpen.value).toBe(false)
    edit(0.7); await nextTick()
    await vi.runAllTimersAsync()
    expect(http.put).toHaveBeenCalledTimes(1) // paused

    okPut('T10')
    await result.resolveOverwrite()
    expect(http.put).toHaveBeenCalledTimes(2)
    expect(http.put.mock.calls[1][1]).not.toHaveProperty('base_updated_at')
    expect(result.status.value.key).toBe('saved')
    wrapper.unmount()
  })

  it('"Recargar" loads the server copy', async () => {
    loadPreset('preset-bass-arp')
    http.put.mockRejectedValueOnce(Object.assign(new Error('409'), {
      response: { status: 409, data: { code: 'conflict', current: { id: 1, updated_at: 'T9' } } }
    }))
    const { result, wrapper } = withSetup(() => useAutosave({ delay: 100 }))
    edit(0.6); await nextTick()
    await vi.runAllTimersAsync()
    http.get.mockResolvedValueOnce({ data: { id: 1, name: 'P', nodes: [], edges: [], updated_at: 'T9', metadata: { schemaVersion: 3 } } })
    await result.resolveReload()
    expect(useProjectStore().nodes).toEqual([])
    expect(result.conflictOpen.value).toBe(false)
    expect(useProjectStore().isDirty).toBe(false)
    wrapper.unmount()
  })

  it('leaving: clean → yes; persisted and dirty → saves now and leaves; new project → asks', async () => {
    loadPreset('preset-bass-arp')
    okPut()
    const { result, wrapper } = withSetup(() => useAutosave({ delay: 5000 }))
    expect(await result.confirmLeave()).toBe(true)
    edit(0.6); await nextTick()
    expect(await result.confirmLeave()).toBe(true)
    expect(http.put).toHaveBeenCalledTimes(1)

    loadPreset('preset-bass-arp', { id: null, name: 'Nuevo' })
    edit(0.6); await nextTick()
    const pending = result.confirmLeave()
    await nextTick()
    expect(result.leavePrompt.value.show).toBe(true)
    result.answerLeave('stay')
    expect(await pending).toBe(false)

    const again = result.confirmLeave()
    await nextTick()
    result.answerLeave('discard')
    expect(await again).toBe(true)
    wrapper.unmount()
  })

  it('beforeunload warns only with unsaved changes', async () => {
    loadPreset('preset-bass-arp')
    const { result, wrapper } = withSetup(() => useAutosave({ delay: 5000 }))
    const clean = new Event('beforeunload', { cancelable: true })
    result.onBeforeUnload(clean)
    expect(clean.defaultPrevented).toBe(false)
    edit(0.6); await nextTick()
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    wrapper.unmount()
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false) // listener removed with the editor
  })

  it('manual save of a new project creates it and reports it', async () => {
    loadPreset('preset-bass-arp', { id: null, name: 'Nuevo' })
    http.post.mockResolvedValue({ data: { id: 4, name: 'Nuevo', nodes: [], edges: [], updated_at: 'T1' } })
    const onCreated = vi.fn()
    const { result, wrapper } = withSetup(() => useAutosave({ onCreated }))
    const r = await result.saveNow()
    expect(r.created).toBe(true)
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))
    wrapper.unmount()
  })
})

describe('TransportBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useFakeEngine()
  })
  afterEach(() => setAudioEngineFactory())

  it('has every transport control', () => {
    loadPreset('preset-bass-arp')
    const w = mount(TransportBar)
    expect(w.find('.transport__play').exists()).toBe(true)
    expect(w.find('.transport__toggle').text()).toContain('Loop')
    expect(w.find('.transport__number').exists()).toBe(true)
    expect(w.find('.transport__tap').exists()).toBe(true)
    expect(w.findAll('.transport__range')).toHaveLength(2) // swing, volume
    expect(w.find('.meter').exists()).toBe(true)
    expect(w.find('.transport__pos-value').text()).toBe('–.–.–')
  })

  it('applies the tempo and swing of a loaded project', () => {
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: [], edges: [], metadata: { tempo: 97, swing: 0.3 } })
    mount(TransportBar)
    const audio = useAudioStore()
    expect(audio.tempo).toBe(97)
    expect(audio.swing).toBe(0.3)
    useProjectStore().loadProject({ id: 2, name: 'Q', nodes: [], edges: [] })
    return nextTick().then(() => {
      expect(audio.tempo).toBe(120)
      expect(audio.swing).toBe(0)
    })
  })

  it('tempo, swing, volume and loop controls change the stores (tempo/swing saved with the project)', async () => {
    loadPreset('preset-bass-arp')
    const w = mount(TransportBar)
    const audio = useAudioStore()
    const project = useProjectStore()
    const tempo = w.find('.transport__number')
    tempo.element.value = '140'
    await tempo.trigger('change')
    expect(audio.tempo).toBe(140)
    expect(project.settings.tempo).toBe(140)
    expect(project.isDirty).toBe(true)

    tempo.element.value = '999'
    await tempo.trigger('change')
    expect(audio.tempo).toBe(200)
    expect(tempo.element.value).toBe('200')

    const [swing, volume] = w.findAll('.transport__range')
    swing.element.value = '0.4'
    await swing.trigger('input')
    expect(audio.swing).toBe(0.4)
    expect(project.settings.swing).toBe(0.4)
    volume.element.value = '0.3'
    await volume.trigger('input')
    expect(audio.masterVolume).toBe(0.3)

    const loop = w.find('.transport__toggle')
    await loop.trigger('click')
    expect(audio.loopEnabled).toBe(false)
    expect(loop.attributes('aria-pressed')).toBe('false')
  })

  it('tap tempo follows the taps', async () => {
    loadPreset('preset-bass-arp')
    const now = vi.spyOn(performance, 'now')
    const w = mount(TransportBar)
    for (const t of [1000, 1400, 1800, 2200]) {
      now.mockReturnValue(t)
      await w.find('.transport__tap').trigger('click')
    }
    expect(useAudioStore().tempo).toBe(150)
    now.mockRestore()
  })

  it('play / stop and the position in bars', async () => {
    loadPreset('preset-bass-arp')
    const w = mount(TransportBar)
    await w.find('.transport__play').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    const audio = useAudioStore()
    expect(audio.isPlaying).toBe(true)
    audio.globalStep = 21
    await nextTick()
    expect(w.find('.transport__pos-value').text()).toBe('2.2.2')
    expect(w.find('.transport__play').text()).toContain('Stop')
    await w.find('.transport__play').trigger('click')
    expect(audio.isPlaying).toBe(false)
  })

  it('play is disabled without a playable graph', () => {
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: [], edges: [] })
    const w = mount(TransportBar)
    expect(w.find('.transport__play').attributes('disabled')).toBeDefined()
  })
})

describe('transport controls are not duplicated', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('the sidebar has no tempo, volume, loop or play controls; its palette is the registry', async () => {
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: [], edges: [] })
    const w = mount(AppSidebar, { global: stubs })
    expect(w.findAll('input[type=range]')).toHaveLength(0)
    expect(w.findAll('input[type=checkbox]')).toHaveLength(0)
    expect(w.text()).not.toMatch(/Play|Tempo|Master Volume|Export MIDI/)
    const items = w.findAll('.palette-item')
    expect(items.map(i => i.find('.palette-name').text())).toEqual(paletteEntries().map(e => e.label))
    await items[2].trigger('click')
    expect(w.emitted('add-node')[0]).toEqual([paletteEntries()[2].type])
  })

  it('the piano roll no longer has its own master volume', () => {
    loadPreset('preset-bass-arp')
    const w = mount(TimelinePanel)
    expect(w.text()).not.toContain('Master')
    expect(w.findAll('input[type=range]')).toHaveLength(0)
  })
})

describe('context menu in canvas coordinates', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('useContextMenu converts the cursor with the current zoom and pan', () => {
    // zoom 2, pan (100, 50): screen = flow * 2 + pan
    const toFlow = ({ x, y }) => ({ x: (x - 100) / 2, y: (y - 50) / 2 })
    const { result, wrapper } = withSetup(() => useContextMenu({ toFlowPosition: toFlow }))
    const event = { clientX: 500, clientY: 450, preventDefault: vi.fn() }
    result.openForPane(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(result.menu.value).toMatchObject({ show: true, x: 500, y: 450, flow: { x: 200, y: 200 }, node: null })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(result.menu.value.show).toBe(false)
    result.openForNode({ event, node: { id: 'n' } })
    expect(result.menu.value.node).toEqual({ id: 'n' })
    document.dispatchEvent(new Event('click'))
    expect(result.menu.value.show).toBe(false)
    wrapper.unmount()
  })

  it('the menu lists the registry and emits the canvas point; node actions emit the node', async () => {
    const menu = { show: true, x: 10, y: 20, flow: { x: 200, y: 200 }, node: null }
    const w = mount(CanvasContextMenu, { props: { menu } })
    const items = w.findAll('.context-menu-item')
    expect(items).toHaveLength(paletteEntries().length)
    await items[0].trigger('click')
    expect(w.emitted('add')[0]).toEqual([paletteEntries()[0].type, { x: 200, y: 200 }])

    await w.setProps({ menu: { ...menu, node: { id: 'v', type: 'voice', data: {} } } })
    expect(w.text()).toContain('Voz') // Fase 5B: nombres en español
    const actions = w.findAll('.context-menu-item')
    await actions[0].trigger('click')
    await actions[1].trigger('click')
    await actions[2].trigger('click')
    expect(w.emitted('edit')).toHaveLength(1)
    expect(w.emitted('duplicate')).toHaveLength(1)
    expect(w.emitted('delete')).toHaveLength(1)
  })

  it('a node created from the menu goes to the converted point, not the screen point', () => {
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: [], edges: [] })
    const toFlow = ({ x, y }) => ({ x: (x - 100) / 2, y: (y - 50) / 2 })
    const { result: menu } = withSetup(() => useContextMenu({ toFlowPosition: toFlow }))
    const { result: nodes } = withSetup(() => useEditorNodes())
    menu.openForPane({ clientX: 500, clientY: 450 })
    const node = nodes.addNodeAt('output', menu.menu.value.flow)
    expect(node.position).toEqual({ x: 200, y: 200 })
    expect(useProjectStore().nodes.at(-1)).toMatchObject({ type: 'output', position: { x: 200, y: 200 } })
  })
})

describe('useEditorNodes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useFakeEngine()
  })
  afterEach(() => setAudioEngineFactory())

  it('creates nodes from the registry (defaults included) at the view center', () => {
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: [], edges: [] })
    const { result } = withSetup(() => useEditorNodes({ viewCenter: () => ({ x: 500, y: 300 }) }))
    const n = result.addNodeAtCenter('groove')
    expect(n.position).toEqual({ x: 380, y: 220 })
    expect(n.data).toMatchObject({ label: 'Groove', swing: 0.3 })
    expect(result.selectedNodeId.value).toBe(n.id)
  })

  it('connecting replaces the edge on a used input and never starts playback', async () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const audio = useAudioStore()
    const spy = vi.spyOn(audio, 'play')
    const { result } = withSetup(() => useEditorNodes())
    const voice = store.nodes.find(n => n.type === 'voice')
    const used = store.edges.find(e => e.target === voice.id && e.targetHandle === 'notes')
    // A notes output of the other chain (no cycle)
    const otherSource = store.nodes.find(n => ['scale', 'groove', 'chord'].includes(n.type) && n.id !== used.source &&
      !store.edges.some(e => e.source === voice.id && e.target === n.id)).id
    const count = store.edges.length
    const edge = result.onConnect({ source: otherSource, target: voice.id, sourceHandle: 'notes', targetHandle: 'notes' })
    expect(edge).toMatchObject({ source: otherSource, target: voice.id, targetHandle: 'notes' })
    expect(store.edges).toHaveLength(count)
    expect(store.edges.find(e => e.id === used.id)).toBeUndefined()
    await new Promise(r => setTimeout(r, 150))
    expect(spy).not.toHaveBeenCalled()
  })

  it('autoLayout moves every node through a new array and calls afterLayout', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const afterLayout = vi.fn()
    const { result } = withSetup(() => useEditorNodes({ afterLayout }))
    const before = store.nodes
    result.autoLayout()
    expect(store.nodes).not.toBe(before)
    expect(afterLayout).toHaveBeenCalled()
    expect(store.history).toHaveLength(2)
  })

  it('delete asks first; duplicate makes an independent copy; pointer up ends an undo group', () => {
    loadPreset('preset-bass-arp')
    const store = useProjectStore()
    const { result } = withSetup(() => useEditorNodes())
    const id = store.nodes[0].id
    expect(result.requestDelete(id)).toBe(true)
    expect(store.nodes.some(n => n.id === id)).toBe(true)
    result.confirmDelete()
    expect(store.nodes.some(n => n.id === id)).toBe(false)

    const copy = result.duplicateNode(store.nodes[0].id)
    expect(copy.id).not.toBe(store.nodes[0].id)

    const pattern = findPattern()
    result.updateNodeData(pattern.id, { ...pattern.data, density: 0.6 })
    expect(store.historyGroup).not.toBeNull()
    window.dispatchEvent(new Event('pointerup'))
    expect(store.historyGroup).toBeNull()
  })
})

describe('NodeInspector (replaces NodeEditModal in Fase 4B)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the registered component of the node and edits it live', async () => {
    loadPreset('preset-bass-arp')
    const out = useProjectStore().nodes.find(n => n.type === 'output')
    const w = mount(NodeInspector, { props: { node: out, count: 1 }, global: stubs })
    expect(w.findComponent(getNodeComponent('output')).exists()).toBe(true)
    w.findComponent(getNodeComponent('output')).vm.$emit('update', { ...out.data, mute: true })
    expect(w.emitted('update')[0]).toEqual([out.id, { ...out.data, mute: true }])
    await w.setProps({ node: null, count: 0 })
    expect(w.findComponent(getNodeComponent('output')).exists()).toBe(false)
  })
})
