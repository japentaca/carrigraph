// Fase 5B — closing review fixes (texts, labels, presets, stems zip, small
// screens) and the extras: live recording, performance mode (mute/solo,
// variations, macros) and MIDI input (simulated messages; no hardware).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, defineComponent, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/http.js', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } } }))

import http from '../api/http.js'
import { translateServerMessage } from '../api/messages.js'
import { NODE_TYPES, LEGACY_LABELS, nodeLabel } from '../audio/graph/nodeTypes.js'
import { nodeDisplayName, paletteEntries } from '../components/nodes/nodeRegistry.js'
import { searchPalette } from '../editor/palette.js'
import { usePresetStore, MULTITRACK_PRESETS } from '../stores/usePresetStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useAudioStore, setAudioEngineFactory } from '../stores/useAudioStore'
import { compileGraph } from '../audio/graph/compile.js'
import { createZip, readZip, crc32 } from '../editor/zip.js'
import { stemsZip, stemsZipName, stemFileNames, usePlayback } from '../composables/usePlayback.js'
import {
  createRecorder, pickRecordingMimeType, recordingExtension, canRecord, formatRecordingTime, RECORDING_MIME_TYPES
} from '../audio/engine/recorder.js'
import { createEngine } from '../audio/engine/index.js'
import { useRecording, recordingFileName } from '../composables/useRecording.js'
import {
  MACRO_COUNT, applyMacro, assignableParams, defaultMacros, isAssignable, isDefaultMacros, macrosSignature,
  missingTargets, normalizeMacros, paramSpec, positionFromValue, valueFromPosition
} from '../audio/graph/macros.js'
import { NODE_PARAMS, isValidParamValue } from '../audio/graph/nodeParams.js'
import {
  parseMidiMessage, controlToRange, velocityToGain, createMidiInput, midiSupported
} from '../audio/midiInput.js'
import { useMidiInput, controlTarget, applyControlChange } from '../composables/useMidiInput.js'
import PerformancePanel from '../components/editor/PerformancePanel.vue'
import TransportBar from '../components/editor/TransportBar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'
import App from '../App.vue'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

const preset = (id) => JSON.parse(JSON.stringify(MULTITRACK_PRESETS.find(p => p.id === id)))

function withSetup(setup) {
  let result
  const wrapper = mount(defineComponent({ setup() { result = setup(); return () => h('div') } }))
  return { result, wrapper }
}

// --- Fake MediaRecorder / recordable context --------------------------------
class FakeMediaRecorder {
  static supported = ['audio/webm']
  static isTypeSupported(t) { return FakeMediaRecorder.supported.includes(t) }
  static instances = []
  constructor(stream, opts = {}) {
    this.stream = stream
    this.mimeType = opts.mimeType || 'audio/webm'
    this.state = 'inactive'
    FakeMediaRecorder.instances.push(this)
  }
  start(timeslice) { this.state = 'recording'; this.timeslice = timeslice }
  emit(text) { this.ondataavailable?.({ data: new Blob([text]) }) }
  stop() {
    this.state = 'inactive'
    this.emit('end')
    this.onstop?.()
  }
}

class RecordableContext extends FakeAudioContext {
  createMediaStreamDestination() {
    const n = this.createGain()
    n.kind = 'streamDestination'
    n.stream = { id: 'stream' }
    return n
  }
}

let ctx
function useFakeEngine(Ctx = RecordableContext) {
  ctx = new Ctx()
  const timers = createFakeTimers()
  setAudioEngineFactory((opts) => createEngine({ ...opts, createContext: () => ctx, transportOptions: { timers } }))
}

