import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import TimelinePanel from '../components/TimelinePanel.vue'
import EffectsNode from '../components/nodes/EffectsNode.vue'
import OutputNode from '../components/nodes/OutputNode.vue'
import VoiceNode from '../components/nodes/VoiceNode.vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { createNodeData } from '../audio/graph/nodeTypes.js'
import { usePlayback } from '../composables/usePlayback.js'
import { createEngine } from '../audio/engine/index.js'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

// Handles need a Vue Flow instance; the ports are tested elsewhere.
const stubs = { stubs: { NodePorts: true } }
const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))

describe('piano roll multipista (TimelinePanel)', () => {
  let ctx, timers
  beforeEach(() => {
    setActivePinia(createPinia())
    ctx = new FakeAudioContext()
    timers = createFakeTimers()
    setAudioEngineFactory((opts) => createEngine({ ...opts, createContext: () => ctx, transportOptions: { timers } }))
  })
  afterEach(() => setAudioEngineFactory())

  const load = (id) => {
    const p = preset(id)
    useProjectStore().loadProject({ id: 1, name: 'P', nodes: p.nodes, edges: p.edges })
    return p
  }

  it('una fila por pista con notas de color y largo propio', () => {
    load('preset-poly-3-4')
    const w = mount(TimelinePanel)
    const rows = w.findAll('.roll__row:not(.roll__row--ruler)')
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.find('.roll__name').text())).toEqual(['Tres', 'Cuatro', 'Pulso'])
    // 3, 4 and 12 notes in the 12-step cycle (all tracks are 12 long: no ghosts)
    expect(rows.map(r => r.findAll('.lane__note').length)).toEqual([3, 4, 12])
    const colors = rows.map(r => r.find('.lane__note').attributes('style').match(/background: ([^;]+)/)[1])
    expect(new Set(colors).size).toBe(3)
  })

  it('mute y solo desde el timeline escriben la Salida y se aplican en caliente', async () => {
    const p = load('preset-bass-arp')
    const audio = useAudioStore()
    const playback = usePlayback()
    await audio.play(playback.currentScore())
    const w = mount(TimelinePanel)
    await w.findAll('.mix-btn--mute')[0].trigger('click')
    const out = () => useProjectStore().nodes.find(n => n.id === 'preset-bassarp-bass-out')
    expect(out().data.mute).toBe(true)
    // the bus of that track was muted right away (no bar wait)
    const muted = ctx.nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'target' && e[1] === 0 && e[3] === 0.015))
    expect(muted).toHaveLength(1)
    await w.vm.$nextTick()
    expect(w.findAll('.roll__row--silent')).toHaveLength(1)

    await w.findAll('.mix-btn--solo')[0].trigger('click')
    expect(out().data.solo).toBe(true)
    expect(out().data.mute).toBe(true)
    await w.vm.$nextTick()
    // solo on the (muted) bass: the bass is heard, the arpeggio is not
    expect(w.findAll('.roll__row')[1].classes()).not.toContain('roll__row--silent')
    expect(w.findAll('.roll__row')[2].classes()).toContain('roll__row--silent')
    expect(p.nodes.length).toBe(useProjectStore().nodes.length)
    audio.stop()
  })

  it('cursor global y cursor propio de cada pista', async () => {
    load('preset-ambient-gen')
    const audio = useAudioStore()
    const w = mount(TimelinePanel)
    expect(w.find('.roll__playhead').exists()).toBe(false)
    audio.isPlaying = true
    audio.globalStep = 70
    const ids = useProjectStore().nodes.filter(n => n.type === 'output').map(n => n.id)
    audio.trackSteps = { [ids[0]]: 6, [ids[1]]: 22, [ids[2]]: 30 }
    await w.vm.$nextTick()
    // defaultCellWidth(64) = 16 px per step; header 150 px
    const left = parseFloat(w.find('.roll__playhead').attributes('style').match(/left: ([\d.]+)px/)[1])
    expect(left).toBe(150 + (70 % 64) * 16)
    const locals = w.findAll('.roll__local').map(x => parseFloat(x.attributes('style').match(/left: ([\d.]+)px/)[1]))
    expect(locals).toEqual([6 * 16, 22 * 16, 30 * 16])
    // the shorter lanes show where they repeat
    expect(w.findAll('.lane__repeat')).toHaveLength(2)
    audio.isPlaying = false
  })

  it('en modo compatibilidad (sin Salida) mute/solo quedan deshabilitados', () => {
    useProjectStore().loadProject({
      id: 2,
      name: 'Viejo',
      nodes: [{ id: 'p', type: 'pattern', data: { seed: 0.3, density: 0.5 } }, { id: 'v', type: 'voice', data: { instrument: 'Bass' } }],
      edges: [{ id: 'e', source: 'p', target: 'v' }]
    })
    const w = mount(TimelinePanel)
    expect(w.findAll('.roll__row:not(.roll__row--ruler)')).toHaveLength(1)
    expect(w.find('.mix-btn--mute').attributes('disabled')).toBeDefined()
    expect(usePlayback().setTrackMix('track-1', { mute: true })).toBe(false)
  })
})

