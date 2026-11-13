import { describe, it, expect } from 'vitest'
import { migrateProject, getSchemaVersion, needsMigration, CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'
import { compileGraph } from '../audio/graph/compile.js'
import { checkConnection, isValidConnection, resolvePorts, wouldCreateCycle } from '../audio/graph/connections.js'
import { canConnectTypes, createNodeData, NODE_TYPES, NODE_TYPE_ORDER, PORT_TYPES, paletteEntries, seedFromId, nodeSeed } from '../audio/graph/nodeTypes.js'

/**
 * A project as saved before Fase 3 (schema 1): no schemaVersion, edges with
 * the old handle ids, Voice → Pattern (reversed) like the old presets, and a
 * Pattern node without seed.
 */
const oldProject = () => ({
  id: 7,
  name: 'Viejo',
  metadata: { version: 3 },
  nodes: [
    { id: 'pattern-1', type: 'pattern', position: { x: 0, y: 0 }, data: { label: 'Pattern Generator', algorithm: 'random', density: 0.5, rotation: 0 } },
    { id: 'length-1', type: 'length', position: { x: 0, y: 200 }, data: { value: 12 } },
    { id: 'loop-1', type: 'loop', position: { x: 0, y: 400 }, data: { value: 6 } },
    { id: 'voice-1', type: 'voice', position: { x: 300, y: 0 }, data: { instrument: 'Bass', octave: 2, melodyMode: 'arpeggio', root: 'A', scale: 'minor' } },
    { id: 'pattern-2', type: 'pattern', position: { x: 600, y: 0 }, data: { seed: 0 } }
  ],
  edges: [
    { id: 'e1', source: 'length-1', target: 'pattern-1', sourceHandle: 'length-output', targetHandle: 'length-input' },
    { id: 'e2', source: 'voice-1', target: 'pattern-1', sourceHandle: 'output', targetHandle: 'voice' },
    { id: 'e3', source: 'pattern-1', target: 'loop-1', sourceHandle: 'pattern-output', targetHandle: 'loop-input' },
    { id: 'e4', source: 'pattern-1', target: 'voice-1', sourceHandle: 'pattern-output', targetHandle: 'voice-input' }, // duplicate of e2 once oriented
    { id: 'e5', source: 'pattern-1', target: 'pattern-2', sourceHandle: 'pattern-output', targetHandle: 'length-input' }, // fits no port
    { id: 'e6', source: 'pattern-1', target: 'ghost' } // missing node
  ]
})

describe('migrateProject', () => {
  it('detecta la versión del esquema', () => {
    expect(getSchemaVersion({})).toBe(1)
    expect(getSchemaVersion({ metadata: { schemaVersion: 2 } })).toBe(2)
    expect(needsMigration(oldProject())).toBe(true)
    expect(CURRENT_SCHEMA_VERSION).toBe(3)
  })

  it('lleva un proyecto viejo al esquema actual sin modificar el original', () => {
    const original = oldProject()
    const frozen = JSON.stringify(original)
    const p = migrateProject(original)
    expect(JSON.stringify(original)).toBe(frozen)
    expect(p.metadata).toEqual({ version: 3, schemaVersion: 3 })
    expect(p.id).toBe(7)
    expect(p.name).toBe('Viejo')
  })

  it('orienta las aristas y les asigna puertos tipados', () => {
    const p = migrateProject(oldProject())
    const byId = Object.fromEntries(p.edges.map(e => [e.id, e]))
    expect(byId.e1).toMatchObject({ source: 'length-1', target: 'pattern-1', sourceHandle: 'value', targetHandle: 'length' })
    expect(byId.e2).toMatchObject({ source: 'pattern-1', target: 'voice-1', sourceHandle: 'pattern', targetHandle: 'notes' })
    expect(byId.e3).toMatchObject({ source: 'loop-1', target: 'pattern-1', sourceHandle: 'value', targetHandle: 'loop' })
    expect(byId.e4).toBeUndefined() // duplicate removed
    expect(byId.e5).toMatchObject({ source: 'pattern-1', target: 'pattern-2', sourceHandle: null, targetHandle: null })
    expect(byId.e6).toBeUndefined() // pointed to a missing node
    expect(byId.e1.style.stroke).toBe(PORT_TYPES.number.color)
    for (const e of p.edges.filter(e => e.sourceHandle)) {
      expect(isValidConnection(e, p.nodes, p.edges.filter(x => x !== e))).toBe(true)
    }
  })

  it('asigna semillas deterministas y respeta la semilla 0', () => {
    const a = migrateProject(oldProject())
    const b = migrateProject(oldProject())
    const seedA = a.nodes.find(n => n.id === 'pattern-1').data.seed
    expect(Number.isFinite(seedA)).toBe(true)
    expect(b.nodes.find(n => n.id === 'pattern-1').data.seed).toBe(seedA)
    expect(a.nodes.find(n => n.id === 'pattern-2').data.seed).toBe(0)
  })

  it('el proyecto migrado suena igual que antes (modo compatibilidad)', () => {
    const before = compileGraph(oldProject().nodes, oldProject().edges)
    const after = compileGraph(migrateProject(oldProject()).nodes, migrateProject(oldProject()).edges)
    expect(after.mode).toBe('compat')
    expect(after.score).toEqual(before.score)
    const t = after.score.tracks[0]
    expect(t.instrument).toBe('Bass')
    expect(t.length).toBe(12)
    expect(t.steps.slice(0, 6)).toEqual(t.steps.slice(6, 12))
  })

  it('al agregar una Salida al proyecto migrado, la cadena funciona en modo pistas igual', () => {
    const p = migrateProject(oldProject())
    const compat = compileGraph(p.nodes, p.edges).score.tracks[0]
    p.nodes.push({ id: 'out', type: 'output', position: { x: 0, y: 0 }, data: {} })
    p.edges.push({ id: 'eo', source: 'voice-1', target: 'out', sourceHandle: 'audio', targetHandle: 'audio' })
    const r = compileGraph(p.nodes, p.edges)
    expect(r.mode).toBe('tracks')
    expect(r.score.tracks[0].events.map(({ track, ...e }) => e)).toEqual(compat.events.map(({ track, ...e }) => e))
  })

  it('un proyecto ya en esquema 2 no cambia (salvo la copia)', () => {
    const p = migrateProject(oldProject())
    const again = migrateProject(p)
    expect(again).toEqual(p)
    expect(again).not.toBe(p)
  })

  it('tolera entradas raras', () => {
    expect(migrateProject(null)).toEqual({ nodes: [], edges: [], metadata: { schemaVersion: 3 } })
    const p = migrateProject({ nodes: [{ id: 'x', type: 'pattern' }], edges: 'nope', metadata: 'bad' })
    expect(p.nodes[0].data.seed).toBe(seedFromId('x'))
    expect(p.edges).toEqual([])
  })
})

describe('puertos tipados y conexiones', () => {
  const nodes = [
    { id: 'p', type: 'pattern', data: {} },
    { id: 'l', type: 'length', data: {} },
    { id: 'v', type: 'voice', data: {} },
    { id: 'o', type: 'output', data: {} },
    { id: 's', type: 'scale', data: {} },
    { id: 'x', type: 'logic', data: {} },
    { id: 't', type: 'transform', data: {} }
  ]

  it('compatibilidad de tipos', () => {
    expect(canConnectTypes('pattern', 'pattern')).toBe(true)
    expect(canConnectTypes('pattern', 'notes')).toBe(true)
    expect(canConnectTypes('notes', 'pattern')).toBe(false)
    expect(canConnectTypes('audio', 'notes')).toBe(false)
    expect(canConnectTypes('number', 'pattern')).toBe(false)
    expect(canConnectTypes('nope', 'nope')).toBe(false)
  })

  it('isValidConnection acepta conexiones bien tipadas', () => {
    expect(isValidConnection({ source: 'l', sourceHandle: 'value', target: 'p', targetHandle: 'length' }, nodes, [])).toBe(true)
    expect(isValidConnection({ source: 'p', sourceHandle: 'pattern', target: 'v', targetHandle: 'notes' }, nodes, [])).toBe(true)
    expect(isValidConnection({ source: 'p', sourceHandle: 'pattern', target: 's', targetHandle: 'in' }, nodes, [])).toBe(true)
    expect(isValidConnection({ source: 's', sourceHandle: 'notes', target: 'v', targetHandle: 'notes' }, nodes, [])).toBe(true)
    expect(isValidConnection({ source: 'v', sourceHandle: 'audio', target: 'o', targetHandle: 'audio' }, nodes, [])).toBe(true)
  })

  it('isValidConnection rechaza tipos incompatibles, dirección al revés y autoconexión', () => {
    expect(checkConnection({ source: 'v', sourceHandle: 'audio', target: 'p', targetHandle: 'length' }, nodes, []).valid).toBe(false)
    expect(checkConnection({ source: 's', sourceHandle: 'notes', target: 'x', targetHandle: 'a' }, nodes, []).reason).toMatch(/incompatibles/)
    expect(checkConnection({ source: 'p', sourceHandle: 'length', target: 'l', targetHandle: 'value' }, nodes, []).valid).toBe(false)
    expect(checkConnection({ source: 'p', sourceHandle: 'pattern', target: 'p', targetHandle: 'length' }, nodes, []).valid).toBe(false)
    expect(checkConnection({ source: 'p', sourceHandle: 'pattern', target: 'zzz', targetHandle: 'in' }, nodes, []).valid).toBe(false)
  })

  it('isValidConnection impide ciclos', () => {
    const edges = [{ source: 't', target: 'x', sourceHandle: 'pattern', targetHandle: 'a' }]
    expect(wouldCreateCycle('x', 't', edges)).toBe(true)
    const r = checkConnection({ source: 'x', sourceHandle: 'pattern', target: 't', targetHandle: 'in' }, nodes, edges)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/ciclo/)
  })

  it('resolvePorts infiere puertos cuando faltan los handles', () => {
    const loop = { id: 'lp', type: 'loop' }
    expect(resolvePorts(loop, nodes[0], null, null).targetPort.id).toBe('loop')
    expect(resolvePorts(nodes[1], nodes[0], null, null).targetPort.id).toBe('length')
    expect(resolvePorts(nodes[2], nodes[0], null, null)).toBe(null)
  })

  it('el registro define paleta, puertos y valores por defecto de todos los tipos', () => {
    expect(paletteEntries().map(e => e.type)).toEqual(NODE_TYPE_ORDER)
    for (const type of NODE_TYPE_ORDER) {
      const t = NODE_TYPES[type]
      for (const p of [...t.inputs, ...t.outputs]) expect(PORT_TYPES[p.type]).toBeTruthy()
      const data = createNodeData(type)
      expect(data.label).toBe(t.label)
      expect(data.color).toBe(t.color)
    }
    // Seeds are assigned when the node is created and survive as-is
    const d = createNodeData('pattern')
    expect(Number.isFinite(d.seed)).toBe(true)
    expect(nodeSeed({ id: 'a', data: { seed: 0 } })).toBe(0)
    expect(nodeSeed({ id: 'a', data: {} })).toBe(seedFromId('a'))
  })
})