// ============================================================================
describe('closing review: Spanish texts and node names', () => {
  it('translates the API messages the UI shows and leaves unknown ones', () => {
    expect(translateServerMessage('Invalid email or password')).toBe('Email o contraseña incorrectos.')
    expect(translateServerMessage('User with this email already exists')).toBe('Ya existe una cuenta con ese email.')
    expect(translateServerMessage('Password must be at least 8 characters long')).toBe('La contraseña debe tener al menos 8 caracteres.')
    expect(translateServerMessage('New password must be at least 8 characters long')).toBe('La contraseña debe tener al menos 8 caracteres.')
    expect(translateServerMessage('Internal server error while saving project')).toMatch(/^Error interno/)
    expect(translateServerMessage('Demasiados intentos. Probá de nuevo en unos minutos.')).toBe('Demasiados intentos. Probá de nuevo en unos minutos.')
    expect(translateServerMessage(undefined)).toBeUndefined()
  })

  it('the original node types have Spanish names; saved English defaults show the new name', () => {
    expect(NODE_TYPES.pattern.label).toBe('Generador de patrones')
    expect(NODE_TYPES.length.label).toBe('Largo del patrón')
    expect(NODE_TYPES.loop.label).toBe('Tamaño de loop')
    expect(NODE_TYPES.voice.label).toBe('Voz')
    for (const [type, old] of Object.entries(LEGACY_LABELS)) {
      // stored data and type are not renamed: only the shown name changes
      expect(nodeLabel({ type, data: { label: old } })).toBe(NODE_TYPES[type].label)
      expect(nodeDisplayName({ type, data: { label: old } })).toBe(NODE_TYPES[type].label)
    }
    // a name the user typed is kept, also an English one for another type
    expect(nodeLabel({ type: 'voice', data: { label: 'Bajo' } })).toBe('Bajo')
    expect(nodeLabel({ type: 'pattern', data: { label: 'Voice Selector' } })).toBe('Voice Selector')
    expect(nodeLabel({ type: 'raro', data: {} })).toBe('raro')
  })

  it('diagnostics use the new names for old projects', () => {
    const nodes = [{ id: 'v', type: 'voice', data: { label: 'Voice Selector', instrument: 'Piano' } }, { id: 'o', type: 'output', data: {} }]
    const { diagnostics } = compileGraph(nodes, [])
    expect(diagnostics.some(d => d.message.includes('Voice Selector'))).toBe(false)
  })

  it('the palette still finds the old English names', () => {
    expect(searchPalette(paletteEntries(), 'pattern generator')[0].type).toBe('pattern')
    expect(searchPalette(paletteEntries(), 'voice selector')[0].type).toBe('voice')
    expect(searchPalette(paletteEntries(), 'voz')[0].type).toBe('voice')
  })

  it('preset names and categories are in Spanish; old user presets keep working', () => {
    setActivePinia(createPinia())
    const store = usePresetStore()
    const names = store.categories.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['Batería', 'Melódicos', 'Ambiente', 'Multipista']))
    expect(names.some(n => ['Drums', 'Melodic', 'Ambient'].includes(n))).toBe(false)
    store.userPresets = [{ id: 'u1', name: 'Mío', category: 'User', nodes: [], edges: [] }]
    expect(store.categories.find(c => c.name === 'Mis presets').presets[0].name).toBe('Mío')
    const all = store.categories.flatMap(c => c.presets.map(p => p.name))
    expect(all).not.toContain('Kick Pattern')
    expect(all).toContain('Bombo 4/4')
  })

  it('the app root is a column that lets every view use the whole width', () => {
    setActivePinia(createPinia())
    const w = mount(App, { global: { stubs: { RouterView: true, 'router-view': true, ToastContainer: true } } })
    expect(w.classes()).toContain('app-root')
    expect(w.attributes('id')).toBeUndefined() // it used to be a second #app (centered by index.html)
  })
})

