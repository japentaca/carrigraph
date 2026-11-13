import { describe, it, expect } from 'vitest'
import {
  generateEuclideanPattern,
  generateRandomPattern,
  generateBinaryPattern,
  generateFibonacciPattern,
  generatePattern
} from '../audio/patternGenerators'

describe('patternGenerators', () => {
  describe('generateEuclideanPattern', () => {
    it('should distribute pulses evenly (E(8,4))', () => {
      const pattern = generateEuclideanPattern(8, 4)
      // E(8,4) via Bjorklund = [0,1,0,1,0,1,0,1] — starts with rest
      const active = pattern.filter(Boolean).length
      expect(active).toBe(4)
      expect(pattern).toHaveLength(8)
    })

    it('should return all true when pulses >= steps', () => {
      const pattern = generateEuclideanPattern(4, 5)
      expect(pattern).toEqual([true, true, true, true])
    })

    it('should rotate the pattern', () => {
      const original = generateEuclideanPattern(8, 4, 0)
      const rotated = generateEuclideanPattern(8, 4, 1)
      expect(rotated).not.toEqual(original)
      // Should still have 4 active
      expect(rotated.filter(Boolean).length).toBe(4)
    })

    it('should accept negative rotation (rotate left)', () => {
      const base = generateEuclideanPattern(8, 3, 0)
      const left = generateEuclideanPattern(8, 3, -1)
      expect(left).toEqual([...base.slice(1), base[0]])
    })

    it('should wrap rotation values >= length', () => {
      expect(generateEuclideanPattern(8, 3, 9)).toEqual(generateEuclideanPattern(8, 3, 1))
      expect(generateEuclideanPattern(8, 3, 16)).toEqual(generateEuclideanPattern(8, 3, 0))
      expect(generateEuclideanPattern(8, 3, -17)).toEqual(generateEuclideanPattern(8, 3, 7))
    })

    it('should keep the pulse count after any rotation', () => {
      for (const r of [-20, -3, 0, 5, 8, 31]) {
        expect(generateEuclideanPattern(12, 5, r).filter(Boolean).length).toBe(5)
      }
    })

    it('should handle zero pulses', () => {
      const pattern = generateEuclideanPattern(8, 0)
      expect(pattern.every(p => !p)).toBe(true)
    })
  })

  describe('generateRandomPattern', () => {
    it('should be reproducible with same seed', () => {
      const a = generateRandomPattern(16, 0.5, 0.123)
      const b = generateRandomPattern(16, 0.5, 0.123)
      expect(a).toEqual(b)
    })

    it('should produce different patterns with different seeds', () => {
      const a = generateRandomPattern(16, 0.5, 0.1)
      const b = generateRandomPattern(16, 0.5, 0.9)
      expect(a).not.toEqual(b)
    })

    it('should respect density approximately', () => {
      const pattern = generateRandomPattern(100, 0.3, 0.5)
      const active = pattern.filter(Boolean).length
      expect(active).toBeGreaterThan(15)
      expect(active).toBeLessThan(45)
    })
  })

  describe('generateBinaryPattern', () => {
    it('should return correct length', () => {
      const pattern = generateBinaryPattern(16, 0.5, 0.5)
      expect(pattern).toHaveLength(16)
    })

    it('should use the seed bits for the first 16 steps', () => {
      // seed 0.5 → 0x8000 → only bit 15 set; density 1/16 keeps it as is
      const pattern = generateBinaryPattern(16, 1 / 16, 0.5)
      expect(pattern.filter(Boolean).length).toBe(1)
      expect(pattern[15]).toBe(true)
    })

    it('should cover the whole length beyond 16 steps', () => {
      // With density matching the raw bits nothing is added, yet steps > 16
      // must still get pulses derived from the seed
      for (const seed of [0.123, 0.37, 0.5, 0.77, 0.999]) {
        const pattern = generateBinaryPattern(64, 0.5, seed)
        expect(pattern).toHaveLength(64)
        expect(pattern.slice(16).some(Boolean)).toBe(true)
        expect(pattern.slice(32).some(Boolean)).toBe(true)
      }
    })

    it('should hit the requested pulse count exactly', () => {
      for (const length of [4, 16, 24, 48, 100]) {
        for (const density of [0, 0.2, 0.5, 0.8, 1]) {
          const pattern = generateBinaryPattern(length, density, 0.42)
          expect(pattern.filter(Boolean).length).toBe(Math.round(length * density))
        }
      }
    })

    it('should not add filler pulses in a row', () => {
      // seed 0 → no raw bits in the first block; the 4 added pulses must be spread
      const pattern = generateBinaryPattern(16, 0.25, 0)
      const on = pattern.map((p, i) => (p ? i : -1)).filter(i => i >= 0)
      expect(on).toHaveLength(4)
      for (let i = 1; i < on.length; i++) {
        expect(on[i] - on[i - 1]).toBeGreaterThan(1)
      }
    })

    it('should be deterministic for the same seed', () => {
      expect(generateBinaryPattern(48, 0.4, 0.31)).toEqual(generateBinaryPattern(48, 0.4, 0.31))
    })
  })

  describe('generateFibonacciPattern', () => {
    it('should place pulses at fibonacci positions', () => {
      const pattern = generateFibonacciPattern(8, 0.5)
      // Distinct fib positions ≤ 8: 1,2,3,5,8. targetPulses = round(8*0.5) = 4
      // Phase 1: position 1 is counted once, so exactly 4 pulses
      expect(pattern.filter(Boolean).length).toBe(4)
      expect(pattern[0]).toBe(true)  // pos 1
      expect(pattern[1]).toBe(true)  // pos 2
      expect(pattern[2]).toBe(true)  // pos 3
      expect(pattern[4]).toBe(true)  // pos 5
    })

    it('should respect the requested pulse count for every density', () => {
      for (const length of [1, 5, 8, 13, 16, 32, 64]) {
        for (const density of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const pattern = generateFibonacciPattern(length, density)
          expect(pattern).toHaveLength(length)
          expect(pattern.filter(Boolean).length).toBe(Math.round(length * density))
        }
      }
    })

    it('should not count position 1 twice (length 2, density 1)', () => {
      expect(generateFibonacciPattern(2, 1)).toEqual([true, true])
    })

    it('should handle zero length', () => {
      expect(generateFibonacciPattern(0, 0.5)).toEqual([])
    })
  })

  describe('generatePattern router', () => {
    it('should route to euclidean', () => {
      const p = generatePattern('euclidean', 8, 0.5, 0, 0)
      expect(p.filter(Boolean).length).toBe(4)
    })

    it('should default to euclidean for unknown algorithm', () => {
      const p = generatePattern('unknown', 8, 0.5, 0, 0)
      expect(p.filter(Boolean).length).toBe(4)
    })

    it('should route to random', () => {
      const p = generatePattern('random', 8, 0.5, 0, 0.42)
      expect(p).toHaveLength(8)
    })

    it('should route to fibonacci', () => {
      const p = generatePattern('fibonacci', 8, 0.5, 0, 0)
      expect(p).toHaveLength(8)
      expect(p.filter(Boolean).length).toBeGreaterThan(0)
    })
  })
})

