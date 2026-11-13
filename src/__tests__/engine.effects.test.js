import { describe, it, expect, vi } from 'vitest'
import {
  normalizeEffect, normalizeEffects, effectTail, effectsTail, chainSignature, distortionCurve, distortionMakeup,
  getImpulseResponse, createEffect, createEffectChain, EFFECT_TYPES, MAX_EFFECT_TAIL
} from '../audio/engine/effects.js'
import { createTrackBus } from '../audio/engine/bus.js'
import { createOutput } from '../audio/engine/output.js'
import { renderScore, renderDuration, renderTail, renderStems, renderStemsWav } from '../audio/engine/render.js'
import { createEngine } from '../audio/engine/index.js'
import { buildScore, buildTrackFromNotes, hasSolo, isTrackAudible, unrollScore } from '../audio/engine/score.js'
import { FakeAudioContext, createFakeTimers } from './helpers/fakeAudioContext.js'

const reverb = (extra = {}) => ({ id: 'r', type: 'reverb', amount: 0.5, decay: 2, ...extra })
const delay = (extra = {}) => ({ id: 'd', type: 'delay', amount: 0.4, time: 0.25, feedback: 0.5, ...extra })
const filter = (extra = {}) => ({ id: 'f', type: 'filter', amount: 1, mode: 'lowpass', cutoff: 800, resonance: 2, ...extra })

/** Follow connections from `from`; true if `to` is reachable. */
function reachable(from, to, seen = new Set()) {
  if (from === to) return true
  if (seen.has(from)) return false
  seen.add(from)
  return from.connections.some(n => reachable(n, to, seen))
}

const later = () => {
  const queue = []
  return { setTimeout: (fn, ms) => queue.push({ fn, ms }), queue, flush: () => queue.splice(0).forEach(q => q.fn()) }
}