// ============================================================================
describe('stems as one .zip', () => {
  it('crc32 is the ZIP one', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('createZip → readZip round trip with UTF-8 names and binary data', () => {
    const wav = new Uint8Array([82, 73, 70, 70, 0, 255, 128, 1])
    const zip = createZip([{ name: 'Tema - 01 Bajo ñ.wav', data: wav }, { name: 'b.txt', data: 'hola' }], { date: new Date(2026, 10, 13, 10, 30) })
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const files = readZip(zip)
    expect(files.map(f => f.name)).toEqual(['Tema - 01 Bajo ñ.wav', 'b.txt'])
    expect([...files[0].data]).toEqual([...wav])
    expect(new TextDecoder().decode(files[1].data)).toBe('hola')
    expect(files.every(f => f.crcOk)).toBe(true)
  })

  it('stemsZip packs one WAV per track with the stem names', async () => {
    const stems = [{ track: { name: 'Bajo' }, blob: new Blob([new Uint8Array([1, 2, 3])]) }, { track: { name: 'A/B' }, blob: new Blob([new Uint8Array([4])]) }]
    const names = stemFileNames('Mi: tema', stems.map(s => s.track))
    const blob = await stemsZip(stems, names)
    expect(blob.type).toBe('application/zip')
    const files = readZip(new Uint8Array(await blob.arrayBuffer()))
    expect(files.map(f => f.name)).toEqual(['Mi_ tema - 01 Bajo.wav', 'Mi_ tema - 02 A_B.wav'])
    expect([...files[0].data]).toEqual([1, 2, 3])
    expect(stemsZipName('Mi: tema')).toBe('Mi_ tema - stems.zip')
    expect(stemsZipName('')).toBe('proyecto - stems.zip')
  })

  it('exportStems downloads a single .zip for several tracks', async () => {
    setActivePinia(createPinia())
    useFakeEngine()
    const p = preset('preset-bass-arp')
    useProjectStore().loadProject({ id: 1, name: 'Tema', nodes: p.nodes, edges: p.edges })
    const audio = useAudioStore()
    audio.exportStems = vi.fn(async (score) => ({
      stems: score.tracks.map(track => ({ track, blob: new Blob([new Uint8Array([1])]) })), duration: 2
    }))
    const clicks = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push(this.download) })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const { result } = withSetup(() => usePlayback())
    await result.exportStems()
    expect(clicks).toEqual(['Tema - stems.zip'])
    spy.mockRestore()
  })
})

// ============================================================================
describe('small screens', () => {
  afterEach(() => { delete window.matchMedia })

  it('the piano roll starts folded on a phone and open on a wide screen', () => {
    setActivePinia(createPinia())
    window.matchMedia = vi.fn(() => ({ matches: true }))
    const folded = mount(TimelinePanel)
    expect(folded.find('.timeline-panel--collapsed').exists()).toBe(true)
    window.matchMedia = vi.fn(() => ({ matches: false }))
    const open = mount(TimelinePanel)
    expect(open.find('.timeline-panel--collapsed').exists()).toBe(false)
  })
})