describe('Fase 3: autómata celular y ruido con umbral', () => {
  it('autómata celular: determinista por semilla, largo correcto', async () => {
    const { generateCellularPattern, generatePattern } = await import('../audio/patternGenerators.js')
    for (const rule of [30, 90, 110]) {
      const a = generateCellularPattern(16, 0.3, 0.42, { rule, generations: 8 })
      expect(a).toHaveLength(16)
      expect(generateCellularPattern(16, 0.3, 0.42, { rule, generations: 8 })).toEqual(a)
    }
    expect(generateCellularPattern(16, 0.3, 0.42, { rule: 30 })).not.toEqual(generateCellularPattern(16, 0.3, 0.42, { rule: 90 }))
    expect(generateCellularPattern(0, 0.5, 1)).toEqual([])
    expect(generatePattern('cellular', 12, 0.5, 0, 0.1, { rule: 110 })).toHaveLength(12)
  })

  it('regla 90 desde una sola celda da el triángulo de Sierpinski', async () => {
    const { generateCellularPattern } = await import('../audio/patternGenerators.js')
    // density 0 → single live cell in the middle (index 8 of 17)
    const g1 = generateCellularPattern(17, 0, 1, { rule: 90, generations: 1 })
    expect(g1.map((x, i) => (x ? i : -1)).filter(i => i >= 0)).toEqual([7, 9])
    const g2 = generateCellularPattern(17, 0, 1, { rule: 90, generations: 2 })
    expect(g2.map((x, i) => (x ? i : -1)).filter(i => i >= 0)).toEqual([6, 10])
  })

  it('ruido con umbral: cantidad exacta de pulsos, determinista, golpes agrupados', async () => {
    const { generateNoisePattern } = await import('../audio/patternGenerators.js')
    const a = generateNoisePattern(32, 0.25, 0.7, { scale: 8 })
    expect(a.filter(Boolean)).toHaveLength(8)
    expect(generateNoisePattern(32, 0.25, 0.7, { scale: 8 })).toEqual(a)
    expect(generateNoisePattern(32, 0.25, 0.71, { scale: 8 })).not.toEqual(a)
    expect(generateNoisePattern(0, 0.5, 1)).toEqual([])
    // smooth noise → fewer runs than hits (clusters)
    let runs = 0
    for (let i = 0; i < a.length; i++) if (a[i] && !a[(i - 1 + a.length) % a.length]) runs++
    expect(runs).toBeLessThan(8)
  })

  it('la semilla 0 es válida y estable en los algoritmos con semilla', async () => {
    const { generatePattern } = await import('../audio/patternGenerators.js')
    for (const alg of ['random', 'binary', 'cellular', 'noise']) {
      expect(generatePattern(alg, 16, 0.5, 0, 0)).toEqual(generatePattern(alg, 16, 0.5, 0, 0))
    }
  })

  it('rotación en los algoritmos nuevos', async () => {
    const { generatePattern } = await import('../audio/patternGenerators.js')
    const base = generatePattern('noise', 16, 0.25, 0, 0.3)
    const rot = generatePattern('noise', 16, 0.25, 2, 0.3)
    expect(rot).toEqual(base.map((_, i) => base[(i - 2 + 16) % 16]))
  })
})
