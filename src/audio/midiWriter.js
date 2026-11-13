/**
 * midiWriter.js — Standard MIDI File (Type 1, multitrack) from an engine score.
 *
 * Notes, durations and velocities come from the same score the audio engine
 * plays (src/audio/engine/score.js). Track 0 holds tempo and time signature;
 * then one MIDI track and one channel per score track (Drums → channel 10,
 * i.e. index 9).
 */

import { unrollScore } from './engine/score.js'

export const TICKS_PER_QUARTER = 480
const DRUM_CHANNEL = 9

// Internal instrument names → General MIDI program numbers
export const GM_PROGRAMS = {
  Piano: 0,   // Acoustic Grand Piano
  Synth: 81,  // Lead 2 (sawtooth)
  Guitar: 24, // Acoustic Guitar (nylon)
  Bass: 33,   // Electric Bass (finger)
  Drums: 0    // channel 10, program ignored
}

function varInt(value) {
  let v = Math.max(0, Math.round(value))
  const parts = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    parts.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return parts
}

const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
const u16 = (v) => [(v >> 8) & 0xff, v & 0xff]
const ascii = (s) => Array.from(s, c => c.charCodeAt(0))

/**
 * MIDI channel (0-based) of every track: Drums → 9 (channel 10); the others
 * take 0, 1, 2… skipping 9, and wrap around after 15 (more than 15 pitched
 * tracks share channels).
 * @returns {Map<string, number>}
 */
export function assignChannels(tracks = []) {
  const melodic = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]
  const channels = new Map()
  let next = 0
  for (const track of tracks) {
    if (track.instrument === 'Drums') channels.set(track.id, DRUM_CHANNEL)
    else channels.set(track.id, melodic[next++ % melodic.length])
  }
  return channels
}

function chunk(type, data) {
  return [...ascii(type), ...u32(data.length), ...data]
}

/** Delta-time encoded track body from absolute-tick events (+ end of track). */
function encodeTrack(timed) {
  timed.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const out = []
  let last = 0
  for (const ev of timed) {
    out.push(...varInt(ev.tick - last), ...ev.data)
    last = ev.tick
  }
  out.push(0x00, 0xff, 0x2f, 0x00)
  return out
}

function textMeta(type, text) {
  const bytes = Array.from(unescape(encodeURIComponent(String(text || ''))), c => c.charCodeAt(0)).slice(0, 127)
  return [0xff, type, bytes.length, ...bytes]
}

/**
 * Standard MIDI File Type 1 from an engine score:
 *  - track 0 (control): name, tempo, 4/4 time signature;
 *  - one MIDI track per score track: its name, program change (except Drums)
 *    and its notes on its own channel (Drums on channel 10).
 * Every track of the score is written (mute/solo do not apply), each cycling
 * over its own length for `repeats` passes of the longest one.
 *
 * @param {object} score  engine score ({ tempo, stepsPerBeat, tracks })
 * @param {{ repeats?: number, name?: string }} [opts]
 * @returns {Uint8Array|null} null when the score has no notes
 */
export function buildMidiFromScore(score, { repeats = 1, name = 'CarriGraph' } = {}) {
  if (!score?.tracks?.length) return null
  const events = unrollScore(score, { repeats })
  if (events.length === 0) return null

  const ticksPerStep = TICKS_PER_QUARTER / (score.stepsPerBeat || 4)
  const channels = assignChannels(score.tracks)
  const tempoMicros = Math.round(60_000_000 / score.tempo)

  const control = [
    { tick: 0, order: 0, data: textMeta(0x03, name) },
    { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (tempoMicros >> 16) & 0xff, (tempoMicros >> 8) & 0xff, tempoMicros & 0xff] },
    { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] } // 4/4
  ]
  const chunks = [chunk('MTrk', encodeTrack(control))]

  const byTrack = new Map(score.tracks.map(t => [t.id, []]))
  for (const ev of events) byTrack.get(ev.track)?.push(ev)

  for (const track of score.tracks) {
    const ch = channels.get(track.id)
    const timed = [{ tick: 0, order: 0, data: textMeta(0x03, track.name || track.instrument) }]
    if (ch !== DRUM_CHANNEL) timed.push({ tick: 0, order: 0, data: [0xc0 | ch, GM_PROGRAMS[track.instrument] ?? 0] })
    for (const ev of byTrack.get(track.id)) {
      const note = Math.min(127, Math.max(0, Math.round(ev.midi)))
      const vel = Math.min(127, Math.max(1, Math.round(ev.velocity * 127)))
      const on = Math.round(ev.time * ticksPerStep)
      const off = Math.max(on + 1, Math.round((ev.time + ev.duration) * ticksPerStep))
      timed.push({ tick: on, order: 2, data: [0x90 | ch, note, vel] })
      timed.push({ tick: off, order: 1, data: [0x80 | ch, note, 64] })
    }
    chunks.push(chunk('MTrk', encodeTrack(timed)))
  }

  return new Uint8Array([
    ...ascii('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(TICKS_PER_QUARTER),
    ...chunks.flat()
  ])
}

/**
 * Minimal parser of the files written above (Type 0 or 1; used by tests
 * and handy for debugging). Returns all notes with absolute ticks, plus
 * `tracks: [{ name, notes, programs }]` per MTrk chunk.
 */
export function parseMidi(bytes) {
  let p = 0
  const read = (n) => { const out = bytes.slice(p, p + n); p += n; return out }
  const readU32 = () => { const b = read(4); return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 }
  const readU16 = () => { const b = read(2); return (b[0] << 8) | b[1] }
  const readVar = () => { let v = 0; let b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f) } while (b & 0x80); return v }
  const header = String.fromCharCode(...read(4))
  readU32()
  const format = readU16()
  const ntracks = readU16()
  const division = readU16()
  const result = { header, format, ntracks, division, tempo: null, timeSignature: null, programs: [], notes: [], tracks: [] }
  for (let t = 0; t < ntracks; t++) {
    read(4)
    const len = readU32()
    const end = p + len
    let tick = 0
    const open = new Map()
    const info = { name: null, notes: [], programs: [] }
    result.tracks.push(info)
    while (p < end) {
      tick += readVar()
      const status = bytes[p++]
      if (status === 0xff) {
        const type = bytes[p++]
        const l = readVar()
        const d = read(l)
        if (type === 0x51) result.tempo = Math.round(60_000_000 / ((d[0] << 16) | (d[1] << 8) | d[2]))
        if (type === 0x58) result.timeSignature = [d[0], 2 ** d[1]]
        if (type === 0x03) { try { info.name = decodeURIComponent(escape(String.fromCharCode(...d))) } catch { info.name = String.fromCharCode(...d) } }
      } else if ((status & 0xf0) === 0xc0) {
        const prog = { channel: status & 0x0f, program: bytes[p++] }
        result.programs.push(prog)
        info.programs.push(prog)
      } else {
        const kind = status & 0xf0
        const channel = status & 0x0f
        const note = bytes[p++]
        const vel = bytes[p++]
        const key = `${channel}:${note}`
        if (kind === 0x90 && vel > 0) {
          if (!open.has(key)) open.set(key, [])
          open.get(key).push({ channel, note, velocity: vel, start: tick })
        } else if (kind === 0x80 || kind === 0x90) {
          const n = open.get(key)?.shift()
          if (n) { result.notes.push({ ...n, end: tick }); info.notes.push({ ...n, end: tick }) }
        }
      }
    }
  }
  result.notes.sort((a, b) => a.start - b.start || a.note - b.note)
  return result
}