// ============================================================================
describe('live recording (engine/recorder.js)', () => {
  beforeEach(() => { FakeMediaRecorder.instances = []; FakeMediaRecorder.supported = ['audio/webm'] })

  it('picks a supported container and names the file', () => {
    expect(pickRecordingMimeType(FakeMediaRecorder)).toBe('audio/webm')
    FakeMediaRecorder.supported = ['audio/ogg;codecs=opus']
    expect(pickRecordingMimeType(FakeMediaRecorder)).toBe('audio/ogg;codecs=opus')
    FakeMediaRecorder.supported = []
    expect(pickRecordingMimeType(FakeMediaRecorder)).toBe('')
    expect(pickRecordingMimeType(undefined)).toBe(null)
    expect(RECORDING_MIME_TYPES[0]).toBe('audio/webm;codecs=opus')
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(recordingExtension('audio/ogg')).toBe('ogg')
    expect(recordingExtension('audio/mp4')).toBe('m4a')
    expect(formatRecordingTime(0)).toBe('0:00')
    expect(formatRecordingTime(65_400)).toBe('1:05')
    expect(formatRecordingTime(3_725_000)).toBe('1:02:05')
    expect(recordingFileName('Mi: tema', 'audio/webm', new Date(2026, 10, 13, 9, 5))).toBe('Mi_ tema - grabación 2026-11-13 09-05.webm')
  })

  it('canRecord needs MediaRecorder and a MediaStream destination', () => {
    expect(canRecord({ context: new RecordableContext(), Recorder: FakeMediaRecorder })).toBe(true)
    expect(canRecord({ context: new FakeAudioContext(), Recorder: FakeMediaRecorder })).toBe(false)
    expect(canRecord({ context: new RecordableContext(), Recorder: undefined })).toBe(false)
  })

  it('records the source node into chunks and returns one blob; disconnects after', async () => {
    const c = new RecordableContext()
    const source = c.createGain()
    let now = 1000
    const rec = createRecorder({ context: c, source, Recorder: FakeMediaRecorder, now: () => now })
    expect(rec.start()).toBe(true)
    expect(rec.start()).toBe(false) // already recording
    const dest = source.connections[0]
    expect(dest.kind).toBe('streamDestination')
    const mr = FakeMediaRecorder.instances[0]
    expect(mr.stream).toBe(dest.stream)
    expect(mr.timeslice).toBe(1000)
    mr.emit('abc')
    now = 3500
    expect(rec.elapsed()).toBe(2500)
    const take = await rec.stop()
    expect(take.duration).toBe(2.5)
    expect(take.mimeType).toBe('audio/webm')
    expect(await take.blob.text()).toBe('abcend')
    expect(source.connections).toHaveLength(0)
    expect(rec.isRecording()).toBe(false)
    expect(await rec.stop()).toBe(null)
  })

  it('throws (and cleans up) when recording is not possible', () => {
    const c = new FakeAudioContext()
    const rec = createRecorder({ context: c, source: c.createGain(), Recorder: FakeMediaRecorder })
    expect(() => rec.start()).toThrow()
  })

  it('the engine records its master output: live mute is in the take', async () => {
    useFakeEngine()
    globalThis.MediaRecorder = FakeMediaRecorder
    try {
      setActivePinia(createPinia())
      const audio = useAudioStore()
      expect(audio.canRecord()).toBe(false) // jsdom has no AudioContext; ok before the engine exists
      expect(await audio.startRecording()).toBe(true)
      expect(audio.isRecording).toBe(true)
      expect(audio.recordingStartedAt).toBeGreaterThan(0)
      // the recorder listens after the master volume (what is heard)
      const dest = ctx.nodes.find(n => n.kind === 'streamDestination')
      const tapped = ctx.nodes.filter(n => n.connections.includes(dest))
      expect(tapped).toHaveLength(1)
      FakeMediaRecorder.instances[0].emit('x')
      const take = await audio.stopRecording()
      expect(take.blob.size).toBeGreaterThan(0)
      expect(audio.isRecording).toBe(false)
      expect(await audio.stopRecording()).toBe(null)
    } finally {
      delete globalThis.MediaRecorder
    }
  })

  it('useRecording toggles, shows the time and downloads the take', async () => {
    useFakeEngine()
    globalThis.MediaRecorder = FakeMediaRecorder
    const clicks = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push(this.download) })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    try {
      setActivePinia(createPinia())
      const audio = useAudioStore()
      audio.canRecord = () => true
      const { result, wrapper } = withSetup(() => useRecording({ name: () => 'Tema' }))
      await result.toggle()
      expect(result.isRecording.value).toBe(true)
      expect(result.elapsedLabel.value).toBe('0:00')
      FakeMediaRecorder.instances.at(-1).emit('datos')
      await result.toggle()
      expect(result.isRecording.value).toBe(false)
      expect(clicks).toHaveLength(1)
      expect(clicks[0]).toMatch(/^Tema - grabación \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.webm$/)
      wrapper.unmount()
    } finally {
      spy.mockRestore()
      delete globalThis.MediaRecorder
    }
  })

  it('without MediaRecorder the button is disabled and nothing breaks', () => {
    setActivePinia(createPinia())
    const w = mount(TransportBar)
    const rec = w.find('.transport__rec')
    expect(rec.exists()).toBe(true)
    expect(rec.attributes('disabled')).toBeDefined()
  })
})