describe('effects: funciones puras', () => {
  it('normalizeEffect recorta parámetros y rechaza tipos desconocidos', () => {
    expect(normalizeEffect({ type: 'chorus' })).toBe(null)
    expect(normalizeEffect(null)).toBe(null)
    const d = normalizeEffect({ type: 'delay', amount: 3, time: 9, feedback: 1.5 })
    expect(d).toMatchObject({ type: 'delay', amount: 1, time: 1.5, feedback: 0.9 })
    const f = normalizeEffect({ type: 'filter', mode: 'notch', cutoff: 5, resonance: 0 })
    expect(f).toMatchObject({ mode: 'lowpass', cutoff: 40, resonance: 0.1 })
    expect(normalizeEffect({ type: 'reverb' })).toMatchObject({ amount: 0.3, decay: 2.5, id: 'reverb-0' })
    expect(normalizeEffects([{ type: 'x' }, reverb()])).toHaveLength(1)
    expect(EFFECT_TYPES).toEqual(['distortion', 'filter', 'delay', 'reverb'])
  })

  it('cola: la reverb dura su decaimiento y el delay hasta caer 60 dB', () => {
    expect(effectTail(reverb({ decay: 3 }))).toBe(3)
    // 0.25 s, feedback 0.5 → log(0.001)/log(0.5) ≈ 9.97 repeticiones
    expect(effectTail(delay())).toBeCloseTo(0.25 * (Math.log(0.001) / Math.log(0.5) + 1), 5)
    expect(effectTail(filter())).toBe(0)
    expect(effectTail(reverb({ amount: 0 }))).toBe(0)
    expect(effectsTail([delay(), reverb({ decay: 3 })])).toBeCloseTo(effectTail(delay()) + 3, 5)
    expect(effectsTail([reverb({ decay: 8 }), delay({ time: 1.5, feedback: 0.9 })])).toBe(MAX_EFFECT_TAIL)
  })

  it('firma de la cadena: cambia con tipos, orden y decaimiento, no con parámetros', () => {
    const base = chainSignature([filter(), reverb()])
    expect(chainSignature([filter({ cutoff: 3000, amount: 0.2 }), reverb({ amount: 0.9 })])).toBe(base)
    expect(chainSignature([reverb(), filter()])).not.toBe(base)
    expect(chainSignature([filter(), reverb({ decay: 4 })])).not.toBe(base)
    expect(chainSignature([filter()])).not.toBe(base)
  })

  it('curva de distorsión: acotada, impar y más dura con más saturación', () => {
    const soft = distortionCurve(0)
    const hard = distortionCurve(1)
    expect(soft[0]).toBeCloseTo(-1)
    expect(soft.at(-1)).toBeCloseTo(1)
    expect(Math.abs(soft[300] - (300 * 2 / 1023 - 1))).toBeLessThan(1e-6) // drive 0 ≈ lineal
    expect(hard[600]).toBeGreaterThan(soft[600])
    for (const v of hard) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6)
    expect(hard[100]).toBeCloseTo(-hard[1023 - 100], 5)
  })

  it('distorsión: la ganancia de compensación evita un salto de volumen', () => {
    // small-signal gain of the curve × makeup stays moderate even at full drive
    const smallSignal = (drive) => (1 + 20 * drive) * distortionMakeup(drive)
    expect(smallSignal(0)).toBe(1)
    expect(smallSignal(1)).toBeLessThan(4)
    expect(distortionMakeup(1)).toBeLessThan(distortionMakeup(0.2))
    const ctx = new FakeAudioContext()
    createEffect(ctx, { id: 'x', type: 'distortion', drive: 1 })
    const shaper = ctx.nodes.find(n => n.kind === 'waveshaper')
    expect(shaper.connections[0].gain.value).toBeCloseTo(1 / 6)
  })

  it('respuesta al impulso: estéreo, del largo pedido, decae y queda en caché', () => {
    const ctx = new FakeAudioContext({ sampleRate: 8000 })
    const ir = getImpulseResponse(ctx, 2)
    expect(ir.numberOfChannels).toBe(2)
    expect(ir.length).toBe(16000)
    const energy = (data, from, to) => { let e = 0; for (let i = from; i < to; i++) e += data[i] * data[i]; return e }
    const L = ir.getChannelData(0)
    expect(energy(L, 14400, 16000)).toBeLessThan(energy(L, 0, 1600) / 100)
    expect(ir.getChannelData(0)[500]).not.toBe(ir.getChannelData(1)[500])
    expect(getImpulseResponse(ctx, 2.02)).toBe(ir) // redondeo a 0.1 s
    expect(getImpulseResponse(new FakeAudioContext({ sampleRate: 8000 }), 2).getChannelData(0)[700]).toBe(L[700]) // determinista
  })
})

