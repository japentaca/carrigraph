/**
 * useMidiInput — play and control the editor from a MIDI device (Fase 5B).
 *
 *  - Keys (note on) play the selected voice: the Voz node selected in the
 *    canvas/inspector, or the first voice of the graph when none is.
 *    Notes have a fixed length (note off is not used: preview voices are
 *    one-shots). Drums pick the piece from the note number.
 *  - Any controller (CC) moves the focused control: the slider or number
 *    field that has the keyboard focus (click a parameter in the inspector or
 *    in an expanded node, then turn a knob). Writing goes through the
 *    control's own input event, so it is the same as dragging it (undo
 *    grouping, live update, autosave).
 *  - Without Web MIDI, or when permission is denied, it says so and does
 *    nothing else.
 */

import { ref, computed, onUnmounted } from 'vue'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { createMidiInput, controlToRange, velocityToGain } from '../audio/midiInput.js'

const NOTE_SECONDS = 0.5

/** The control a CC should move: a focused range/number input, or the last one focused. */
export function controlTarget(active, last) {
  const ok = (el) => el && el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'number') && !el.disabled && el.isConnected !== false
  if (ok(active)) return active
  return ok(last) ? last : null
}

/** Set an input from a CC value through its own events (like a user would). */
export function applyControlChange(input, ccValue) {
  if (!input) return null
  const min = input.min === '' ? 0 : Number(input.min)
  const max = input.max === '' ? 127 : Number(input.max)
  const step = input.step && input.step !== 'any' ? input.step : undefined
  const value = controlToRange(ccValue, { min, max, step })
  if (String(value) === input.value) return value
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return value
}

/**
 * @param {object} opts
 * @param {() => object|null} opts.getVoiceNode  the Voz node notes should play
 * @param {() => Promise<MIDIAccess>} [opts.requestAccess]  (tests)
 */
export function useMidiInput({ getVoiceNode, requestAccess } = {}) {
  const audioStore = useAudioStore()
  const toastStore = useToastStore()
  const enabled = ref(false)
  const devices = ref([])
  const lastEvent = ref('')
  let lastControl = null

  const onFocusIn = (e) => {
    const el = e.target
    if (el?.tagName === 'INPUT' && (el.type === 'range' || el.type === 'number')) lastControl = el
  }

  function playNote(msg) {
    const voice = getVoiceNode?.()
    const data = voice?.data || {}
    audioStore.previewNote({
      instrument: data.instrument || 'Piano',
      midi: msg.note,
      velocity: velocityToGain(msg.velocity),
      duration: NOTE_SECONDS,
      volume: Number.isFinite(data.volume) ? data.volume : 0.8,
      pan: Number.isFinite(data.pan) ? data.pan : 0
    }).catch(() => {})
  }

  function onMessage(msg) {
    if (msg.type === 'noteon') {
      playNote(msg)
      lastEvent.value = `Nota ${msg.note} · vel ${msg.velocity}`
    } else if (msg.type === 'cc') {
      const target = controlTarget(typeof document !== 'undefined' ? document.activeElement : null, lastControl)
      const value = applyControlChange(target, msg.value)
      lastEvent.value = target ? `CC ${msg.controller} → ${target.getAttribute('aria-label') || target.title || 'control'}: ${value}` : `CC ${msg.controller} (sin control enfocado)`
    }
  }

  const midi = createMidiInput({
    requestAccess,
    onMessage,
    onDevicesChange: (list) => { devices.value = list }
  })
  const supported = computed(() => midi.supported)

  async function enable() {
    const result = await midi.enable()
    if (!result.ok) {
      toastStore.warning(result.error === 'unsupported'
        ? 'Este navegador no tiene Web MIDI (probá con Chrome o Edge).'
        : 'No se dio permiso para usar MIDI.')
      return false
    }
    enabled.value = true
    if (typeof document !== 'undefined') document.addEventListener('focusin', onFocusIn)
    toastStore.info(result.inputs.length
      ? `MIDI activo: ${result.inputs.map(i => i.name).join(', ')}`
      : 'MIDI activo, sin dispositivos conectados todavía')
    return true
  }

  function disable() {
    midi.disable()
    enabled.value = false
    if (typeof document !== 'undefined') document.removeEventListener('focusin', onFocusIn)
  }

  function toggle() {
    return enabled.value ? (disable(), false) : enable()
  }

  onUnmounted(disable)

  return { supported, enabled, devices, lastEvent, enable, disable, toggle, onMessage }
}