// ============================================================================
describe('performance macros (graph/macros.js)', () => {
  const fxNode = () => ({ id: 'fx', type: 'effects', data: { filter: { enabled: true, cutoff: 1000, resonance: 1 }, delay: { time: 0.25 } } })
  const patNode = () => ({ id: 'p', type: 'pattern', data: { density: 0.5, rotation: 0, algorithm: 'euclidean' } })

  it('only numbers, integers and lists of numbers are assignable', () => {
    expect(isAssignable(paramSpec('effects', 'filter.cutoff'))).toBe(true)
    expect(isAssignable(paramSpec('pattern', 'rotation'))).toBe(true)
    expect(isAssignable(paramSpec('length', 'value'))).toBe(true) // 8, 12, 16 …
    expect(isAssignable(paramSpec('pattern', 'algorithm'))).toBe(false)
    expect(isAssignable(paramSpec('effects', 'filter.enabled'))).toBe(false)
    expect(isAssignable(paramSpec('steps', 'steps'))).toBe(false)
    expect(assignableParams('chord')).toEqual([])
    expect(assignableParams('effects').map(p => p.path)).toContain('reverb.decay')
  })

  it('every position of every assignable param gives a value inside its registry range', () => {
    for (const [type, params] of Object.entries(NODE_PARAMS)) {
      for (const [path, spec] of Object.entries(params)) {
        if (!isAssignable(spec)) continue
        for (let i = 0; i <= 20; i++) {
          const v = valueFromPosition(spec, i / 20)
          expect(isValidParamValue(spec, v), `${type}.${path} @ ${i / 20} = ${v}`).toBe(true)
        }
        expect(valueFromPosition(spec, -5)).toBe(valueFromPosition(spec, 0))
        expect(valueFromPosition(spec, 9)).toBe(valueFromPosition(spec, 1))
      }
    }
  })

  it('positions map back (number, int, list)', () => {
    const cutoff = paramSpec('effects', 'filter.cutoff')
    expect(valueFromPosition(cutoff, 0)).toBe(cutoff.min)
    expect(valueFromPosition(cutoff, 1)).toBe(cutoff.max)
    expect(positionFromValue(cutoff, valueFromPosition(cutoff, 0.5))).toBeCloseTo(0.5, 2)
    const len = paramSpec('length', 'value')
    expect(valueFromPosition(len, 0)).toBe(8)
    expect(valueFromPosition(len, 1)).toBe(64)
    expect(positionFromValue(len, 64)).toBe(1)
    expect(valueFromPosition(paramSpec('pattern', 'rotation'), 0.5)).toBe(8)
  })

  it('normalizes saved macros: always 4 slots, clean names, values and targets', () => {
    expect(defaultMacros()).toHaveLength(MACRO_COUNT)
    const m = normalizeMacros([{ name: '  Filtro  ', value: 7, targets: [{ nodeId: 3, path: 'density' }, { nodeId: '3', path: 'density' }, { path: 'x' }, null], extra: 1 }, 'basura'])
    expect(m).toHaveLength(4)
    expect(m[0]).toEqual({ id: 'm1', name: 'Filtro', value: 1, targets: [{ nodeId: '3', path: 'density' }] })
    expect(m[1]).toEqual(defaultMacros()[1])
    expect(normalizeMacros(null)).toEqual(defaultMacros())
    expect(isDefaultMacros(null)).toBe(true)
    expect(macrosSignature(defaultMacros())).toBe('')
    expect(macrosSignature(m)).not.toBe('')
  })

  it('applyMacro moves several params of several nodes, pure, with invert', () => {
    const nodes = [fxNode(), patNode()]
    const before = JSON.stringify(nodes)
    const macro = { id: 'm1', targets: [
      { nodeId: 'fx', path: 'filter.cutoff' },
      { nodeId: 'fx', path: 'filter.resonance', invert: true },
      { nodeId: 'p', path: 'density' },
      { nodeId: 'gone', path: 'density' },
      { nodeId: 'p', path: 'algorithm' } // not assignable: skipped
    ] }
    const out = applyMacro(macro, 1, nodes)
    expect(JSON.stringify(nodes)).toBe(before)
    expect(Object.keys(out).sort()).toEqual(['fx', 'p'])
    expect(out.fx.filter.cutoff).toBe(NODE_PARAMS.effects['filter.cutoff'].max)
    expect(out.fx.filter.resonance).toBe(NODE_PARAMS.effects['filter.resonance'].min)
    expect(out.fx.filter.enabled).toBe(true) // the rest of the data is kept
    expect(out.p.density).toBe(NODE_PARAMS.pattern.density.max)
    expect(out.p.algorithm).toBe('euclidean')
    expect(missingTargets(macro, nodes)).toEqual([{ nodeId: 'gone', path: 'density' }])
  })

  it('the project store loads, saves and clears macros; moving one is one undo entry', async () => {
    setActivePinia(createPinia())
    const store = useProjectStore()
    store.loadProject({ id: 1, name: 'P', updated_at: 'T1', nodes: [fxNode()], edges: [], metadata: { tempo: 100 } })
    expect(store.macros).toEqual(defaultMacros())
    expect(store.isDirty).toBe(false)

    const macros = defaultMacros()
    macros[0].targets = [{ nodeId: 'fx', path: 'filter.cutoff' }]
    store.setMacros(macros)
    expect(store.isDirty).toBe(true)
    http.put.mockResolvedValueOnce({ data: { id: 1, name: 'P', updated_at: 'T2' } })
    await store.saveCurrent()
    const body = http.put.mock.calls.at(-1)[1]
    expect(body.metadata.macros[0].targets).toEqual([{ nodeId: 'fx', path: 'filter.cutoff' }])
    expect(store.isDirty).toBe(false)

    // a slider gesture = one undo entry
    const start = store.historyIndex
    for (const v of [0.2, 0.4, 0.6, 0.8]) {
      store.updateNodesData(applyMacro(store.macros[0], v, store.nodes), { group: 'macro:m1' })
    }
    expect(store.historyIndex).toBe(start + 1)
    store.undo()
    expect(store.nodes[0].data.filter.cutoff).toBe(1000)

    // clearing every macro sends null so the server copy is removed too
    store.setMacros(defaultMacros())
    http.put.mockResolvedValueOnce({ data: { id: 1, name: 'P', updated_at: 'T3' } })
    store.currentProject.updated_at = 'T2'
    await store.saveCurrent()
    expect(http.put.mock.calls.at(-1)[1].metadata.macros).toBe(null)
    // and a project that never had macros does not send the key
    store.loadProject({ id: 2, name: 'Q', updated_at: 'X', nodes: [], edges: [], metadata: {} })
    store.setSettings({ tempo: 99 })
    http.put.mockResolvedValueOnce({ data: { id: 2, name: 'Q', updated_at: 'Y' } })
    await store.saveCurrent()
    expect('macros' in http.put.mock.calls.at(-1)[1].metadata).toBe(false)
  })
})

