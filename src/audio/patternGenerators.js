/**
 * Pattern generation algorithms used by PatternNode and AudioStore.
 * All algorithms return an array of booleans (true = pulse/note).
 */

const toLength = (value) => Math.max(0, Math.floor(Number(value) || 0))

const clampPulses = (pulses, length) =>
  Math.min(length, Math.max(0, Math.round(Number(pulses) || 0)))

/**
 * Pick `count` items from `candidates`, spread as evenly as possible
 * (deterministic, never consecutive unless forced).
 */
function pickSpread(candidates, count) {
  const n = candidates.length
  const k = Math.min(count, n)
  const picked = []
  for (let j = 0; j < k; j++) {
    picked.push(candidates[Math.floor(((j + 0.5) * n) / k)])
  }
  return picked
}

/**
 * Euclidean rhythm — distributes `pulses` as evenly as possible across `steps`.
 * Rotated by `rotation` positions to the right; any integer is accepted
 * (negative values rotate left, values >= steps wrap around).
 */
export function generateEuclideanPattern(steps, pulses, rotation = 0) {
  const length = toLength(steps)
  if (length === 0) return []
  const k = clampPulses(pulses, length)

  const base = new Array(length)
  for (let i = 0; i < length; i++) {
    base[i] = Math.floor((k * (i + 1)) / length) - Math.floor((k * i) / length) > 0
  }

  const shift = (((Math.round(Number(rotation)) || 0) % length) + length) % length
  if (shift === 0) return base

  const pattern = new Array(length)
  for (let i = 0; i < length; i++) {
    pattern[(i + shift) % length] = base[i]
  }
  return pattern
}

/**
 * Random pattern — uses a seeded PRNG for reproducibility.
 */
export function generateRandomPattern(length, density, seed) {
  let random = seed
  const seededRandom = () => {
    random = (random * 9301 + 49297) % 233280
    return random / 233280
  }

  return new Array(length).fill(false).map(() => seededRandom() < density)
}

/**
 * Binary pattern — the seed as a 16-bit word gives the first 16 steps; each
 * following block of 16 steps uses a word derived from the previous one
 * (16-bit LCG), so the whole length is covered. The pulse count is then
 * adjusted to round(length * density), adding/removing pulses spread across
 * the pattern (not in a row).
 */
export function generateBinaryPattern(length, density, seed) {
  const n = toLength(length)
  if (n === 0) return []

  let word = Math.floor(Math.abs(Number(seed) || 0) * 65536) & 0xffff
  const pattern = new Array(n)
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 16 === 0) {
      word = (word * 25173 + 13849) & 0xffff
    }
    pattern[i] = Boolean(word & (1 << (i % 16)))
  }

  const target = clampPulses(n * density, n)
  const current = pattern.filter(Boolean).length

  if (current < target) {
    const empty = []
    pattern.forEach((on, i) => { if (!on) empty.push(i) })
    for (const i of pickSpread(empty, target - current)) pattern[i] = true
  } else if (current > target) {
    const full = []
    pattern.forEach((on, i) => { if (on) full.push(i) })
    for (const i of pickSpread(full, current - target)) pattern[i] = false
  }

  return pattern
}

/**
 * Fibonacci pattern — exactly round(length * density) pulses. Priority:
 * 1) Fibonacci positions 1, 2, 3, 5, 8, 13... (1-based, each counted once);
 * 2) further Fibonacci numbers wrapped modulo the length;
 * 3) remaining free steps, spread evenly.
 */
export function generateFibonacciPattern(length, density) {
  const n = toLength(length)
  if (n === 0) return []

  const target = clampPulses(n * density, n)
  const order = []
  const seen = new Set()
  const add = (index) => {
    if (order.length < target && !seen.has(index)) {
      seen.add(index)
      order.push(index)
    }
  }

  // 1) Distinct Fibonacci positions within the length
  for (let a = 1, b = 2; a <= n && order.length < target; [a, b] = [b, a + b]) {
    add(a - 1)
  }

  // 2) Fibonacci sequence modulo n (Pisano period is at most 6n)
  for (let k = 0, a = 1 % n, b = 1 % n; k < 6 * n + 2 && order.length < target; k++) {
    add((a - 1 + n) % n)
    ;[a, b] = [b, (a + b) % n]
  }

  // 3) Fill what is left, spread over the free steps
  if (order.length < target) {
    const free = []
    for (let i = 0; i < n; i++) if (!seen.has(i)) free.push(i)
    for (const i of pickSpread(free, target - order.length)) add(i)
  }

  const pattern = new Array(n).fill(false)
  for (const i of order) pattern[i] = true
  return pattern
}

/**
 * Small deterministic PRNG for the generators (mulberry32 over a hash of the
 * seed). Accepts the 0..1 floats stored as node seeds, integers or strings.
 * 0 is a valid seed.
 */
