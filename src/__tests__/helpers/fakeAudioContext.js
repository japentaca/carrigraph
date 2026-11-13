/**
 * Minimal fake of BaseAudioContext for tests (jsdom has no Web Audio).
 * Records created nodes, connections, starts/stops and param automation, and
 * throws where the real API would (e.g. exponential ramp to <= 0).
 */

class FakeParam {
  constructor(value = 0) {
    this.value = value
    this.events = []
  }
  setValueAtTime(v, t) { check(v, t); this.events.push(['set', v, t]); return this }
  linearRampToValueAtTime(v, t) { check(v, t); this.events.push(['linear', v, t]); return this }
  exponentialRampToValueAtTime(v, t) {
    check(v, t)
    if (!(v > 0)) throw new RangeError('exponentialRamp target must be > 0')
    this.events.push(['exp', v, t]); return this
  }
  setTargetAtTime(v, t, tc) {
    check(v, t)
    if (!(tc > 0)) throw new RangeError('timeConstant must be > 0')
    this.events.push(['target', v, t, tc]); return this
  }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this }
  cancelAndHoldAtTime(t) { this.events.push(['cancelHold', t]); return this }
}

function check(v, t) {
  if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new TypeError(`bad automation value=${v} time=${t}`)
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx
    this.kind = kind
    this.connections = []
    ctx.nodes.push(this)
  }
  connect(node) { this.connections.push(node); return node }
  disconnect(node) { this.connections = node ? this.connections.filter(c => c !== node) : [] }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind)
    this.startTime = null
    this.stopTimes = []
  }
  start(t = 0) {
    if (this.startTime != null) throw new Error('start() called twice')
    this.startTime = t
  }
  stop(t = 0) {
    if (this.startTime == null) throw new Error('stop() before start()')
    this.stopTimes.push(t)
  }
}

export class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.duration = length / sampleRate
    this._data = Array.from({ length: channels }, () => new Float32Array(length))
  }
  getChannelData(i) { return this._data[i] }
}

export class FakeAudioContext {
  constructor({ sampleRate = 8000, channels = 2, length = 0 } = {}) {
    this.sampleRate = sampleRate
    this.currentTime = 0
    this.state = 'running'
    this.nodes = []
    this.channels = channels
    this.length = length
    this.destination = new FakeNode(this, 'destination')
  }
  async resume() { this.state = 'running' }
  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(1); return n }
  createOscillator() {
    const n = new FakeSource(this, 'oscillator')
    n.type = 'sine'; n.frequency = new FakeParam(440); n.detune = new FakeParam(0)
    return n
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad')
    n.type = 'lowpass'; n.frequency = new FakeParam(350); n.Q = new FakeParam(1)
    return n
  }
  createBufferSource() {
    const n = new FakeSource(this, 'bufferSource')
    n.buffer = null; n.loop = false; n.playbackRate = new FakeParam(1)
    return n
  }
  createBuffer(channels, length, sampleRate) { return new FakeBuffer(channels, length, sampleRate) }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor')
    for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = new FakeParam(0)
    return n
  }
  createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(0); return n }
  createDelay(maxDelayTime = 1) {
    const n = new FakeNode(this, 'delay')
    n.maxDelayTime = maxDelayTime
    n.delayTime = new FakeParam(0)
    return n
  }
  createConvolver() { const n = new FakeNode(this, 'convolver'); n.buffer = null; n.normalize = true; return n }
  createAnalyser() {
    const n = new FakeNode(this, 'analyser')
    n.fftSize = 2048
    // Tests set `n.signal` (a number or a function i → sample) to simulate audio.
    n.signal = 0
    n.getFloatTimeDomainData = (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = typeof n.signal === 'function' ? n.signal(i) : n.signal
    }
    return n
  }
  createWaveShaper() { const n = new FakeNode(this, 'waveshaper'); n.curve = null; n.oversample = 'none'; return n }
  async startRendering() {
    const buf = new FakeBuffer(this.channels, this.length, this.sampleRate)
    // A recognisable signal so encoders can be checked.
    buf.getChannelData(0).fill(0.5)
    if (this.channels > 1) buf.getChannelData(1).fill(-0.5)
    return buf
  }
  sources() { return this.nodes.filter(n => n instanceof FakeSource) }
}

/** Fake timers for the transport: call `fire()` to run the interval callback. */
export function createFakeTimers() {
  const timers = {
    fn: null,
    ms: null,
    cleared: 0,
    setInterval(fn, ms) { timers.fn = fn; timers.ms = ms; return 1 },
    clearInterval() { timers.fn = null; timers.cleared++ },
    fire() { timers.fn?.() }
  }
  return timers
}
