/**
 * transport.js — lookahead scheduler over the audio clock.
 *
 * Classic "two clocks" design: a JS timer (every `interval` ms) schedules
 * every step whose start falls inside [now, now + lookahead] using exact
 * audio-clock times. The current step is derived from the audio clock, not
 * from the timer.
 *
 * Everything is injected (clock, timers, output) so it can be tested without
 * an AudioContext.
 */

import { eventsAtStep, scoreLength, stepDuration, STEPS_PER_BAR } from './score.js'

/**
 * @param {object} opts
 * @param {{ currentTime: number }} [opts.context]  used by the default clock
 * @param {object} opts.output       { play(track, note), stopAll(when), syncTracks?(tracks), prune?(now) }
 * @param {() => number} [opts.clock]               seconds, defaults to context.currentTime
 * @param {{ setInterval: Function, clearInterval: Function }} [opts.timers]
 * @param {number} [opts.lookahead=0.1]  seconds scheduled ahead
 * @param {number} [opts.interval=25]    timer period, ms
 * @param {number} [opts.startDelay=0.05] seconds between start() and the first step
 * @param {number} [opts.stepsPerBar=16] hot changes are applied on bar boundaries
 * @param {(state: 'playing'|'stopped') => void} [opts.onStateChange]
 * @param {() => void} [opts.onEnd]      called when a one-shot pass finishes by itself
 */
export function createTransport({
  context,
  output,
  clock = () => context.currentTime,
  timers = {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id)
  },
  lookahead = 0.1,
  interval = 25,
  startDelay = 0.05,
  stepsPerBar = STEPS_PER_BAR,
  onStateChange,
  onEnd
} = {}) {
  let score = null
  let tempo = 120
  let loop = true
  let playing = false
  let timerId = null

  let nextStep = 0
  let nextTime = 0
  let endStep = Infinity
  let endTime = null
  let pendingScore = null
  let pendingTempo = null
  /** Scheduled step starts: [{ step, time }] (only the recent ones are kept). */
  let queue = []

  const setState = (next) => {
    if (playing === next) return
    playing = next
    onStateChange?.(next ? 'playing' : 'stopped')
  }

  function passEnd(fromStep) {
    const total = Math.max(1, scoreLength(score))
    return Math.max(total, Math.ceil(fromStep / total) * total)
  }

  function applyPending() {
    if (pendingScore) {
      score = pendingScore
      tempo = score.tempo
      pendingScore = null
      output.syncTracks?.(score.tracks)
      if (!loop) endStep = passEnd(nextStep)
    }
    if (pendingTempo != null) {
      tempo = pendingTempo
      pendingTempo = null
    }
  }

  function scheduleStep(step, time) {
    const sd = stepDuration(tempo, score.stepsPerBeat)
    for (const track of score.tracks) {
      for (const ev of eventsAtStep(track, step)) {
        output.play(track, {
          midi: ev.midi,
          velocity: ev.velocity,
          time: time + (ev.time - ev.step) * sd,
          duration: ev.duration * sd,
          step
        })
      }
    }
  }

  function finish() {
    if (timerId != null) timers.clearInterval(timerId)
    timerId = null
    queue = []
    endTime = null
    setState(false)
    onEnd?.()
  }

  /** One scheduling pass. Called by the timer; exposed for tests. */
  function tick() {
    if (!playing) return
    const now = clock()
    if (endTime != null && now >= endTime) {
      finish()
      return
    }
    while (nextStep < endStep && nextTime < now + lookahead) {
      if (nextStep % stepsPerBar === 0) applyPending()
      if (nextStep >= endStep) break
      scheduleStep(nextStep, nextTime)
      queue.push({ step: nextStep, time: nextTime })
      nextTime += stepDuration(tempo, score.stepsPerBeat)
      nextStep++
    }
    if (nextStep >= endStep && endTime == null) endTime = nextTime
    // Keep only the last started step and the future ones.
    let firstKeep = 0
    for (let i = 0; i < queue.length; i++) if (queue[i].time <= now) firstKeep = i
    if (firstKeep > 0) queue = queue.slice(firstKeep)
    output.prune?.(now)
  }

  const api = {
    /**
     * Start from step 0. `score` and `loop` are optional (keep current).
     * Returns false when there is nothing to play.
     */
    start({ score: s, loop: l } = {}) {
      if (s) { score = s; pendingScore = null }
      if (l != null) loop = !!l
      if (!score || scoreLength(score) === 0) return false
      api.stop()
      tempo = pendingTempo ?? score.tempo
      pendingTempo = null
      output.syncTracks?.(score.tracks)
      nextStep = 0
      nextTime = clock() + startDelay
      endStep = loop ? Infinity : scoreLength(score)
      endTime = null
      queue = []
      setState(true)
      tick()
      timerId = timers.setInterval(tick, interval)
      return true
    },

    /** Stop now: cancels scheduling and fades out what is sounding. */
    stop() {
      if (timerId != null) timers.clearInterval(timerId)
      timerId = null
      if (playing) output.stopAll(clock())
      queue = []
      endTime = null
      setState(false)
    },

    /**
     * Replace the score. While playing it is applied at the next bar
     * boundary (no cut); when stopped (or `immediate`) right away.
     */
    setScore(s, { immediate = false } = {}) {
      if (!s) return
      if (!playing) { score = s; tempo = s.tempo; pendingScore = null; return }
      if (immediate) { pendingScore = s; applyPending(); return }
      pendingScore = s
    },

    /** Change tempo; while playing, applied at the next bar boundary. */
    setTempo(bpm) {
      const value = Number(bpm)
      if (!Number.isFinite(value) || value <= 0) return
      if (score && !playing) { score = { ...score, tempo: value } }
      if (!playing) { tempo = value; pendingTempo = null; return }
      pendingTempo = value
      if (pendingScore) pendingScore = { ...pendingScore, tempo: value }
    },

    /** true = loop forever; false = finish at the end of the current pass. */
    setLoop(value) {
      loop = !!value
      if (!playing) return
      if (loop) { endStep = Infinity; endTime = null } else { endStep = passEnd(nextStep) }
    },

    /** Position derived from the audio clock, or null when stopped. */
    getPosition() {
      if (!playing || !score) return null
      const now = clock()
      let current = null
      for (const entry of queue) {
        if (entry.time <= now) current = entry
        else break
      }
      if (!current) return { step: -1, time: now, trackSteps: {} }
      const trackSteps = {}
      for (const t of score.tracks) trackSteps[t.id] = t.length ? current.step % t.length : 0
      return { step: current.step, time: now, trackSteps }
    },

    /** Step of a track (default: first track) under the playhead, -1 if none. */
    getCurrentStep(trackId) {
      const pos = api.getPosition()
      if (!pos || pos.step < 0) return -1
      const id = trackId ?? score.tracks[0]?.id
      return pos.trackSteps[id] ?? -1
    },

    tick,
    isPlaying: () => playing,
    getState: () => (playing ? 'playing' : 'stopped'),
    getScore: () => pendingScore || score,
    getTempo: () => pendingTempo ?? tempo,
    getLoop: () => loop
  }
  return api
}