// ============================================================================
describe('performance panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useFakeEngine()
    const p = preset('preset-bass-arp')
    useProjectStore().loadProject({ id: 1, name: 'P', updated_at: 'T1', nodes: p.nodes, edges: p.edges })
  })

  it('big mute / solo per track write the Output node', async () => {
    const w = mount(PerformancePanel)
    const tracks = w.findAll('.perf__track')
    expect(tracks).toHaveLength(2)
    await tracks[0].find('.perf__big--mute').trigger('click')
    const out = useProjectStore().nodes.find(n => n.id === 'preset-bassarp-bass-out')
    expect(out.data.mute).toBe(true)
    await nextTick()
    expect(w.findAll('.perf__track')[0].find('.perf__big--mute').classes()).toContain('perf__big--on')
    await w.findAll('.perf__track')[1].find('.perf__big--solo').trigger('click')
    expect(useProjectStore().nodes.find(n => n.id === 'preset-bassarp-arp-out').data.solo).toBe(true)
  })

  it('variations renew free seeds only (locked ones stay), in one undo entry, and change the notes', async () => {
    const store = useProjectStore()
    const scale = store.nodes.find(n => n.id === 'preset-bassarp-arp-scale')
    store.updateNodeData(scale.id, { ...scale.data, mode: 'random' }, { group: false })
    const bassScale = store.nodes.find(n => n.id === 'preset-bassarp-bass-scale')
    store.updateNodeData(bassScale.id, { ...bassScale.data, seedLocked: true }, { group: false })
    const seeds = () => Object.fromEntries(store.nodes.filter(n => n.data.seed !== undefined).map(n => [n.id, n.data.seed]))
    const before = seeds()
    const notes = () => JSON.stringify(compileGraph(store.nodes, store.edges).score.tracks.map(t => t.events.map(e => e.midi)))
    const notesBefore = notes()
    const start = store.historyIndex
    const w = mount(PerformancePanel)
    await w.find('.perf__wide').trigger('click')
    const after = seeds()
    expect(after['preset-bassarp-bass-scale']).toBe(before['preset-bassarp-bass-scale'])
    expect(after['preset-bassarp-arp-scale']).not.toBe(before['preset-bassarp-arp-scale'])
    expect(store.historyIndex).toBe(start + 1)
    expect(notes()).not.toBe(notesBefore)
  })

  it('assigns a param to a macro (starting where it is) and moving the slider moves it live', async () => {
    const store = useProjectStore()
    const audio = useAudioStore()
    const w = mount(PerformancePanel)
    const fx = store.nodes.find(n => n.type === 'effects')
    const macro = w.findAll('.perf__macro')[0]
    const [nodeSel, paramSel] = macro.findAll('select')
    await nodeSel.setValue(String(fx.id))
    await paramSel.setValue('filter.cutoff')
    await macro.find('.cg-btn').trigger('click')
    expect(store.macros[0].targets).toEqual([{ nodeId: String(fx.id), path: 'filter.cutoff' }])
    const spec = paramSpec('effects', 'filter.cutoff')
    expect(store.macros[0].value).toBeCloseTo(positionFromValue(spec, fx.data.filter.cutoff), 5)

    audio.updateScore = vi.fn()
    audio.isPlaying = true // the live-edit watcher sends recompilations to the engine
    await w.findAll('.perf__macro')[0].find('.perf__macro-slider').setValue('1')
    await nextTick()
    const updated = store.nodes.find(n => n.id === fx.id)
    expect(updated.data.filter.cutoff).toBe(spec.max)
    expect(audio.updateScore).toHaveBeenCalled()
    audio.isPlaying = false
  })
})

