/**
 * output.js — the audio graph a score plays into: master bus + one bus per
 * track + voice creation. The same object is used live (AudioContext) and for
 * the offline render (OfflineAudioContext).
 */

import { createMasterBus, createTrackBus } from './bus.js'
import { createVoice } from './voices.js'
import { hasSolo, isTrackAudible } from './score.js'

/**
 * @param {BaseAudioContext} ctx
 * @param {{ volume?: number, destination?: AudioNode, voiceFactory?: Function }} opts
 *   voiceFactory(ctx, destination, note) defaults to voices.createVoice.
 * @returns Output: {
 *   master,
 *   syncTracks(tracks),          // create/update track buses (volume, pan, effects,
 *                                //   mute/solo) — the whole mix, applied live
 *   ensureTrack(track),          // a bus outside the mix (preview) — no solo logic
 *   play(track, note) → voice,   // note: { midi, velocity, time (s), duration (s) }
 *   prune(now),                  // forget voices that already ended
 *   stopAll(when?),              // fast fade of every sounding voice
 *   setVolume(v), activeCount(), dispose()
 * }
 */
export function createOutput(ctx, { volume = 0.7, destination, voiceFactory = createVoice } = {}) {
  const master = createMasterBus(ctx, { volume, destination: destination || ctx.destination })
  const buses = new Map()
  const active = new Set()

  function busFor(track, audible = true) {
    let bus = buses.get(track.id)
    if (!bus) {
      bus = createTrackBus(ctx, master.input, {
        volume: track.volume, pan: track.pan, effects: track.effects || [], audible
      })
      buses.set(track.id, bus)
    }
    return bus
  }

  return {
    master,
    syncTracks(tracks = []) {
      const solo = hasSolo(tracks)
      for (const track of tracks) {
        const audible = isTrackAudible(track, solo)
        const existing = buses.get(track.id)
        if (existing) existing.set({ volume: track.volume, pan: track.pan, effects: track.effects || [], audible })
        else busFor(track, audible)
      }
    },
    ensureTrack(track) {
      const existing = buses.get(track.id)
      if (existing) existing.set({ volume: track.volume, pan: track.pan })
      return busFor(track)
    },
    /** The bus of a track id (or undefined). */
    bus(id) {
      return buses.get(id)
    },
    play(track, note) {
      const voice = voiceFactory(ctx, busFor(track).input, { instrument: track.instrument, ...note })
      active.add(voice)
      return voice
    },
    prune(now = ctx.currentTime) {
      for (const v of active) if (v.end < now) active.delete(v)
    },
    stopAll(when = ctx.currentTime) {
      for (const v of active) v.stop(when)
      active.clear()
    },
    setVolume(v) {
      master.setVolume(v)
    },
    activeCount() {
      return active.size
    },
    dispose() {
      this.stopAll()
      for (const bus of buses.values()) bus.disconnect()
      buses.clear()
      master.disconnect()
    }
  }
}