export function seededRandom(seed = 0) {
  let h = 2166136261 >>> 0
  const str = String(seed)
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  let a = h >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rotate a pattern `rotation` steps to the right (negative = left). */
export function rotatePattern(pattern, rotation = 0) {
  const n = pattern.length
  if (n === 0) return []
  const shift = (((Math.round(Number(rotation)) || 0) % n) + n) % n
  if (shift === 0) return pattern.slice()
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[(i + shift) % n] = pattern[i]
  return out
}

export const CELLULAR_RULES = [30, 90, 110]

/**
 * Elementary cellular automaton (rules 30 / 90 / 110, any 0..255 works).
 * The first row is seeded random noise with probability `density` (at least
 * one live cell), evolved `generations` times with wrap-around; the last row
 * is the pattern (or the last non-empty one, if the rule died out).
 * Deterministic per seed. The pulse count is emergent (the
 * rule decides it), `density` only shapes the first row.
 */
export function generateCellularPattern(length, density, seed, { rule = 30, generations = 7 } = {}) {
  const n = toLength(length)
  if (n === 0) return []
  const r = Math.min(255, Math.max(0, Math.round(Number(rule)) || 30))
  const gens = Math.min(256, Math.max(0, Math.round(Number(generations)) || 0))
  const rng = seededRandom(`ca:${seed}`)
  const p = Math.min(1, Math.max(0, Number(density) || 0))
  let row = new Array(n)
  for (let i = 0; i < n; i++) row[i] = rng() < p
  if (!row.some(Boolean)) row[Math.floor(n / 2)] = true
  let lastAlive = row
  for (let g = 0; g < gens; g++) {
    const next = new Array(n)
    for (let i = 0; i < n; i++) {
      const l = row[(i - 1 + n) % n] ? 4 : 0
      const c = row[i] ? 2 : 0
      const rr = row[(i + 1) % n] ? 1 : 0
      next[i] = ((r >> (l | c | rr)) & 1) === 1
    }
    row = next
    if (row.some(Boolean)) lastAlive = row
  }
  // Linear rules (90) die out on rings of 2^k cells after 2^(k-1)
  // generations: keep the last generation that still had live cells.
  return row.some(Boolean) ? row : lastAlive
}

/**
 * Smooth (value) noise with a threshold, Perlin-style: seeded random values
 * on a lattice every `scale` steps, smoothstep interpolation plus a second
 * octave at half amplitude. The lattice wraps so the pattern loops without a
 * seam. The threshold is the quantile that leaves exactly
 * round(length * density) steps above it (ties broken by position), so hits
 * come in clusters where the noise is high. Deterministic per seed.
 */
export function generateNoisePattern(length, density, seed, { scale = 4 } = {}) {
  const n = toLength(length)
  if (n === 0) return []
  const spacing = Math.max(1, Number(scale) || 4)
  const octave = (points, salt) => {
    const rng = seededRandom(`noise:${seed}:${salt}`)
    const lattice = Array.from({ length: points }, () => rng())
    return (i) => {
      const x = (i * points) / n
      const k = Math.floor(x) % points
      const f = x - Math.floor(x)
      const t = f * f * (3 - 2 * f)
      return lattice[k] * (1 - t) + lattice[(k + 1) % points] * t
    }
  }
  const m = Math.max(1, Math.round(n / spacing))
  const o1 = octave(m, 1)
  const o2 = octave(m * 2, 2)
  const values = []
  for (let i = 0; i < n; i++) values.push({ i, v: o1(i) + 0.5 * o2(i) })
  const target = clampPulses(n * density, n)
  values.sort((a, b) => b.v - a.v || a.i - b.i)
  const pattern = new Array(n).fill(false)
  for (let j = 0; j < target; j++) pattern[values[j].i] = true
  return pattern
}

/**
 * Route to the correct algorithm by name.
 * `options` carries algorithm-specific parameters:
 *   cellular: { rule, generations }   noise: { scale }
 * Rotation applies to euclidean and to the new algorithms (cellular, noise);
 * the older random/binary/fibonacci keep ignoring it (unchanged sound).
 */
export function generatePattern(algorithm, length, density, rotation, seed, options = {}) {
  const pulses = Math.round(length * density)

  switch (algorithm) {
    case 'euclidean':
      return generateEuclideanPattern(length, pulses, rotation)
    case 'random':
      return generateRandomPattern(length, density, seed)
    case 'binary':
      return generateBinaryPattern(length, density, seed)
    case 'fibonacci':
      return generateFibonacciPattern(length, density)
    case 'cellular':
      return rotatePattern(generateCellularPattern(length, density, seed, options), rotation)
    case 'noise':
      return rotatePattern(generateNoisePattern(length, density, seed, options), rotation)
    default:
      return generateEuclideanPattern(length, pulses, rotation)
  }
}