// ============================================================================
describe('MIDI input (simulated messages; not tried with hardware)', () => {
  it('parses note on/off, running-status note off, CC and pitch bend', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'noteon', channel: 1, note: 60, velocity: 100 })
    expect(parseMidiMessage([0x93, 64, 0])).toEqual({ type: 'noteoff', channel: 4, note: 64, velocity: 0 })
    expect(parseMidiMessage([0x8f, 64, 40])).toEqual({ type: 'noteoff', channel: 16, note: 64, velocity: 40 })
    expect(parseMidiMessage([0xb0, 74, 127])).toEqual({ type: 'cc', channel: 1, controller: 74, value: 127 })
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: 'pitchbend', channel: 1, value: 0 })
    expect(parseMidiMessage([0xf8])).toEqual({ type: 'other' }) // clock
    expect(parseMidiMessage([])).toEqual({ type: 'other' })
    expect(parseMidiMessage([0x40, 1, 2])).toEqual({ type: 'other' }) // data byte
  })

  it('maps a controller to a control range and velocities to gain', () => {
    expect(controlToRange(0, { min: 0, max: 1, step: 0.01 })).toBe(0)
    expect(controlToRange(127, { min: 0, max: 1, step: 0.01 })).toBe(1)
    expect(controlToRange(64, { min: 40, max: 18000, step: 1 })).toBe(Math.round(40 + (64 / 127) * 17960))
    expect(controlToRange(64, { min: -1, max: 1, step: 0.1 })).toBe(0)
    expect(controlToRange(200, { min: 0, max: 10 })).toBe(10)
    expect(controlToRange(10, { min: 5, max: 5 })).toBe(5)
    expect(velocityToGain(0)).toBe(0)
    expect(velocityToGain(127)).toBe(1)
    expect(velocityToGain(1)).toBeGreaterThan(0.15)
  })

  function fakeAccess() {
    const inputs = new Map()
    const add = (id, name) => { const input = { id, name, onmidimessage: null }; inputs.set(id, input); return input }
    return { access: { inputs, onstatechange: null }, add }
  }

  it('listens to every input, also ones plugged in later, and stops when disabled', async () => {
    const { access, add } = fakeAccess()
    const kb = add('a', 'Teclado')
    const got = []
    const devices = []
    const midi = createMidiInput({ requestAccess: async () => access, onMessage: (m, i) => got.push([m.type, i.name]), onDevicesChange: (d) => devices.push(d.length) })
    expect(midi.supported).toBe(true)
    const r = await midi.enable()
    expect(r).toEqual({ ok: true, inputs: [{ id: 'a', name: 'Teclado' }] })
    kb.onmidimessage({ data: [0x90, 60, 90] })
    kb.onmidimessage({ data: [0xf8] }) // ignored
    const pad = add('b', 'Pads')
    access.onstatechange()
    pad.onmidimessage({ data: [0xb0, 1, 10] })
    expect(got).toEqual([['noteon', 'Teclado'], ['cc', 'Pads']])
    expect(devices).toEqual([1, 2])
    midi.disable()
    expect(kb.onmidimessage).toBe(null)
    expect(midi.enabled).toBe(false)
  })

  it('degrades without errors: no Web MIDI, or permission denied', async () => {
    expect(midiSupported({})).toBe(false)
    expect(midiSupported(undefined)).toBe(false)
    const none = createMidiInput({ onMessage: () => {} })
    expect(none.supported).toBe(false) // jsdom has no requestMIDIAccess
    expect(await none.enable()).toEqual({ ok: false, error: 'unsupported' })
    const denied = createMidiInput({ requestAccess: async () => { throw new Error('SecurityError') }, onMessage: () => {} })
    expect(await denied.enable()).toEqual({ ok: false, error: 'denied' })
    expect(denied.enabled).toBe(false)
  })

  it('keys play the selected voice; a controller moves the focused slider through its input event', async () => {
    setActivePinia(createPinia())
    const audio = useAudioStore()
    audio.previewNote = vi.fn(async () => {})
    const voice = { id: 'v', type: 'voice', data: { instrument: 'Bass', volume: 0.5, pan: -0.2 } }
    const { result, wrapper } = withSetup(() => useMidiInput({ getVoiceNode: () => voice, requestAccess: async () => ({ inputs: new Map(), onstatechange: null }) }))
    expect(await result.enable()).toBe(true)
    result.onMessage(parseMidiMessage([0x90, 48, 127]))
    expect(audio.previewNote).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'Bass', midi: 48, velocity: 1, volume: 0.5, pan: -0.2 }))

    const slider = document.createElement('input')
    slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '0.5'
    slider.setAttribute('aria-label', 'Densidad')
    document.body.appendChild(slider)
    const seen = []
    slider.addEventListener('input', () => seen.push(slider.value))
    slider.focus()
    result.onMessage(parseMidiMessage([0xb0, 74, 127]))
    expect(slider.value).toBe('1')
    expect(seen).toEqual(['1'])
    expect(result.lastEvent.value).toContain('Densidad')
    // focus moves elsewhere: the last focused slider keeps being the target
    slider.blur()
    result.onMessage(parseMidiMessage([0xb0, 74, 0]))
    expect(slider.value).toBe('0')
    slider.remove()
    wrapper.unmount()
    expect(result.enabled.value).toBe(false)
  })

  it('controlTarget / applyControlChange ignore what is not a slider or number field', () => {
    const text = document.createElement('input')
    text.type = 'text'
    expect(controlTarget(text, null)).toBe(null)
    expect(applyControlChange(null, 64)).toBe(null)
    const num = document.createElement('input')
    num.type = 'number'; num.min = '60'; num.max = '200'; num.step = '1'
    document.body.appendChild(num)
    expect(controlTarget(document.body, num)).toBe(num)
    expect(applyControlChange(num, 127)).toBe(200)
    num.remove()
    expect(controlTarget(null, num)).toBe(null) // removed from the page
    const disabled = document.createElement('input')
    disabled.type = 'range'; disabled.disabled = true
    expect(controlTarget(disabled, null)).toBe(null)
  })

  it('the transport shows Grabar / Performance / MIDI only in the editor', () => {
    setActivePinia(createPinia())
    const midi = { supported: { value: false }, enabled: { value: false }, devices: { value: [] }, lastEvent: { value: '' }, toggle: vi.fn() }
    const w = mount(TransportBar, { props: { performance: false, midi } })
    const labels = w.findAll('button').map(b => b.text())
    expect(labels.some(t => t.includes('Grabar'))).toBe(true)
    expect(labels.some(t => t.includes('Performance'))).toBe(true)
    const midiBtn = w.findAll('button').find(b => b.text().includes('MIDI'))
    expect(midiBtn.attributes('disabled')).toBeDefined()
    expect(midiBtn.attributes('title')).toContain('no tiene Web MIDI')
    const ro = mount(TransportBar, { props: { readonly: true, transport: { isPlaying: { value: false }, canPlay: { value: true }, loop: { value: true }, position: { value: null }, cycleBars: { value: 1 }, tempo: { value: 120 }, swing: { value: 0 }, volume: { value: 0.7 }, togglePlay: vi.fn(), setLoop: vi.fn(), setVolume: vi.fn() } } })
    expect(ro.text()).not.toContain('Grabar')
    expect(ro.text()).not.toContain('Performance')
  })
})
