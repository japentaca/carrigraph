import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTransport } from '../audio/engine/transport.js'
import { buildScore } from '../audio/engine/score.js'
import { createFakeTimers } from './helpers/fakeAudioContext.js'

// 120 BPM → 0.125 s per step; density 1 → one note per step.
const allSteps = (length = 16, extra = {}) => buildScore({
  tempo: 120,
  tracks: [{ id: 't1', instrument: 'Piano', pattern: { algorithm: 'euclidean', density: 1 }, length, ...extra }]
})

function setup(opts = {}) {
  const clock = { now: 0 }
  const timers = createFakeTimers()
  const played = []
  const output = {
    play: vi.fn((track, note) => { played.push({ track: track.id, ...note }); return { end: note.time + note.duration, stop() {} } }),
    stopAll: vi.fn(),
    syncTracks: vi.fn(),
    prune: vi.fn()
  }
  const states = []
  const onEnd = vi.fn()
  const transport = createTransport({
    clock: () => clock.now,
    timers,
    output,
    lookahead: 0.1,
    startDelay: 0.05,
    onStateChange: (s) => states.push(s),
    onEnd,
    ...opts
  })
  /** Advance the fake audio clock in timer-sized slices, firing the timer. */
  const advance = (seconds, slice = 0.025) => {
    const end = clock.now + seconds
    while (clock.now < end - 1e-9) {
      clock.now = Math.min(end, clock.now + slice)
      timers.fire()
    }
  }
  return { clock, timers, output, played, transport, states, onEnd, advance }
}

