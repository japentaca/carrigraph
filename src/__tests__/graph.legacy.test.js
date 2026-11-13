import { describe, it, expect } from 'vitest'
// Fase 3A: graphTraversal.js was replaced by src/audio/graph/compile.js. These
// are the same assertions, now against the compiler's compatibility mode
// (legacyGraphParams = old getConnectedPatternData).
import { legacyGraphParams as getConnectedPatternData } from '../audio/graph/compile.js'

describe('compile.js — modo compatibilidad (ex graphTraversal)', () => {
  describe('getConnectedPatternData', () => {
    it('should return defaults when no nodes exist', () => {
      const result = getConnectedPatternData([], [])
      expect(result.pattern.algorithm).toBe('euclidean')
      expect(result.length).toBe(16)
      expect(result.loopSize).toBe(8)
      expect(result.instrument).toBe('Piano')
    })

    it('should use first pattern node data directly', () => {
      const nodes = [
        { id: 'p1', type: 'pattern', data: { algorithm: 'random', density: 0.7, rotation: 3, seed: 0.5 } }
      ]
      const result = getConnectedPatternData(nodes, [])
      expect(result.pattern.algorithm).toBe('random')
      expect(result.pattern.density).toBe(0.7)
      expect(result.pattern.rotation).toBe(3)
      expect(result.pattern.seed).toBe(0.5)
    })

    it('seed 0 is kept and a missing seed is deterministic (no Math.random)', () => {
      const zero = getConnectedPatternData([{ id: 'p1', type: 'pattern', data: { seed: 0 } }], [])
      expect(zero.pattern.seed).toBe(0)
      const a = getConnectedPatternData([{ id: 'p1', type: 'pattern', data: {} }], [])
      const b = getConnectedPatternData([{ id: 'p1', type: 'pattern', data: {} }], [])
      expect(a.pattern.seed).toBe(b.pattern.seed)
    })

    it('should use defaults when nodes are not connected to pattern', () => {
      const nodes = [
        { id: 'p1', type: 'pattern', data: { algorithm: 'binary', density: 0.3 } },
        { id: 'l1', type: 'length', data: { value: 32 } },
        { id: 'v1', type: 'voice', data: { instrument: 'Synth', octave: 5 } }
      ]
      // Edge l1→v1 — neither is connected to the pattern node
      const result = getConnectedPatternData(nodes, [
        { id: 'orphan', source: 'l1', target: 'v1' }
      ])
      // Pattern node uses its own data, but disconnected params → defaults
      expect(result.pattern.algorithm).toBe('binary')
      expect(result.instrument).toBe('Piano')     // default — voice not connected
      expect(result.length).toBe(16)              // default — length not connected
    })

    it('should follow edges to find connected parameter nodes', () => {
      const nodes = [
        { id: 'p1', type: 'pattern', data: { algorithm: 'euclidean', density: 0.5 } },
        { id: 'l1', type: 'length', data: { value: 64 } },
        { id: 'l2', type: 'length', data: { value: 8 } },  // not connected
        { id: 'v1', type: 'voice', data: { instrument: 'Bass', octave: 3 } },
        { id: 'loop1', type: 'loop', data: { value: 16 } }
      ]
      // Connect l1→p1, v1→p1, loop1→p1
      const edges = [
        { id: 'e1', source: 'l1', target: 'p1' },
        { id: 'e2', source: 'v1', target: 'p1' },
        { id: 'e3', source: 'loop1', target: 'p1' }
      ]
      const result = getConnectedPatternData(nodes, edges)
      expect(result.length).toBe(64)   // from connected l1, not l2
      expect(result.instrument).toBe('Bass')
      expect(result.octave).toBe(3)
      expect(result.loopSize).toBe(16)
    })

    it('should handle outgoing edges from pattern', () => {
      const nodes = [
        { id: 'p1', type: 'pattern', data: { algorithm: 'fibonacci', density: 0.4 } },
        { id: 'v1', type: 'voice', data: { instrument: 'Drums' } }
      ]
      // Edge from pattern→voice (output direction)
      const edges = [
        { id: 'e1', source: 'p1', target: 'v1' }
      ]
      const result = getConnectedPatternData(nodes, edges)
      expect(result.instrument).toBe('Drums')
    })

    it('should use defaults when connected node lacks data', () => {
      const nodes = [
        { id: 'p1', type: 'pattern', data: {} },
        { id: 'v1', type: 'voice', data: {} }
      ]
      const edges = [{ id: 'e1', source: 'v1', target: 'p1' }]
      const result = getConnectedPatternData(nodes, edges)
      expect(result.instrument).toBe('Piano')
    })
  })
})
