/**
 * transport.js — pure helpers for the transport bar (Fase 4A). No Vue.
 */

import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../audio/engine/score.js'

/**
 * Position of a global step as "bar.beat.sixteenth" (1-based), e.g. step 0 →
 * "1.1.1", step 21 → "2.2.2". Negative (stopped) → null.
 */
export function formatPosition(globalStep, { stepsPerBar = STEPS_PER_BAR, stepsPerBeat = STEPS_PER_BEAT } = {}) {
  if (!Number.isFinite(globalStep) || globalStep < 0) return null
  const step = Math.floor(globalStep)
  const bar = Math.floor(step / stepsPerBar) + 1
  const inBar = step % stepsPerBar
  const beat = Math.floor(inBar / stepsPerBeat) + 1
  const sixteenth = (inBar % stepsPerBeat) + 1
  return { bar, beat, sixteenth, label: `${bar}.${beat}.${sixteenth}` }
}

/**
 * Tap tempo: call `tap(timeMs)` on every tap; returns the BPM averaged over
 * the last taps (from the second tap on), or null. A pause longer than
 * `resetAfter` ms starts over.
 */
export function createTapTempo({ maxTaps = 6, resetAfter = 2000, min = 60, max = 200 } = {}) {
  let taps = []
  return {
    tap(now = Date.now()) {
      if (taps.length && now - taps[taps.length - 1] > resetAfter) taps = []
      taps.push(now)
      if (taps.length > maxTaps) taps.shift()
      if (taps.length < 2) return null
      const span = taps[taps.length - 1] - taps[0]
      if (span <= 0) return null
      const bpm = 60000 / (span / (taps.length - 1))
      return Math.min(max, Math.max(min, Math.round(bpm)))
    },
    reset() { taps = [] },
    get count() { return taps.length }
  }
}

/**
 * Oscilloscope line (Fase 4B): one [x, y] point per pixel column, taking the
 * sample of largest magnitude in each column (so peaks are not skipped).
 * No samples → a flat line in the middle.
 * @param {ArrayLike<number>|null} samples -1..1
 */
export function waveformPoints(samples, width, height) {
  const mid = height / 2
  const cols = Math.max(2, Math.floor(width))
  const n = samples?.length || 0
  const pts = []
  for (let x = 0; x < cols; x++) {
    let v = 0
    if (n) {
      const from = Math.floor((x / cols) * n)
      const to = Math.max(from + 1, Math.floor(((x + 1) / cols) * n))
      for (let i = from; i < to && i < n; i++) if (Math.abs(samples[i]) > Math.abs(v)) v = samples[i]
    }
    const y = mid - Math.max(-1, Math.min(1, v || 0)) * (mid - 1)
    pts.push([x * (width / (cols - 1)), y])
  }
  return pts
}
