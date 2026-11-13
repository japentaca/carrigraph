import { defineStore } from 'pinia'

import { edgeStyleFor, NODE_TYPES, getOutputPorts, seedFromId } from '../audio/graph/nodeTypes.js'
import { CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'

/**
 * Preset: un conjunto de nodos y edges que forman una configuración
 * de audio reconocible. Los presets built-in cubren patrones clásicos.
 *
 * Fase 3B: presets multipista (MULTITRACK_PRESETS, categoría "Multipista")
 * con Efectos y Salidas con mezcla; esquema 3.
 *
 * Fase 3A: están en el esquema 2 (puertos tipados, aristas dirigidas
 * Length/Loop → Pattern → Voice → Salida). Los parámetros son los mismos que
 * antes, así que suenan igual (hay test). Los presets de usuario viejos se
 * migran al aplicarlos (migrateProject).
 */
const edge = (id, source, sourceHandle, target, targetHandle, type) =>
  ({ id, source, target, sourceHandle, targetHandle, style: edgeStyleFor(type) })

// Display names of preset categories saved in English by earlier versions
// (user presets in localStorage keep `category: 'User'`).
const CATEGORY_LABELS = { Drums: 'Batería', Melodic: 'Melódicos', Ambient: 'Ambiente', User: 'Mis presets', Other: 'Otros' }

function singleTrackPreset({ id, key, name, description, category, icon, pattern, length, loop, voice }) {
  const n = (type, suffix, position, data) => ({
    id: `preset-${suffix}-${key}`,
    type,
    position,
    data: { label: NODE_TYPES[type].label, color: NODE_TYPES[type].color, ...data }
  })
  const nodes = [
    n('pattern', 'pattern', { x: 300, y: 100 }, pattern),
    n('length', 'length', { x: 0, y: 60 }, { value: length, min: 4, max: 512 })
  ]
  const edges = [edge('preset-edge-1', `preset-length-${key}`, 'value', `preset-pattern-${key}`, 'length', 'number')]
  if (loop != null) {
    nodes.push(n('loop', 'loop', { x: 0, y: 360 }, { value: loop, min: 1, max: 64 }))
    edges.push(edge('preset-edge-2', `preset-loop-${key}`, 'value', `preset-pattern-${key}`, 'loop', 'number'))
  }
  nodes.push(n('voice', 'voice', { x: 620, y: 100 }, voice))
  nodes.push(n('output', 'output', { x: 920, y: 160 }, NODE_TYPES.output.defaults()))
  edges.push(edge('preset-edge-3', `preset-pattern-${key}`, 'pattern', `preset-voice-${key}`, 'notes', 'pattern'))
  edges.push(edge('preset-edge-4', `preset-voice-${key}`, 'audio', `preset-output-${key}`, 'audio', 'audio'))
  return { id, name, description, category, icon, schemaVersion: CURRENT_SCHEMA_VERSION, nodes, edges }
}

/**
 * Multitrack preset (Fase 3B). `nodes`: [shortId, type, column, row, data];
 * `edges`: [fromShortId, fromPort, toShortId, toPort]. Ids get the
 * `preset-<key>-` prefix; data = type defaults + `data`, with a fixed seed
 * (derived from the id) wherever the type has one, so presets are
 * deterministic.
 */
function multiTrackPreset({ id, key, name, description, category = 'Multipista', icon, nodes, edges }) {
  const pid = (short) => `preset-${key}-${short}`
  const COLUMN = 440
  const ROW = 460
  const outNodes = nodes.map(([short, type, col, row, data = {}]) => {
    const def = NODE_TYPES[type]
    const defaults = def.defaults()
    if ('seed' in defaults) defaults.seed = seedFromId(pid(short))
    return {
      id: pid(short),
      type,
      position: { x: col * COLUMN, y: row * ROW },
      data: { label: def.label, color: def.color, ...defaults, ...data }
    }
  })
  const typeOf = new Map(outNodes.map(n => [n.id, n.type]))
  const outEdges = edges.map(([from, fromPort, to, toPort], i) => {
    const portType = getOutputPorts(typeOf.get(pid(from))).find(p => p.id === fromPort)?.type
    return edge(`preset-${key}-e${i + 1}`, pid(from), fromPort, pid(to), toPort, portType)
  })
  return { id, name, description, category, icon, schemaVersion: CURRENT_SCHEMA_VERSION, nodes: outNodes, edges: outEdges }
}

const hits = (str) => Array.from(str, c => c === 'x')

/** Effects node data with only the given effects on (others off). */
const fx = (enabled) => {
  const base = NODE_TYPES.effects.defaults()
  for (const type of Object.keys(base)) base[type] = { ...base[type], enabled: false }
  for (const [type, params] of Object.entries(enabled)) base[type] = { ...base[type], ...params, enabled: true }
  return base
}

export const MULTITRACK_PRESETS = [
  multiTrackPreset({
    id: 'preset-full-kit', key: 'kit', name: 'Batería completa',
    description: 'Bombo, redoblante con reverb y hi-hat con groove (3 pistas)', icon: '🥁',
    nodes: [
      ['kick-steps', 'steps', 0, 0, { steps: hits('x.....x.x.......') }],
      ['kick-voice', 'voice', 2, 0, { instrument: 'Drums', drumPiece: 'kick', volume: 0.9 }],
      ['kick-out', 'output', 4, 0, { name: 'Bombo' }],
      ['snare-steps', 'steps', 0, 1, { steps: hits('....x.......x..x') }],
      ['snare-voice', 'voice', 2, 1, { instrument: 'Drums', drumPiece: 'snare', volume: 0.7 }],
      ['snare-fx', 'effects', 3, 1, fx({ reverb: { amount: 0.25, decay: 1.2 } })],
      ['snare-out', 'output', 4, 1, { name: 'Redoblante' }],
      ['hat-steps', 'steps', 0, 2, { steps: hits('x.xxx.xxx.xxx.x.') }],
      ['hat-groove', 'groove', 1, 2, { swing: 0.2, timing: 0.1, velocity: 0.3, accentEvery: 2, accentAmount: 0.4 }],
      ['hat-voice', 'voice', 2, 2, { instrument: 'Drums', drumPiece: 'hihat', volume: 0.6 }],
      ['hat-out', 'output', 4, 2, { name: 'Hi-hat', pan: 0.25 }]
    ],
    edges: [
      ['kick-steps', 'pattern', 'kick-voice', 'notes'], ['kick-voice', 'audio', 'kick-out', 'audio'],
      ['snare-steps', 'pattern', 'snare-voice', 'notes'], ['snare-voice', 'audio', 'snare-fx', 'in'], ['snare-fx', 'audio', 'snare-out', 'audio'],
      ['hat-steps', 'pattern', 'hat-groove', 'in'], ['hat-groove', 'notes', 'hat-voice', 'notes'], ['hat-voice', 'audio', 'hat-out', 'audio']
    ]
  }),
  multiTrackPreset({
    id: 'preset-techno', key: 'techno', name: 'Techno',
    description: 'Bombo en negras, hat abierto a contratiempo, bajo filtrado y acordes con delay (4 pistas)', icon: '🏭',
    nodes: [
      ['kick-steps', 'steps', 0, 0, { steps: hits('x...x...x...x...') }],
      ['kick-voice', 'voice', 2, 0, { instrument: 'Drums', drumPiece: 'kick', volume: 0.95 }],
      ['kick-out', 'output', 5, 0, { name: 'Bombo' }],
      ['hat-steps', 'steps', 0, 1, { steps: hits('..x...x...x...x.') }],
      ['hat-voice', 'voice', 2, 1, { instrument: 'Drums', drumPiece: 'openhat', volume: 0.7 }],
      ['hat-out', 'output', 5, 1, { name: 'Hat abierto', pan: -0.15 }],
      ['len16', 'length', 0, 2, { value: 16 }],
      ['bass-pattern', 'pattern', 1, 2, { algorithm: 'euclidean', density: 0.4375, rotation: 2 }],
      ['bass-scale', 'scale', 2, 2, { root: 'A', scale: 'minor', mode: 'random', octave: 2, range: 1 }],
      ['bass-voice', 'voice', 3, 2, { instrument: 'Bass', volume: 0.8 }],
      ['bass-fx', 'effects', 4, 2, fx({ distortion: { amount: 0.3, drive: 0.35, tone: 3000 }, filter: { amount: 1, mode: 'lowpass', cutoff: 700, resonance: 6 } })],
      ['bass-out', 'output', 5, 2, { name: 'Bajo' }],
      ['len32', 'length', 0, 3, { value: 32 }],
      ['stab-pattern', 'pattern', 1, 3, { algorithm: 'cellular', density: 0.3, rule: 30, generations: 7 }],
      ['stab-scale', 'scale', 2, 3, { root: 'A', scale: 'minor', mode: 'arpeggio', octave: 4, range: 1 }],
      ['stab-chord', 'chord', 2, 4, { chord: 'seventh' }],
      ['stab-voice', 'voice', 3, 3, { instrument: 'Synth', volume: 0.45 }],
      ['stab-fx', 'effects', 4, 3, fx({ delay: { amount: 0.35, time: 0.375, feedback: 0.45 }, reverb: { amount: 0.3, decay: 2 } })],
      ['stab-out', 'output', 5, 3, { name: 'Acordes', pan: 0.2 }]
    ],
    edges: [
      ['kick-steps', 'pattern', 'kick-voice', 'notes'], ['kick-voice', 'audio', 'kick-out', 'audio'],
      ['hat-steps', 'pattern', 'hat-voice', 'notes'], ['hat-voice', 'audio', 'hat-out', 'audio'],
      ['len16', 'value', 'bass-pattern', 'length'], ['bass-pattern', 'pattern', 'bass-scale', 'in'], ['bass-scale', 'notes', 'bass-voice', 'notes'],
      ['bass-voice', 'audio', 'bass-fx', 'in'], ['bass-fx', 'audio', 'bass-out', 'audio'],
      ['len32', 'value', 'stab-pattern', 'length'], ['stab-pattern', 'pattern', 'stab-scale', 'in'], ['stab-scale', 'notes', 'stab-chord', 'in'],
      ['stab-chord', 'notes', 'stab-voice', 'notes'], ['stab-voice', 'audio', 'stab-fx', 'in'], ['stab-fx', 'audio', 'stab-out', 'audio']
    ]
  }),
  multiTrackPreset({
    id: 'preset-poly-3-4', key: 'poly34', name: 'Polirritmo 3:4',
    description: '3 golpes contra 4 en el mismo ciclo de 12 pasos, con pulso de hi-hat (3 pistas)', icon: '🔺',
    nodes: [
      ['len12', 'length', 0, 0, { value: 12 }],
      ['three-pattern', 'pattern', 1, 0, { algorithm: 'euclidean', density: 0.25, rotation: 0 }],
      ['three-scale', 'scale', 2, 0, { root: 'D', scale: 'dorian', mode: 'fixed', octave: 2, range: 1 }],
      ['three-voice', 'voice', 3, 0, { instrument: 'Bass', volume: 0.85 }],
      ['three-out', 'output', 5, 0, { name: 'Tres', pan: -0.3 }],
      ['four-pattern', 'pattern', 1, 1, { algorithm: 'euclidean', density: 0.34, rotation: 0 }],
      ['four-scale', 'scale', 2, 1, { root: 'D', scale: 'dorian', mode: 'ascending', octave: 4, range: 1 }],
      ['four-voice', 'voice', 3, 1, { instrument: 'Piano', volume: 0.7 }],
      ['four-fx', 'effects', 4, 1, fx({ reverb: { amount: 0.3, decay: 1.8 } })],
      ['four-out', 'output', 5, 1, { name: 'Cuatro', pan: 0.3 }],
      ['pulse-steps', 'steps', 1, 2, { steps: hits('xxxxxxxxxxxx') }],
      ['pulse-voice', 'voice', 3, 2, { instrument: 'Drums', drumPiece: 'hihat', volume: 0.45 }],
      ['pulse-out', 'output', 5, 2, { name: 'Pulso' }]
    ],
    edges: [
      ['len12', 'value', 'three-pattern', 'length'], ['len12', 'value', 'four-pattern', 'length'],
      ['three-pattern', 'pattern', 'three-scale', 'in'], ['three-scale', 'notes', 'three-voice', 'notes'], ['three-voice', 'audio', 'three-out', 'audio'],
      ['four-pattern', 'pattern', 'four-scale', 'in'], ['four-scale', 'notes', 'four-voice', 'notes'],
      ['four-voice', 'audio', 'four-fx', 'in'], ['four-fx', 'audio', 'four-out', 'audio'],
      ['pulse-steps', 'pattern', 'pulse-voice', 'notes'], ['pulse-voice', 'audio', 'pulse-out', 'audio']
    ]
  }),
  multiTrackPreset({
    id: 'preset-ambient-gen', key: 'ambgen', name: 'Ambient generativo',
    description: 'Tres capas de largos distintos (64, 48 y 40 pasos) con escalas aleatorias, delay y reverb larga', icon: '🌌',
    nodes: [
      ['len64', 'length', 0, 0, { value: 64 }],
      ['pad-pattern', 'pattern', 1, 0, { algorithm: 'noise', density: 0.16, noiseScale: 6 }],
      ['pad-scale', 'scale', 2, 0, { root: 'E', scale: 'pentatonicMinor', mode: 'random', octave: 4, range: 2 }],
      ['pad-chord', 'chord', 2, 1, { chord: 'triad' }],
      ['pad-voice', 'voice', 3, 0, { instrument: 'Piano', volume: 0.6 }],
      ['pad-fx', 'effects', 4, 0, fx({ delay: { amount: 0.4, time: 0.6, feedback: 0.5 }, reverb: { amount: 0.6, decay: 6 } })],
      ['pad-out', 'output', 5, 0, { name: 'Piano' }],
      ['len48', 'length', 0, 2, { value: 48 }],
      ['air-pattern', 'pattern', 1, 2, { algorithm: 'fibonacci', density: 0.12 }],
      ['air-scale', 'scale', 2, 2, { root: 'E', scale: 'pentatonicMinor', mode: 'random', octave: 5, range: 1 }],
      ['air-voice', 'voice', 3, 2, { instrument: 'Synth', volume: 0.35 }],
      ['air-fx', 'effects', 4, 2, fx({ filter: { amount: 1, mode: 'lowpass', cutoff: 1500, resonance: 1 }, reverb: { amount: 0.7, decay: 7 } })],
      ['air-out', 'output', 5, 2, { name: 'Aire', pan: -0.4 }],
      ['len40', 'length', 0, 3, { value: 40 }],
      ['drone-pattern', 'pattern', 1, 3, { algorithm: 'euclidean', density: 0.05 }],
      ['drone-scale', 'scale', 2, 3, { root: 'E', scale: 'pentatonicMinor', mode: 'fixed', octave: 2, range: 1 }],
      ['drone-voice', 'voice', 3, 3, { instrument: 'Bass', volume: 0.6 }],
      ['drone-fx', 'effects', 4, 3, fx({ reverb: { amount: 0.5, decay: 5 } })],
      ['drone-out', 'output', 5, 3, { name: 'Bordón', pan: 0.2 }]
    ],
    edges: [
      ['len64', 'value', 'pad-pattern', 'length'], ['pad-pattern', 'pattern', 'pad-scale', 'in'], ['pad-scale', 'notes', 'pad-chord', 'in'],
      ['pad-chord', 'notes', 'pad-voice', 'notes'], ['pad-voice', 'audio', 'pad-fx', 'in'], ['pad-fx', 'audio', 'pad-out', 'audio'],
      ['len48', 'value', 'air-pattern', 'length'], ['air-pattern', 'pattern', 'air-scale', 'in'], ['air-scale', 'notes', 'air-voice', 'notes'],
      ['air-voice', 'audio', 'air-fx', 'in'], ['air-fx', 'audio', 'air-out', 'audio'],
      ['len40', 'value', 'drone-pattern', 'length'], ['drone-pattern', 'pattern', 'drone-scale', 'in'], ['drone-scale', 'notes', 'drone-voice', 'notes'],
      ['drone-voice', 'audio', 'drone-fx', 'in'], ['drone-fx', 'audio', 'drone-out', 'audio']
    ]
  }),
  multiTrackPreset({
    id: 'preset-bass-arp', key: 'bassarp', name: 'Bajo + arpegio',
    description: 'Bajo euclidiano filtrado y arpegio en semicorcheas con swing y delay (2 pistas)', icon: '🎛️',
    nodes: [
      ['len16', 'length', 0, 0, { value: 16 }],
      ['bass-pattern', 'pattern', 1, 0, { algorithm: 'euclidean', density: 0.375, rotation: 0 }],
      ['bass-scale', 'scale', 2, 0, { root: 'C', scale: 'minor', mode: 'arpeggio', octave: 2, range: 1 }],
      ['bass-voice', 'voice', 3, 0, { instrument: 'Bass', volume: 0.85 }],
      ['bass-fx', 'effects', 4, 0, fx({ filter: { amount: 1, mode: 'lowpass', cutoff: 900, resonance: 3 } })],
      ['bass-out', 'output', 5, 0, { name: 'Bajo' }],
      ['arp-steps', 'steps', 1, 1, { steps: hits('xxxxxxxxxxxxxxxx') }],
      ['arp-scale', 'scale', 2, 1, { root: 'C', scale: 'minor', mode: 'arpeggio', octave: 4, range: 2 }],
      ['arp-groove', 'groove', 2, 2, { swing: 0.25, timing: 0, velocity: 0.15, accentEvery: 4, accentAmount: 0.35 }],
      ['arp-voice', 'voice', 3, 1, { instrument: 'Synth', volume: 0.45 }],
      ['arp-fx', 'effects', 4, 1, fx({ delay: { amount: 0.3, time: 0.25, feedback: 0.35 }, reverb: { amount: 0.25, decay: 2 } })],
      ['arp-out', 'output', 5, 1, { name: 'Arpegio', pan: 0.25 }]
    ],
    edges: [
      ['len16', 'value', 'bass-pattern', 'length'], ['bass-pattern', 'pattern', 'bass-scale', 'in'], ['bass-scale', 'notes', 'bass-voice', 'notes'],
      ['bass-voice', 'audio', 'bass-fx', 'in'], ['bass-fx', 'audio', 'bass-out', 'audio'],
      ['arp-steps', 'pattern', 'arp-scale', 'in'], ['arp-scale', 'notes', 'arp-groove', 'in'], ['arp-groove', 'notes', 'arp-voice', 'notes'],
      ['arp-voice', 'audio', 'arp-fx', 'in'], ['arp-fx', 'audio', 'arp-out', 'audio']
    ]
  })
]

export const BUILT_IN_PRESETS = [
  singleTrackPreset({
    id: 'preset-kick', key: 'kick', name: 'Bombo 4/4', description: 'Bombo 4/4 con patrón euclidiano', category: 'Batería', icon: '🥁',
    pattern: { algorithm: 'euclidean', seed: 0.42, density: 0.5, rotation: 0 },
    length: 16,
    voice: { instrument: 'Drums', volume: 0.8, pan: 0 }
  }),
  singleTrackPreset({
    id: 'preset-hihat', key: 'hh', name: 'Hi-hat rápido', description: 'Hi-hat rápido con 8 pasos', category: 'Batería', icon: '💿',
    pattern: { algorithm: 'binary', seed: 0.85, density: 0.6, rotation: 0 },
    length: 8, loop: 8,
    voice: { instrument: 'Synth', volume: 0.5, pan: 0.3 }
  }),
  singleTrackPreset({
    id: 'preset-bassline', key: 'bass', name: 'Línea de bajo', description: 'Línea de bajo con patrón aleatorio', category: 'Melódicos', icon: '🎸',
    pattern: { algorithm: 'random', seed: 0.23, density: 0.4, rotation: 0 },
    length: 16, loop: 4,
    voice: { instrument: 'Bass', volume: 0.9, pan: 0 }
  }),
  singleTrackPreset({
    id: 'preset-arpeggio', key: 'arp', name: 'Arpegio', description: 'Arpegio Fibonacci con sintetizador', category: 'Melódicos', icon: '🎹',
    pattern: { algorithm: 'fibonacci', seed: 0.5, density: 0.5, rotation: 0 },
    length: 32, loop: 16,
    voice: { instrument: 'Synth', volume: 0.6, pan: -0.2 }
  }),
  singleTrackPreset({
    id: 'preset-guitar', key: 'gtr', name: 'Rasgueo de guitarra', description: 'Rasgueo de guitarra con swing aleatorio', category: 'Melódicos', icon: '🎸',
    pattern: { algorithm: 'euclidean', seed: 0.78, density: 0.7, rotation: 2 },
    length: 12,
    voice: { instrument: 'Guitar', volume: 0.7, pan: 0.1 }
  }),
  singleTrackPreset({
    id: 'preset-ambient', key: 'amb', name: 'Pad ambiental', description: 'Pad ambiental largo con densidad baja', category: 'Ambiente', icon: '🌌',
    pattern: { algorithm: 'fibonacci', seed: 0.11, density: 0.25, rotation: 0 },
    length: 64, loop: 32,
    voice: { instrument: 'Piano', volume: 0.4, pan: 0 }
  }),
  ...MULTITRACK_PRESETS
]

const STORAGE_KEY = 'carrigraph_user_presets'

export const usePresetStore = defineStore('presets', {
  state: () => ({
    /** Presets creados por el usuario (persistidos en localStorage) */
    userPresets: [],
    /** Categorías de presets built-in */
    builtInPresets: [...BUILT_IN_PRESETS]
  }),

  getters: {
    /** Todos los presets (built-in + usuario) agrupados por categoría */
    categories() {
      const all = [
        ...this.builtInPresets.map(p => ({ ...p, isBuiltIn: true })),
        ...this.userPresets.map(p => ({ ...p, isBuiltIn: false }))
      ]

      const map = {}
      for (const p of all) {
        const cat = CATEGORY_LABELS[p.category] || p.category || 'Otros'
        if (!map[cat]) map[cat] = []
        map[cat].push(p)
      }

      return Object.entries(map).map(([name, presets]) => ({ name, presets }))
    },

    /** Presets built-in planos */
    builtInPresetList() {
      return this.builtInPresets
    },

    /** Presets de usuario planos */
    userPresetList() {
      return this.userPresets
    }
  },

  actions: {
    /**
     * Cargar presets de usuario desde localStorage.
     */
    loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          this.userPresets = JSON.parse(raw)
        }
      } catch (e) {
        this.userPresets = []
      }
    },

    /**
     * Guardar presets de usuario en localStorage.
     */
    saveToStorage() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPresets))
      } catch (e) {
        // localStorage full or unavailable
      }
    },

    /**
     * Guardar la configuración actual como preset de usuario.
     *
     * @param {string} name
     * @param {Array} nodes
     * @param {Array} edges
     * @param {string} [category='User']
     */
    saveCurrentAsPreset(name, nodes, edges, category = 'User') {
      // Generar IDs únicos para que no colisionen con otros presets
      const cleanNodes = JSON.parse(JSON.stringify(nodes))
      const cleanEdges = JSON.parse(JSON.stringify(edges))

      const preset = {
        id: `user-preset-${Date.now()}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        name,
        description: `Preset: ${name}`,
        category,
        icon: '💾',
        nodes: cleanNodes,
        edges: cleanEdges
      }

      this.userPresets.push(preset)
      this.saveToStorage()
      return preset
    },

    /**
     * Eliminar un preset de usuario.
     *
     * @param {string} presetId
     */
    deletePreset(presetId) {
      this.userPresets = this.userPresets.filter(p => p.id !== presetId)
      this.saveToStorage()
    },

    /**
     * Devolver un preset por ID (busca en ambos: built-in + usuario).
     *
     * @param {string} presetId
     * @returns {Object|null}
     */
    getPresetById(presetId) {
      const builtIn = this.builtInPresets.find(p => p.id === presetId)
      if (builtIn) return builtIn

      return this.userPresets.find(p => p.id === presetId) || null
    }
  }
})