describe('nodos Efectos, Salida y Voz', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('EffectsNode: activar un efecto y mover un parámetro emiten datos completos', async () => {
    const data = createNodeData('effects')
    const w = mount(EffectsNode, { props: { data }, global: stubs })
    expect(w.findAll('.fx-block')).toHaveLength(4)
    await w.findAll('.fx-block__head input')[2].setValue(true) // delay
    const sent = w.emitted('update')[0][0]
    expect(sent.delay).toMatchObject({ enabled: true, time: 0.375, feedback: 0.4 })
    expect(sent.reverb).toEqual(data.reverb)

    const w2 = mount(EffectsNode, { props: { data: sent }, global: stubs })
    const delayBlock = w2.findAll('.fx-block')[2]
    const ranges = delayBlock.findAll('input[type="range"]')
    expect(ranges).toHaveLength(3) // cantidad, tiempo, realimentación
    await ranges[2].setValue('1')
    expect(w2.emitted('update')[0][0].delay.feedback).toBeCloseTo(0.9)
  })

  it('EffectsNode: el corte del filtro usa escala logarítmica', async () => {
    const data = { ...createNodeData('effects'), filter: { enabled: true, amount: 1, mode: 'lowpass', cutoff: 1200, resonance: 1 } }
    const w = mount(EffectsNode, { props: { data }, global: stubs })
    const cutoff = w.findAll('.fx-block')[1].findAll('input[type="range"]')[1]
    await cutoff.setValue('0.5')
    expect(w.emitted('update')[0][0].filter.cutoff).toBeCloseTo(Math.sqrt(40 * 18000), 0)
    await w.findAll('.fx-block')[1].findAll('button')[1].trigger('click')
    expect(w.emitted('update')[1][0].filter.mode).toBe('highpass')
  })

  it('OutputNode: volumen, paneo, mute y solo', async () => {
    const data = createNodeData('output')
    const w = mount(OutputNode, { props: { data }, global: stubs })
    await w.find('.mix-btn--mute').trigger('click')
    expect(w.emitted('update')[0][0]).toMatchObject({ mute: true, solo: false, volume: 1 })
    await w.find('.mix-btn--solo').trigger('click')
    expect(w.emitted('update')[1][0].solo).toBe(true)
    await w.findAll('input[type="range"]')[0].setValue('0.25')
    expect(w.emitted('update')[2][0].volume).toBe(0.25)
  })

  it('VoiceNode ya no muestra los efectos "próximamente"', () => {
    const w = mount(VoiceNode, { props: { data: createNodeData('voice') }, global: stubs })
    expect(w.text()).not.toMatch(/próximamente/)
    expect(w.findAll('.effect-btn')).toHaveLength(0)
    expect(w.text()).toMatch(/nodo Efectos/)
  })
})

describe('useProjectStore.updateNode (Fase 3B)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('un cambio de datos reemplaza el arreglo (Vue Flow solo sincroniza así); la posición no', () => {
    const store = useProjectStore()
    store.loadProject({ id: 1, name: 'P', nodes: [{ id: 'a', type: 'output', position: { x: 0, y: 0 }, data: { mute: false } }], edges: [] })
    const before = store.nodes
    store.updateNode('a', { position: { x: 5, y: 5 } }, { history: false })
    expect(store.nodes).toBe(before)
    store.updateNode('a', { data: { mute: true } })
    expect(store.nodes).not.toBe(before)
    expect(store.nodes[0]).toMatchObject({ id: 'a', position: { x: 5, y: 5 }, data: { mute: true } })
    expect(store.canUndo).toBe(true)
  })
})
