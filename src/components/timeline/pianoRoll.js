/**
 * pianoRoll.js — pure layout of the multitrack piano roll (no Vue, no DOM).
 * Units are steps (x, width) and pitch rows; the components turn them into
 * pixels with the current zoom.
 */

import { midiToName } from '../../audio/engine/score.js'

export const TRACK_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16']
export const trackColor = (i) => TRACK_COLORS[((i % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length]

const DRUM_LABELS = { 36: 'Bombo', 38: 'Redoblante', 42: 'HH cerrado', 46: 'HH abierto' }

/** Notes drawn per lane at most (ghost repetitions are dropped first). */
export const MAX_LANE_NOTES = 6000

/**
 * Pitch rows of a track.
 *  - Drums: one row per piece used (bottom = lowest note).
 *  - Pitched: every semitone from the lowest to the highest note, at least 5.
 * @returns {{ rows: number, rowOf(midi): number, low: number, high: number, label(midi): string }}
 */
export function pitchLayout(track) {
  const midis = [...new Set((track?.events || []).map(e => e.midi).filter(Number.isFinite))].sort((a, b) => a - b)
  if (track?.instrument === 'Drums') {
    const index = new Map(midis.map((m, i) => [m, i]))
    return {
      rows: Math.max(1, midis.length),
      rowOf: (m) => index.get(m) ?? 0,
      low: midis[0] ?? 36,
      high: midis.at(-1) ?? 36,
      label: (m) => DRUM_LABELS[m] || midiToName(m)
    }
  }
  if (!midis.length) return { rows: 1, rowOf: () => 0, low: 60, high: 60, label: midiToName }
  let low = midis[0]
  let high = midis.at(-1)
  while (high - low + 1 < 5) { if ((high - low) % 2) low--; else high++ }
  return { rows: high - low + 1, rowOf: (m) => m - low, low, high, label: midiToName }
}

/**
 * Notes of one lane, laid out over `maxLength` steps (the longest track).
 * A shorter track is drawn once in full and then repeated as "ghost" notes
 * until maxLength, so polymeters line up visually with the longest track.
 *
 * @param {object} track  engine track ({ length, events: [{ step, time, duration, midi, velocity }] })
 * @param {{ maxLength?: number, maxNotes?: number }} [opts]
 * @returns {{ rows: number, notes: { key, x, w, row, velocity, midi, ghost, step, title }[], truncated: boolean }}
 */
export function laneLayout(track, { maxLength = track?.length || 0, maxNotes = MAX_LANE_NOTES } = {}) {
  const pitch = pitchLayout(track)
  const len = Math.max(1, track?.length || 1)
  const events = track?.events || []
  const total = Math.max(len, maxLength)
  const notes = []
  let truncated = false
  for (let cycle = 0; cycle * len < total; cycle++) {
    const offset = cycle * len
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      const x = offset + e.time
      if (x >= total) continue
      if (notes.length >= maxNotes) { truncated = true; break }
      notes.push({
        key: `${cycle}:${i}`,
        x,
        w: Math.max(0.15, Math.min(e.duration, total - x)),
        row: pitch.rowOf(e.midi),
        velocity: e.velocity,
        midi: e.midi,
        ghost: cycle > 0,
        step: e.step,
        title: `${pitch.label(e.midi)} · paso ${e.step + 1} · intensidad ${Math.round(e.velocity * 100)}%`
      })
    }
    if (truncated) break
  }
  return { rows: pitch.rows, notes, truncated }
}

/** Default zoom (pixels per step) so that common lengths fit and 512 stays usable. */
export function defaultCellWidth(maxLength) {
  if (maxLength <= 32) return 22
  if (maxLength <= 64) return 16
  if (maxLength <= 128) return 10
  if (maxLength <= 256) return 7
  return 5
}

export const MIN_CELL_WIDTH = 3
export const MAX_CELL_WIDTH = 40

/** Ruler marks: one per bar (16 steps), labelled 1, 2, 3… */
export function rulerMarks(maxLength, stepsPerBar = 16) {
  const marks = []
  for (let s = 0; s < maxLength; s += stepsPerBar) marks.push({ step: s, label: String(s / stepsPerBar + 1) })
  return marks
}

/**
 * Horizontal scroll that keeps the playhead visible ("seguir"): returns the
 * new scrollLeft, or null if it is already in view.
 */
export function followScroll(playheadX, scrollLeft, viewWidth, margin = 40) {
  if (viewWidth <= 0) return null
  if (playheadX < scrollLeft + margin || playheadX > scrollLeft + viewWidth - margin) {
    return Math.max(0, playheadX - margin)
  }
  return null
}
