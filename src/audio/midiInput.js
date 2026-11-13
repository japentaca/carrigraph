/**
 * midiInput.js — Web MIDI input (Fase 5B). No Vue; the browser API is
 * injectable so the message logic is tested with simulated messages.
 *
 *  - parseMidiMessage(bytes): raw MIDI bytes → { type, channel, … }
 *  - controlToRange(value, { min, max, step }): CC 0..127 → a control's value
 *  - createMidiInput({ requestAccess, onMessage }): asks for access, listens
 *    to every input (and to devices plugged in later), degrades without
 *    errors when there is no Web MIDI or the user denies permission.
 */

/**
 * @param {ArrayLike<number>} data  MIDIMessageEvent.data
 * @returns {{ type: 'noteon'|'noteoff'|'cc'|'pitchbend'|'other', channel?: number,
 *             note?: number, velocity?: number, controller?: number, value?: number }}
 *   channel 1..16; velocity and value 0..127 (pitch bend: -8192..8191)
 */
export function parseMidiMessage(data) {
  if (!data || data.length < 1) return { type: 'other' }
  const status = data[0] & 0xff
  if (status < 0x80 || status >= 0xf0) return { type: 'other' }
  const kind = status & 0xf0
  const channel = (status & 0x0f) + 1
  const d1 = (data[1] ?? 0) & 0x7f
  const d2 = (data[2] ?? 0) & 0x7f
  switch (kind) {
    case 0x90:
      // Note on with velocity 0 is a note off (running-status keyboards).
      return d2 === 0 ? { type: 'noteoff', channel, note: d1, velocity: 0 } : { type: 'noteon', channel, note: d1, velocity: d2 }
    case 0x80:
      return { type: 'noteoff', channel, note: d1, velocity: d2 }
    case 0xb0:
      return { type: 'cc', channel, controller: d1, value: d2 }
    case 0xe0:
      return { type: 'pitchbend', channel, value: ((d2 << 7) | d1) - 8192 }
    default:
      return { type: 'other', channel }
  }
}

/** Note velocity 0..127 → 0..1 (with a floor so soft keys are still heard). */
export function velocityToGain(velocity) {
  const v = Math.min(127, Math.max(0, Number(velocity) || 0))
  return v === 0 ? 0 : Math.round((0.15 + 0.85 * (v / 127)) * 1000) / 1000
}

/**
 * Value of a slider / number input for a controller position 0..127, inside
 * its min..max and snapped to its step ("any" or missing = no snapping).
 */
export function controlToRange(value, { min = 0, max = 1, step } = {}) {
  const lo = Number(min)
  const hi = Number(max)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return Number.isFinite(lo) ? lo : 0
  const t = Math.min(127, Math.max(0, Number(value) || 0)) / 127
  let v = lo + t * (hi - lo)
  const s = Number(step)
  if (Number.isFinite(s) && s > 0) {
    v = lo + Math.round((v - lo) / s) * s
    const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0
    v = Number(v.toFixed(dec))
  }
  return Math.min(hi, Math.max(lo, v))
}

/** Is Web MIDI available in this environment? */
export function midiSupported(nav = globalThis.navigator) {
  return !!nav && typeof nav.requestMIDIAccess === 'function'
}

/**
 * @param {object} opts
 * @param {() => Promise<MIDIAccess>} [opts.requestAccess]  default: navigator.requestMIDIAccess
 * @param {(msg: object, input: { id, name }) => void} opts.onMessage  parsed messages (not 'other')
 * @param {(inputs: { id, name }[]) => void} [opts.onDevicesChange]
 */
export function createMidiInput({ requestAccess, onMessage, onDevicesChange } = {}) {
  const request = requestAccess || (midiSupported() ? () => globalThis.navigator.requestMIDIAccess({ sysex: false }) : null)
  let access = null
  let enabled = false
  const attached = new Map() // input id → input

  const listInputs = () => (access ? [...access.inputs.values()] : [])
  const describe = (input) => ({ id: input.id, name: input.name || input.manufacturer || 'Dispositivo MIDI' })

  function handle(input) {
    return (event) => {
      if (!enabled) return
      const msg = parseMidiMessage(event?.data)
      if (msg.type !== 'other') onMessage?.(msg, describe(input))
    }
  }

  function attachAll() {
    for (const input of listInputs()) {
      if (attached.has(input.id)) continue
      input.onmidimessage = handle(input)
      attached.set(input.id, input)
    }
    for (const [id, input] of attached) {
      if (!listInputs().includes(input)) {
        input.onmidimessage = null
        attached.delete(id)
      }
    }
    onDevicesChange?.(listInputs().map(describe))
  }

  return {
    get supported() { return !!request },
    get enabled() { return enabled },
    inputs() { return listInputs().map(describe) },

    /**
     * Ask for access and start listening.
     * @returns {Promise<{ ok: boolean, error?: 'unsupported'|'denied', inputs?: { id, name }[] }>}
     */
    async enable() {
      if (!request) return { ok: false, error: 'unsupported' }
      try {
        access = access || await request()
      } catch {
        return { ok: false, error: 'denied' }
      }
      enabled = true
      attachAll()
      access.onstatechange = () => { if (enabled) attachAll() }
      return { ok: true, inputs: listInputs().map(describe) }
    },

    /** Stop listening (keeps the access object for a later enable). */
    disable() {
      enabled = false
      for (const input of attached.values()) input.onmidimessage = null
      attached.clear()
      if (access) access.onstatechange = null
    }
  }
}