describe('effects: nodos de audio', () => {
  it('cada efecto es una unidad seco/mojado con su procesador', () => {
    for (const [spec, kind] of [[reverb(), 'convolver'], [delay(), 'delay'], [filter(), 'biquad'], [{ id: 'x', type: 'distortion' }, 'waveshaper']]) {
      const ctx = new FakeAudioContext()
      const fx = createEffect(ctx, spec)
      const processor = ctx.nodes.find(n => n.kind === kind)
      expect(processor).toBeTruthy()
      expect(reachable(fx.input, processor)).toBe(true)
      expect(reachable(processor, fx.output)).toBe(true)
    }
  })

  it('delay con realimentación (lazo cerrado) y tiempos reales', () => {
    const ctx = new FakeAudioContext()
    createEffect(ctx, delay({ time: 0.3, feedback: 0.6 }))
    const d = ctx.nodes.find(n => n.kind === 'delay')
    expect(d.delayTime.value).toBe(0.3)
    expect(d.maxDelayTime).toBeGreaterThanOrEqual(1.5)
    const fb = ctx.nodes.find(n => n.kind === 'gain' && n.gain.value === 0.6)
    expect(fb).toBeTruthy()
    expect(reachable(fb, d)).toBe(true)
    expect(reachable(d, fb)).toBe(true)
  })

  it('cantidad = mezcla de potencia constante; update cambia en caliente sin recrear nodos', () => {
    const ctx = new FakeAudioContext()
    const fx = createEffect(ctx, filter({ amount: 0.5 }))
    const gains = ctx.nodes.filter(n => n.kind === 'gain')
    expect(gains.some(g => Math.abs(g.gain.value - Math.cos(Math.PI / 4)) < 1e-9)).toBe(true)
    const count = ctx.nodes.length
    ctx.currentTime = 1
    fx.update(filter({ amount: 1, cutoff: 2000 }))
    expect(ctx.nodes.length).toBe(count)
    const biquad = ctx.nodes.find(n => n.kind === 'biquad')
    expect(biquad.frequency.events.at(-1)).toEqual(['target', 2000, 1, 0.02])
  })

  it('cadena vacía = paso directo; cadena en el orden dado', () => {
    const ctx = new FakeAudioContext()
    const empty = createEffectChain(ctx, [])
    expect(empty.input.connections).toContain(empty.output)
    const chain = createEffectChain(ctx, [filter(), reverb()])
    const biquad = ctx.nodes.find(n => n.kind === 'biquad')
    const conv = ctx.nodes.find(n => n.kind === 'convolver')
    expect(reachable(chain.input, biquad)).toBe(true)
    expect(reachable(biquad, conv)).toBe(true)
    expect(reachable(conv, biquad)).toBe(false)
    expect(chain.tail()).toBe(2)
  })
})

describe('bus de pista: efectos, mute y cambios en caliente', () => {
  it('voces → volumen → efectos → paneo → mute → destino', () => {
    const ctx = new FakeAudioContext()
    const dest = ctx.createGain()
    const bus = createTrackBus(ctx, dest, { volume: 0.5, pan: 0.3, effects: [reverb()] })
    const conv = ctx.nodes.find(n => n.kind === 'convolver')
    const panner = ctx.nodes.find(n => n.kind === 'panner')
    expect(bus.input.gain.value).toBe(0.5)
    expect(reachable(bus.input, conv)).toBe(true)
    expect(reachable(conv, panner)).toBe(true)
    expect(reachable(panner, dest)).toBe(true)
    expect(bus.tail()).toBe(2)
  })

  it('cambiar parámetros no reconstruye; cambiar la estructura hace un fundido cruzado', () => {
    const ctx = new FakeAudioContext()
    const timers = later()
    const bus = createTrackBus(ctx, ctx.createGain(), { effects: [filter()], timers })
    const before = ctx.nodes.length
    bus.set({ effects: [filter({ cutoff: 5000 })] })
    expect(ctx.nodes.length).toBe(before)

    const oldChain = bus.chain
    ctx.currentTime = 2
    bus.set({ effects: [filter(), delay()] })
    expect(bus.chain).not.toBe(oldChain)
    expect(ctx.nodes.some(n => n.kind === 'delay')).toBe(true)
    // the new chain fades in, the old one fades out and is dropped later
    const fades = ctx.nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'linear'))
    expect(fades.map(f => f.gain.events.at(-1)[1]).sort()).toEqual([0, 1])
    expect(reachable(bus.input, oldChain.input)).toBe(true)
    expect(timers.queue).toHaveLength(1)
    timers.flush()
    expect(bus.input.connections).not.toContain(oldChain.input)
    expect(reachable(bus.input, bus.chain.input)).toBe(true)
  })

  it('mute en caliente con rampa corta', () => {
    const ctx = new FakeAudioContext()
    const dest = ctx.createGain()
    const bus = createTrackBus(ctx, dest, { audible: false })
    const mute = ctx.nodes.find(n => n.kind === 'gain' && n.connections.includes(dest))
    expect(mute.gain.value).toBe(0)
    ctx.currentTime = 1
    bus.set({ audible: true })
    expect(mute.gain.events.at(-1)).toEqual(['target', 1, 1, 0.015])
    expect(bus.audible).toBe(true)
  })
})

