/**
 * score.js — the score ("partitura"): pure functions that turn musical
 * parameters into a list of note events. No Web Audio, no Vue.
 *
 * Score shape:
 *   {
 *     tempo: number,            // BPM (quarter note)
 *     stepsPerBeat: 4,          // a step is a 16th note
 *     tracks: [Track]
 *   }
 *
 * Track shape:
 *   {
 *     id: string, name: string,
 *     instrument: 'Piano'|'Synth'|'Guitar'|'Bass'|'Drums',
 *     length: number,           // steps in one cycle of this track
 *     steps: boolean[],         // rhythm, length === track.length
 *     volume: number (0..1), pan: number (-1..1),
 *     events: [Event]           // sorted by time
 *   }
 *
 * Event shape (times in STEPS, not seconds, so tempo can change live):
 *   { track, step, time, duration, midi, velocity }
 *   - track:    track id
 *   - step:     integer step index inside the track cycle (0..length-1)
 *   - time:     start, in steps from the start of the cycle (float; === step
 *               until a Groove/swing node exists)
 *   - duration: in steps (float)
 *   - midi:     MIDI note number 0..127 (for Drums: 36 kick, 38 snare,
 *               42 closed hat, 46 open hat)
 *   - velocity: 0..1
 */

import { generatePattern } from '../patternGenerators.js'

export const STEPS_PER_BEAT = 4
export const STEPS_PER_BAR = 16

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9], // major pentatonic (historical default)
  pentatonicMinor: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const MELODY_MODES = ['fixed', 'ascending', 'arpeggio', 'random']

export const DRUM_NOTES = { kick: 36, snare: 38, hihat: 42, openhat: 46 }
export const DRUM_PIECES = ['auto', 'kick', 'snare', 'hihat', 'openhat']

export const INSTRUMENT_NAMES = ['Piano', 'Synth', 'Guitar', 'Bass', 'Drums']

