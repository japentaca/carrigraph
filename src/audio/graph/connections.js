/**
 * connections.js — typed-port rules for edges (pure; no Vue).
 *
 * Edge = { id, source, target, sourceHandle, targetHandle }. Handles are port
 * ids from nodeTypes.js. Direction matters: source = output port, target =
 * input port. Old edges with unknown handles are resolved by inference (see
 * resolvePorts); the migration rewrites them once.
 */

import { getInputPorts, getOutputPorts, canConnectTypes } from './nodeTypes.js'

const key = (id) => String(id)

/**
 * Pick the (output port, input port) pair an edge between these two nodes
 * uses. A handle that names an existing port is respected; otherwise the
 * first compatible pair is chosen, preferring the input named like the
 * source node type (Length → `length`, Loop → `loop`).
 * @returns {{ sourcePort, targetPort } | null}
 */
export function resolvePorts(sourceNode, targetNode, sourceHandle, targetHandle) {
  if (!sourceNode || !targetNode) return null
  const outs = getOutputPorts(sourceNode.type)
  const ins = getInputPorts(targetNode.type)
  const outNamed = outs.find(p => p.id === sourceHandle)
  const inNamed = ins.find(p => p.id === targetHandle)
  const outCandidates = outNamed ? [outNamed] : outs
  const inCandidates = inNamed
    ? [inNamed]
    : [...ins].sort((a, b) => (b.id === sourceNode.type) - (a.id === sourceNode.type))
  for (const o of outCandidates) {
    for (const i of inCandidates) {
      if (canConnectTypes(o.type, i.type)) return { sourcePort: o, targetPort: i }
    }
  }
  return null
}

/** True if `to` can be reached from `from` following edges (directed). */
export function reaches(from, to, edges) {
  const start = key(from)
  const goal = key(to)
  if (start === goal) return true
  const out = new Map()
  for (const e of edges || []) {
    if (!e) continue
    const s = key(e.source)
    if (!out.has(s)) out.set(s, [])
    out.get(s).push(key(e.target))
  }
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) {
    const n = stack.pop()
    for (const m of out.get(n) || []) {
      if (m === goal) return true
      if (!seen.has(m)) { seen.add(m); stack.push(m) }
    }
  }
  return false
}

/** Would adding source → target close a cycle? */
export function wouldCreateCycle(source, target, edges) {
  return reaches(target, source, edges)
}

/**
 * Check a new connection (Vue Flow's { source, target, sourceHandle, targetHandle }).
 * An input that is already connected is NOT a reason to refuse: the editor
 * replaces the old edge (each input takes one edge).
 * @returns {{ valid: boolean, reason?: string, sourcePort?, targetPort? }}
 */
export function checkConnection(connection, nodes, edges) {
  const { source, target, sourceHandle, targetHandle } = connection || {}
  if (source == null || target == null) return { valid: false, reason: 'Conexión incompleta' }
  if (key(source) === key(target)) return { valid: false, reason: 'Un nodo no se puede conectar consigo mismo' }
  const byId = new Map((nodes || []).map(n => [key(n.id), n]))
  const s = byId.get(key(source))
  const t = byId.get(key(target))
  if (!s || !t) return { valid: false, reason: 'Nodo inexistente' }
  const outs = getOutputPorts(s.type)
  const ins = getInputPorts(t.type)
  if (sourceHandle != null && !outs.some(p => p.id === sourceHandle)) {
    return { valid: false, reason: 'Hay que conectar desde una salida' }
  }
  if (targetHandle != null && !ins.some(p => p.id === targetHandle)) {
    return { valid: false, reason: 'Hay que conectar a una entrada' }
  }
  const ports = resolvePorts(s, t, sourceHandle, targetHandle)
  if (!ports) return { valid: false, reason: 'Tipos de puerto incompatibles' }
  if (wouldCreateCycle(source, target, edges)) return { valid: false, reason: 'La conexión formaría un ciclo' }
  return { valid: true, ...ports }
}

export function isValidConnection(connection, nodes, edges) {
  return checkConnection(connection, nodes, edges).valid
}