describe('mute / solo', () => {
  const t = (id, extra = {}) => ({ id, ...extra })

  it('reglas: solo gana; sin solo, suena lo que no está muteado', () => {
    const tracks = [t('a'), t('b', { mute: true }), t('c')]
    expect(hasSolo(tracks)).toBe(false)
    expect(tracks.map(x => isTrackAudible(x, tracks))).toEqual([true, false, true])
    const solo = [t('a', { solo: true }), t('b', { mute: true, solo: true }), t('c')]
    expect(solo.map(x => isTrackAudible(x, solo))).toEqual([true, true, false])
  })

  it('output.syncTracks aplica mute y solo a los buses', () => {
    const ctx = new FakeAudioContext()
    const out = createOutput(ctx)
    const a = { id: 'a', instrument: 'Bass', volume: 0.5, pan: 0 }
    const b = { id: 'b', instrument: 'Piano', volume: 0.5, pan: 0 }
    out.syncTracks([a, b])
    expect(out.bus('a').audible && out.bus('b').audible).toBe(true)
    out.syncTracks([{ ...a, solo: true }, b])
    expect(out.bus('a').audible).toBe(true)
    expect(out.bus('b').audible).toBe(false)
    out.syncTracks([a, { ...b, mute: true }])
    expect(out.bus('a').audible).toBe(true)
    expect(out.bus('b').audible).toBe(false)
    // a preview bus does not take part in the solo logic
    out.ensureTrack({ id: '__preview-Piano', volume: 1, pan: 0 })
    expect(out.bus('b').audible).toBe(false)
  })

  it('el motor aplica mute/solo/efectos en el acto mientras suena (sin esperar al compás)', async () => {
    const ctx = new FakeAudioContext()
    const timers = createFakeTimers()
    const engine = createEngine({ createContext: () => ctx, transportOptions: { timers } })
    const track = (id, extra = {}) => ({ ...buildTrackFromNotes({ id, instrument: 'Synth', length: 16, notes: [{ step: 0 }] }), ...extra })
    const score = { tempo: 120, stepsPerBeat: 4, tracks: [track('a'), track('b')] }
    await engine.play(score)
    ctx.currentTime = 0.3
    timers.fire()
    expect(ctx.nodes.filter(n => n.kind === 'panner')).toHaveLength(2) // one bus per track
    expect(ctx.nodes.some(n => n.kind === 'convolver')).toBe(false)
    engine.update({ ...score, tracks: [track('a'), track('b', { mute: true, effects: [reverb()] })] })
    // transport still has the old notes pending until the next bar, but the mix is live
    expect(ctx.nodes.some(n => n.kind === 'convolver')).toBe(true)
    const mutes = ctx.nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'target' && e[1] === 0 && e[3] === 0.015))
    expect(mutes).toHaveLength(1)
    engine.applyMix({ ...score, tracks: [track('a'), track('b')] })
    expect(mutes[0].gain.events.at(-1)[1]).toBe(1)
    engine.stop()
  })
})