/** Longest note (in steps) each instrument holds before the next hit. */
const MAX_GATE_STEPS = { Piano: 4, Synth: 2, Guitar: 4, Bass: 2, Drums: 1 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const toInt = (v, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : fallback
}

/**
 * Small deterministic PRNG (mulberry32). Accepts any number (including the
 * 0..1 floats stored as node seeds) or string.
 */
export function createRng(seed = 0) {
  let h = 2166136261 >>> 0
  const str = String(seed)
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  }
  let a = h >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Parse a root note: 'C', 'F#', 'Bb' or a pitch class 0..11. Defaults to C. */
export function rootToPitchClass(root) {
  if (typeof root === 'number' && Number.isFinite(root)) return ((Math.round(root) % 12) + 12) % 12
  if (typeof root !== 'string') return 0
  const m = root.trim().match(/^([A-Ga-g])([#b]?)/)
  if (!m) return 0
  let pc = NOTE_NAMES.indexOf(m[1].toUpperCase())
  if (m[2] === '#') pc += 1
  if (m[2] === 'b') pc -= 1
  return ((pc % 12) + 12) % 12
}

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function midiToName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/**
 * Length and Loop semantics: the pattern is generated with
 * `loop` steps and repeated until `length` steps are filled. If
 * `loop >= length` (or no loop), it is generated directly with `length` steps.
 *
 * @returns {boolean[]} exactly `length` steps
 */
export function buildRhythm({ algorithm = 'euclidean', density = 0.5, rotation = 0, seed = 0, length = 16, loop, rule, generations, noiseScale } = {}) {
  const total = Math.max(1, toInt(length, 16))
  const loopSize = loop == null ? total : Math.max(1, toInt(loop, total))
  const cell = Math.min(loopSize, total)
  const options = {}
  if (rule != null) options.rule = rule
  if (generations != null) options.generations = generations
  if (noiseScale != null) options.scale = noiseScale
  const base = generatePattern(algorithm, cell, density, rotation, seed, options).map(Boolean)
  if (cell >= total) return base
  const out = new Array(total)
  for (let i = 0; i < total; i++) out[i] = base[i % cell]
  return out
}

/** Pitch classes (semitones) of the root triad that fits inside the scale. */
function triadOf(scale) {
  const third = scale.includes(4) ? 4 : scale.includes(3) ? 3 : scale[Math.min(1, scale.length - 1)]
  const fifth = scale.includes(7) ? 7 : scale.includes(6) ? 6 : scale[Math.min(2, scale.length - 1)]
  return [0, third, fifth]
}

/**
 * Melody: one MIDI note per hit (hit = active step), NOT per step index, so
 * long patterns never climb out of the audible range.
 *
 * Modes:
 *  - fixed:     always the root.
 *  - ascending: walks up the scale one degree per hit and restarts at the
 *               root after `range` octaves.
 *  - arpeggio:  root triad up and down across `range` octaves.
 *  - random:    seeded random walk (steps of -2..+2 degrees), bounded to
 *               `range` octaves. Same seed → same melody.
 *
 * @param {number} count number of notes
 * @param {object} opts { mode, root, scale, octave, range, seed }
 * @returns {number[]} MIDI notes
 */
export function buildMelody(count, { mode = 'ascending', root = 'C', scale = 'pentatonic', octave = 4, range = 2, seed = 0 } = {}) {
  const intervals = SCALES[scale] || SCALES.pentatonic
  const n = intervals.length
  const octaves = clamp(toInt(range, 2), 1, 4)
  const base = 12 * (clamp(toInt(octave, 4), 0, 8) + 1) + rootToPitchClass(root)
  const degreeToMidi = (d) => base + intervals[((d % n) + n) % n] + 12 * Math.floor(d / n)
  const clampMidi = (m) => clamp(m, 0, 127)
  const notes = new Array(Math.max(0, count))

  switch (mode) {
    case 'fixed':
      notes.fill(clampMidi(base))
      break
    case 'arpeggio': {
      const triad = triadOf(intervals)
      const up = []
      for (let o = 0; o < octaves; o++) for (const s of triad) up.push(base + s + 12 * o)
      up.push(base + 12 * octaves)
      const cycle = up.concat(up.slice(1, -1).reverse())
      for (let i = 0; i < notes.length; i++) notes[i] = clampMidi(cycle[i % cycle.length])
      break
    }
    case 'random': {
      const rng = createRng(seed)
      const maxDegree = n * octaves
      let d = 0
      for (let i = 0; i < notes.length; i++) {
        notes[i] = clampMidi(degreeToMidi(d))
        const move = Math.floor(rng() * 5) - 2
        d += move
        if (d < 0) d = -d
        if (d > maxDegree) d = 2 * maxDegree - d
      }
      break
    }
    case 'ascending':
    default: {
      const span = n * octaves
      for (let i = 0; i < notes.length; i++) notes[i] = clampMidi(degreeToMidi(i % span))
      break
    }
  }
  return notes
}

/** Drum piece for a hit when the voice is in 'auto' mode (one pattern → kit). */
export function autoDrumPiece(step) {
  const s = ((step % 8) + 8) % 8
  if (s === 0) return 'kick'
  if (s === 4) return 'snare'
  return 'hihat'
}

/**
 * Build one track from a track spec.
 *
 * Track spec (the compatibility path of the graph compiler produces one):
 *   {
 *     id, name, instrument,
 *     pattern: { algorithm, density, rotation, seed, rule?, generations?, noiseScale? },
 *     length, loop,
 *     octave,
 *     melody: { mode, root, scale, range, seed },
 *     drumPiece: 'auto'|'kick'|'snare'|'hihat'|'openhat',
 *     velocity (0..1, default 0.8), volume (0..1), pan (-1..1)
 *   }
 */
export function buildTrack(spec = {}, index = 0) {
  const pattern = spec.pattern || {}
  const steps = buildRhythm({
    ...pattern,
    density: pattern.density ?? 0.5,
    rotation: pattern.rotation ?? 0,
    seed: pattern.seed ?? 0,
    length: spec.length ?? 16,
    loop: spec.loop
  })
  const notes = []
  steps.forEach((on, i) => { if (on) notes.push({ step: i, time: i, midi: null, vel: 1 }) })
  return buildTrackFromNotes({ ...spec, length: steps.length, notes, seed: pattern.seed ?? 0 }, index)
}

/**
 * Build one track from note events (what the graph compiler produces).
 *
 *   spec = {
 *     id, name, instrument, length,
 *     notes: [{ step, time?, midi?, vel? }],
 *       - step:  0..length-1 (events outside are dropped)
 *       - time:  in steps; defaults to `step` (Groove moves it inside the step)
 *       - midi:  pitch, or null/undefined → the voice's fallback melody picks it
 *       - vel:   velocity multiplier (Groove/Chord), default 1
 *     melody, octave, seed   fallback melody for unpitched notes (seed: random walk)
 *     drumPiece, velocity (base, 0.8), volume, pan
 *   }
 *
 * Drums ignore pitches: the piece comes from `drumPiece` (or the auto kit).
 * Velocity = base × beat accent (1 on quarter notes, 0.85 otherwise) × vel
 * (× 0.7 for hi-hats). Duration = gap to the next hit step (cyclic), capped
 * per instrument, × 0.9; notes on the same step (chords) share it.
 */
export function buildTrackFromNotes(spec = {}, index = 0) {
  const instrument = INSTRUMENT_NAMES.includes(spec.instrument) ? spec.instrument : 'Piano'
  const id = spec.id != null ? String(spec.id) : `track-${index}`
  const length = Math.max(1, toInt(spec.length, 16))
  const input = (spec.notes || []).filter(n => n && Number.isInteger(n.step) && n.step >= 0 && n.step < length)

  const steps = new Array(length).fill(false)
  for (const n of input) steps[n.step] = true
  const hits = []
  steps.forEach((on, i) => { if (on) hits.push(i) })
  const gapAt = new Map()
  hits.forEach((step, h) => {
    const next = h + 1 < hits.length ? hits[h + 1] : hits[0] + length
    gapAt.set(step, Math.max(1, next - step))
  })

  const timeOf = (n) => (Number.isFinite(n.time) ? n.time : n.step)
  const sorted = input
    .map((n, i) => ({ n, i }))
    .sort((a, b) => timeOf(a.n) - timeOf(b.n) || a.i - b.i)
    .map(x => x.n)

  const baseVelocity = clamp(Number(spec.velocity ?? 0.8), 0, 1)
  const maxGate = MAX_GATE_STEPS[instrument]
  const unpitched = instrument === 'Drums' ? 0 : sorted.filter(n => !Number.isFinite(n.midi)).length
  const melody = unpitched
    ? buildMelody(unpitched, {
      ...(spec.melody || {}),
      octave: spec.octave ?? 4,
      seed: spec.melody?.seed ?? spec.seed ?? 0
    })
    : []
  let m = 0

  const events = sorted.map(n => {
    const step = n.step
    const accent = step % STEPS_PER_BEAT === 0 ? 1 : 0.85
    let velocity = baseVelocity * accent * (Number.isFinite(n.vel) ? n.vel : 1)
    let midi
    if (instrument === 'Drums') {
      const piece = DRUM_NOTES[spec.drumPiece] ? spec.drumPiece : autoDrumPiece(step)
      midi = DRUM_NOTES[piece]
      if (piece === 'hihat' || piece === 'openhat') velocity *= 0.7
    } else {
      midi = Number.isFinite(n.midi) ? clamp(Math.round(n.midi), 0, 127) : melody[m++]
    }
    return {
      track: id,
      step,
      time: timeOf(n),
      duration: Math.min(gapAt.get(step), maxGate) * 0.9,
      midi,
      velocity: Math.round(clamp(velocity, 0, 1) * 1000) / 1000
    }
  })

  return {
    id,
    name: spec.name || instrument,
    instrument,
    length,
    steps,
    volume: clamp(Number(spec.volume ?? 0.8), 0, 1),
    pan: clamp(Number(spec.pan ?? 0), -1, 1),
    events
  }
}

/**
 * Build a full score from track specs.
 * @param {{ tempo?: number, tracks?: object[] }} params
 */
export function buildScore({ tempo = 120, tracks = [] } = {}) {
  return {
    tempo: clamp(Number(tempo) || 120, 20, 300),
    stepsPerBeat: STEPS_PER_BEAT,
    tracks: tracks.map((spec, i) => buildTrack(spec, i))
  }
}

/** Largest delay (in steps) swing may give a note, as the Groove node. */
export const MAX_SWING_OFFSET = 0.9

/**
 * Global swing (Fase 4A, transport bar): delays the off-beat 16ths (odd
 * steps of each track) by `amount × 0.5` step, on top of any Groove offset,
 * capped at MAX_SWING_OFFSET. Pure: returns a new score (the same one when
 * amount is 0). Applied after compiling, so it reaches playback, WAV, stems
 * and MIDI alike. Odd-length tracks alternate parity between cycles.
 * @param {object} score
 * @param {number} amount 0..1
 */
export function applySwing(score, amount = 0) {
  const swing = clamp(Number(amount) || 0, 0, 1)
  if (!score || swing === 0) return score
  return {
    ...score,
    swing,
    tracks: (score.tracks || []).map(track => ({
      ...track,
      events: (track.events || []).map(ev => {
        if (ev.step % 2 !== 1) return ev
        const offset = Math.min(MAX_SWING_OFFSET, Math.max(0, ev.time - ev.step) + swing * 0.5)
        return { ...ev, time: ev.step + offset }
      })
    }))
  }
}

/** Steps in one full pass of the score (longest track). */
export function scoreLength(score) {
  if (!score?.tracks?.length) return 0
  return Math.max(...score.tracks.map(t => t.length || 0))
}

/** Seconds per step at a tempo. */
export function stepDuration(tempo, stepsPerBeat = STEPS_PER_BEAT) {
  return 60 / tempo / stepsPerBeat
}

const stepIndexCache = new WeakMap()

/**
 * Events of one track that start at global step `globalStep`. Tracks cycle
 * over their own length (polymetry ready for Fase 3).
 * Returned events keep their in-cycle `time`; the offset inside the step is
 * `event.time - event.step`.
 */
export function eventsAtStep(track, globalStep) {
  if (!track?.length) return []
  const local = ((globalStep % track.length) + track.length) % track.length
  let map = stepIndexCache.get(track)
  if (!map) {
    map = new Map()
    for (const ev of track.events) {
      if (!map.has(ev.step)) map.set(ev.step, [])
      map.get(ev.step).push(ev)
    }
    stepIndexCache.set(track, map)
  }
  return map.get(local) || []
}

/**
 * Lay the score out on an absolute timeline: `repeats` passes of
 * scoreLength(score) steps. Returns events with absolute `time` (steps from
 * the start) plus `seconds`/`durationSeconds` at the score tempo.
 * `totalSteps` overrides the length (a stem keeps the length of the full mix).
 * Used by the WAV render and by the MIDI export.
 */
export function unrollScore(score, { repeats = 1, totalSteps } = {}) {
  const total = Number.isInteger(totalSteps) && totalSteps > 0
    ? totalSteps
    : scoreLength(score) * Math.max(1, toInt(repeats, 1))
  const sd = stepDuration(score.tempo, score.stepsPerBeat || STEPS_PER_BEAT)
  const out = []
  for (const track of score.tracks) {
    for (let g = 0; g < total; g++) {
      for (const ev of eventsAtStep(track, g)) {
        const time = g + (ev.time - ev.step)
        out.push({
          ...ev,
          step: g,
          time,
          seconds: time * sd,
          durationSeconds: ev.duration * sd,
          instrument: track.instrument
        })
      }
    }
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/** True when at least one track of the list is soloed. */
export function hasSolo(tracks = []) {
  return (tracks || []).some(t => t && t.solo)
}

/**
 * Is a track heard in the mix? With any solo active only soloed tracks are
 * (solo wins over mute on the same track); otherwise every unmuted track.
 * @param {object} track
 * @param {object[]|boolean} tracksOrSolo  all tracks of the score, or hasSolo() precomputed
 */
export function isTrackAudible(track, tracksOrSolo = []) {
  if (!track) return false
  const soloActive = typeof tracksOrSolo === 'boolean' ? tracksOrSolo : hasSolo(tracksOrSolo)
  return soloActive ? !!track.solo : !track.mute
}