describe('engine/transport', () => {
  let t
  beforeEach(() => { t = setup() })

  it('programa solo dentro de la ventana de anticipación', () => {
    t.transport.start({ score: allSteps(), loop: true })
    // now=0: window [0, 0.1]; first step at 0.05 → only step 0
    expect(t.played.map(p => p.step)).toEqual([0])
    expect(t.played[0].time).toBeCloseTo(0.05)
    expect(t.timers.ms).toBe(25)
    t.advance(0.1) // now=0.1 → window up to 0.2 → steps at 0.05, 0.175
    expect(t.played.map(p => p.step)).toEqual([0, 1])
    expect(t.played[1].time).toBeCloseTo(0.175)
  })

  it('los tiempos salen del reloj de audio, no del timer', () => {
    t.transport.start({ score: allSteps() })
    t.advance(1)
    t.played.forEach((p, i) => expect(p.time).toBeCloseTo(0.05 + i * 0.125, 6))
    expect(t.played[0].duration).toBeCloseTo(0.9 * 0.125)
  })

  it('loop continuo: sigue después del final del patrón', () => {
    t.transport.start({ score: allSteps(16), loop: true })
    t.advance(16 * 0.125 * 2.5)
    expect(t.played.length).toBeGreaterThan(32)
    expect(t.transport.isPlaying()).toBe(true)
    expect(t.played[16].step).toBe(16)
  })

  it('modo una vez: suena una pasada y vuelve a detenido solo', () => {
    t.transport.start({ score: allSteps(16), loop: false })
    expect(t.states).toEqual(['playing'])
    t.advance(1.9) // last step starts at 0.05 + 15*0.125 = 1.925 (scheduled ahead)
    expect(t.transport.isPlaying()).toBe(true)
    t.advance(0.3)  // end = 0.05 + 16*0.125 = 2.05
    expect(t.played).toHaveLength(16)
    expect(t.transport.isPlaying()).toBe(false)
    expect(t.states).toEqual(['playing', 'stopped'])
    expect(t.onEnd).toHaveBeenCalledTimes(1)
    // natural end: tails ring out, no hard stop
    expect(t.output.stopAll).not.toHaveBeenCalled()
    expect(t.timers.fn).toBe(null)
  })

  it('stop corta la programación y apaga lo que suena', () => {
    t.transport.start({ score: allSteps() })
    t.advance(0.5)
    const count = t.played.length
    t.transport.stop()
    expect(t.output.stopAll).toHaveBeenCalledTimes(1)
    expect(t.transport.isPlaying()).toBe(false)
    t.advance(1)
    expect(t.played).toHaveLength(count)
    expect(t.transport.getPosition()).toBe(null)
    expect(t.transport.getCurrentStep()).toBe(-1)
  })

  it('paso actual derivado del reloj de audio', () => {
    t.transport.start({ score: allSteps(16) })
    expect(t.transport.getCurrentStep()).toBe(-1) // before the first step
    t.advance(0.06) // mid-step, away from float boundaries
    expect(t.transport.getCurrentStep()).toBe(0)
    t.advance(0.125 * 3)
    expect(t.transport.getCurrentStep()).toBe(3)
    t.advance(0.125 * 14) // global step 17 → track step 1
    expect(t.transport.getPosition().step).toBe(17)
    expect(t.transport.getCurrentStep()).toBe(1)
    expect(t.transport.getCurrentStep('t1')).toBe(1)
  })

  it('cambio de partitura en caliente: se aplica en el próximo compás, sin cortar', () => {
    const a = allSteps(16)
    const b = buildScore({ tempo: 120, tracks: [{ id: 't1', instrument: 'Bass', pattern: { algorithm: 'euclidean', density: 1 }, length: 16, octave: 2, melody: { mode: 'fixed' } }] })
    t.transport.start({ score: a })
    t.advance(0.5) // a few steps in
    const before = t.played.length
    t.transport.setScore(b)
    t.advance(16 * 0.125 * 1.5)
    expect(t.output.stopAll).not.toHaveBeenCalled()
    const firstB = t.played.findIndex(p => p.midi === 36)
    expect(firstB).toBeGreaterThanOrEqual(before)
    expect(t.played[firstB].step).toBe(16) // next bar
    expect(t.played.slice(0, firstB).every(p => p.midi !== 36)).toBe(true)
    expect(t.transport.isPlaying()).toBe(true)
  })

  it('cambio de tempo en caliente: el paso dura distinto desde el próximo compás', () => {
    t.transport.start({ score: allSteps(16) })
    t.advance(0.3)
    t.transport.setTempo(60) // 0.25 s per step
    t.advance(16 * 0.125 + 1)
    const s15 = t.played.find(p => p.step === 15)
    const s16 = t.played.find(p => p.step === 16)
    const s17 = t.played.find(p => p.step === 17)
    expect(s16.time - s15.time).toBeCloseTo(0.125) // still old tempo for step 15
    expect(s17.time - s16.time).toBeCloseTo(0.25)  // new tempo from the bar
    expect(t.transport.getTempo()).toBe(60)
  })

  it('setLoop(false) mientras suena termina al final de la pasada actual', () => {
    t.transport.start({ score: allSteps(16), loop: true })
    t.advance(2.5) // into the 2nd pass
    t.transport.setLoop(false)
    t.advance(5)
    expect(t.transport.isPlaying()).toBe(false)
    expect(Math.max(...t.played.map(p => p.step))).toBe(31)
  })

  it('setScore con el transporte detenido reemplaza de inmediato', () => {
    t.transport.setScore(allSteps(8))
    expect(t.transport.getScore().tracks[0].length).toBe(8)
    expect(t.transport.start()).toBe(true)
  })

  it('no arranca con una partitura vacía', () => {
    expect(t.transport.start({ score: buildScore({ tracks: [] }) })).toBe(false)
    expect(t.transport.isPlaying()).toBe(false)
  })

  it('polimetría: cada pista cicla sobre su propia longitud', () => {
    const score = buildScore({
      tempo: 120,
      tracks: [
        { id: 'a', pattern: { algorithm: 'euclidean', density: 1 }, length: 3 },
        { id: 'b', pattern: { algorithm: 'euclidean', density: 1 }, length: 4 }
      ]
    })
    t.transport.start({ score })
    t.advance(1.6)
    const a = t.played.filter(p => p.track === 'a')
    const b = t.played.filter(p => p.track === 'b')
    expect(a.length).toBe(b.length)
    expect(t.transport.getPosition().trackSteps.a).toBe(t.transport.getPosition().step % 3)
    expect(t.transport.getPosition().trackSteps.b).toBe(t.transport.getPosition().step % 4)
  })
})