describe('render con efectos, mute y stems', () => {
  const score = () => {
    const a = buildTrackFromNotes({ id: 'a', instrument: 'Piano', length: 16, notes: [{ step: 0 }, { step: 8 }] })
    const b = buildTrackFromNotes({ id: 'b', instrument: 'Bass', length: 12, notes: [{ step: 0 }, { step: 6 }] })
    return { tempo: 120, stepsPerBeat: 4, tracks: [a, b] }
  }
  const capture = () => {
    const made = []
    return { made, createContext: (ch, len, sr) => { const c = new FakeAudioContext({ channels: ch, length: len, sampleRate: sr }); made.push(c); return c } }
  }

  it('la cola de la reverb y del delay entra en la duración del WAV', () => {
    const dry = score()
    const wet = score()
    wet.tracks[0].effects = [reverb({ decay: 4 })]
    expect(renderTail(wet) - renderTail(dry)).toBeCloseTo(4, 5)
    wet.tracks[1].effects = [delay(), reverb({ decay: 1 })]
    const tailB = 0.3 + effectTail(delay()) + 1 // Bass release + delay + reverb
    expect(renderTail(wet)).toBeCloseTo(Math.max(0.8 + 4, tailB) + 0.25, 5)
    expect(renderDuration(wet).total).toBeCloseTo(2 + renderTail(wet), 5)
  })

  it('el WAV de la mezcla arma la misma cadena de efectos y deja afuera lo muteado', async () => {
    const s = score()
    s.tracks[0].effects = [filter(), reverb()]
    s.tracks[1].mute = true
    const { made, createContext } = capture()
    await renderScore(s, { sampleRate: 8000, createContext })
    const ctx = made[0]
    expect(ctx.nodes.filter(n => n.kind === 'convolver')).toHaveLength(1)
    expect(ctx.nodes.find(n => n.kind === 'convolver').buffer.length).toBe(16000)
    // Piano = 3 oscillators per note; the muted Bass adds none
    expect(ctx.nodes.filter(n => n.kind === 'oscillator')).toHaveLength(2 * 3)
    // the muted track's tail does not lengthen the file
    expect(ctx.length).toBe(Math.ceil(renderDuration(s).total * 8000))
  })

  it('stems: uno por pista, todos del largo de la mezcla, con sus efectos y sin mute', async () => {
    const s = score()
    s.tracks[1].effects = [reverb({ decay: 3 })]
    s.tracks[1].mute = true
    const { made, createContext } = capture()
    const stems = await renderStems(s, { sampleRate: 8000, createContext })
    expect(stems.map(x => x.track.id)).toEqual(['a', 'b'])
    expect(new Set(made.map(c => c.length)).size).toBe(1)
    const unmuted = { ...s, tracks: s.tracks.map(t => ({ ...t, mute: false })) }
    expect(made[0].length).toBe(Math.ceil(renderDuration(unmuted).total * 8000))
    expect(made[0].nodes.some(n => n.kind === 'convolver')).toBe(false)
    expect(made[1].nodes.some(n => n.kind === 'convolver')).toBe(true)
    // the 12-step track keeps cycling for the 16 steps of the mix: notes at 0, 6, 12
    const bassVoices = made[1].nodes.filter(n => n.kind === 'oscillator')
    const starts = [...new Set(bassVoices.map(o => o.startTime))]
    expect(starts).toHaveLength(3)
    expect(unrollScore({ ...s, tracks: [s.tracks[1]] }, { totalSteps: 16 }).map(e => e.step)).toEqual([0, 6, 12])
  })

  it('renderStemsWav devuelve un Blob WAV por pista', async () => {
    const stems = await renderStemsWav(score(), { sampleRate: 8000, createContext: capture().createContext })
    expect(stems).toHaveLength(2)
    expect(stems[0].blob.type).toBe('audio/wav')
  })
})

describe('mismo bus en vivo y offline', () => {
  it('createOutput arma los mismos nodos de efectos sobre cualquier contexto', () => {
    const track = { id: 't', instrument: 'Synth', volume: 0.7, pan: 0, effects: [{ id: 'x', type: 'distortion', drive: 0.8 }, filter(), delay(), reverb()] }
    const kinds = (ctx) => ctx.nodes.map(n => n.kind).sort().join(',')
    const live = new FakeAudioContext()
    const offline = new FakeAudioContext({ length: 100 })
    createOutput(live).syncTracks([track])
    createOutput(offline).syncTracks([track])
    expect(kinds(live)).toBe(kinds(offline))
    expect(kinds(live)).toMatch(/waveshaper/)
  })

  it('buildScore sigue sin efectos por defecto', () => {
    const s = buildScore({ tracks: [{ pattern: { algorithm: 'euclidean', density: 0.5 }, length: 8 }] })
    expect(s.tracks[0].effects).toBeUndefined()
    expect(renderTail(s)).toBeCloseTo(0.8 + 0.25)
    vi.restoreAllMocks()
  })
})
