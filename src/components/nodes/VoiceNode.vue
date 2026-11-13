<template>
  <BaseNode type="voice" :data="data">
    <div class="cg-field">
      <label class="cg-label">Instrumento</label>
      <select class="cg-select nodrag" :value="data.instrument" @change="update({ instrument: $event.target.value })">
        <option v-for="instrument in instruments" :key="instrument.name" :value="instrument.name">
          {{ instrument.icon }} {{ instrument.name }}
        </option>
      </select>
      <p class="cg-hint voice-desc">{{ currentInstrument.description }}</p>
    </div>

    <div class="cg-field">
      <label class="cg-label">Volumen</label>
      <div class="cg-control">
        <input
          type="range" min="0" max="1" step="0.05" class="cg-range nodrag"
          :value="volume"
          @input="update({ volume: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ Math.round(volume * 100) }}%</span>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Paneo</label>
      <div class="cg-control">
        <input
          type="range" min="-1" max="1" step="0.1" class="cg-range nodrag"
          :value="pan"
          @input="update({ pan: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ formatPan(pan) }}</span>
      </div>
    </div>

    <!-- Drums: which piece plays the pattern -->
    <div v-if="isDrums" class="cg-field">
      <label class="cg-label">Pieza</label>
      <select class="cg-select nodrag" :value="data.drumPiece || 'auto'" @change="update({ drumPiece: $event.target.value })">
        <option v-for="p in drumPieces" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
    </div>

    <!-- Fallback melody (pitched instruments): used only when the notes
         that reach this voice have no pitch, i.e. no Scale / Melody node
         before it (and in compatibility mode). Fase 3A. -->
    <details v-else class="cg-field fallback-melody">
      <summary class="fallback-melody__summary">Melodía por defecto (sin nodo Escala)</summary>
      <p class="cg-hint">Se usa cuando no hay un nodo Escala / Melodía antes de esta voz.</p>
      <div class="cg-field">
        <label class="cg-label">Octava</label>
        <div class="cg-buttons">
          <button
            v-for="octave in octaveRange" :key="octave"
            class="cg-btn nodrag" :class="{ active: (data.octave || 4) === octave }"
            @click="update({ octave })"
          >{{ octave }}</button>
        </div>
      </div>

      <div class="cg-field">
        <label class="cg-label">Melodía</label>
        <select class="cg-select nodrag" :value="data.melodyMode || 'ascending'" @change="update({ melodyMode: $event.target.value })">
          <option v-for="m in melodyModes" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </div>

      <div class="cg-field cg-row">
        <div class="cg-col">
          <label class="cg-label">Tónica</label>
          <select class="cg-select nodrag" :value="data.root || 'C'" @change="update({ root: $event.target.value })">
            <option v-for="n in noteNames" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <div class="cg-col">
          <label class="cg-label">Escala</label>
          <select class="cg-select nodrag" :value="data.scale || 'pentatonic'" @change="update({ scale: $event.target.value })">
            <option v-for="sc in scales" :key="sc.value" :value="sc.value">{{ sc.label }}</option>
          </select>
        </div>
      </div>

      <div v-if="(data.melodyMode || 'ascending') !== 'fixed'" class="cg-field">
        <label class="cg-label">Rango (octavas)</label>
        <div class="cg-buttons">
          <button
            v-for="r in rangeOptions" :key="r"
            class="cg-btn nodrag" :class="{ active: (data.range ?? 2) === r }"
            @click="update({ range: r })"
          >{{ r }}</button>
        </div>
      </div>
    </details>

    <p class="cg-hint fx-hint">Para efectos (filtro, delay, reverb, distorsión) conectá un nodo Efectos entre esta voz y la Salida.</p>

    <button class="cg-btn nodrag test-btn" :disabled="isTesting" @click="playTestNote">
      {{ isTesting ? '🔊 Sonando…' : '🎵 Probar sonido' }}
    </button>
  </BaseNode>
</template>

<script setup>
import { ref, computed } from 'vue'
import BaseNode from './BaseNode.vue'
import { useAudioStore } from '../../stores/useAudioStore'
import { NOTE_NAMES, DRUM_NOTES, buildMelody } from '../../audio/engine/score.js'

const props = defineProps({
  data: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update'])
const audioStore = useAudioStore()
const isTesting = ref(false)

const instruments = [
  { name: 'Piano', icon: '🎹', description: 'Piano: ataque percusivo y cuerdas que decaen' },
  { name: 'Synth', icon: '🎛️', description: 'Sintetizador: dos sierras desafinadas con filtro' },
  { name: 'Guitar', icon: '🎸', description: 'Guitarra: cuerda pulsada (Karplus-Strong)' },
  { name: 'Drums', icon: '🥁', description: 'Batería: bombo, redoblante y hi-hat sintetizados' },
  { name: 'Bass', icon: '🎸', description: 'Bajo: sierra + subgrave con filtro resonante' }
]

const melodyModes = [
  { value: 'fixed', label: 'Nota fija' },
  { value: 'ascending', label: 'Ascendente' },
  { value: 'arpeggio', label: 'Arpegio' },
  { value: 'random', label: 'Caminata aleatoria' }
]

const scales = [
  { value: 'major', label: 'Mayor' },
  { value: 'minor', label: 'Menor' },
  { value: 'pentatonic', label: 'Pentatónica mayor' },
  { value: 'pentatonicMinor', label: 'Pentatónica menor' },
  { value: 'dorian', label: 'Dórica' },
  { value: 'phrygian', label: 'Frigia' },
  { value: 'blues', label: 'Blues' },
  { value: 'chromatic', label: 'Cromática' }
]

const drumPieces = [
  { value: 'auto', label: 'Kit automático' },
  { value: 'kick', label: 'Bombo' },
  { value: 'snare', label: 'Redoblante' },
  { value: 'hihat', label: 'Hi-hat cerrado' },
  { value: 'openhat', label: 'Hi-hat abierto' }
]

const noteNames = NOTE_NAMES
const octaveRange = [1, 2, 3, 4, 5, 6, 7]
const rangeOptions = [1, 2, 3, 4]

const isDrums = computed(() => props.data.instrument === 'Drums')
const volume = computed(() => props.data.volume ?? 0.7)
const pan = computed(() => props.data.pan ?? 0)

const currentInstrument = computed(() => {
  return instruments.find(inst => inst.name === props.data.instrument) || instruments[0]
})

const update = (changes) => {
  emit('update', { ...props.data, ...changes })
}

const formatPan = (panValue) => {
  if (panValue === 0) return 'Centro'
  if (panValue < 0) return `I${Math.abs(Math.round(panValue * 100))}`
  return `D${Math.round(panValue * 100)}`
}

const playTestNote = async () => {
  if (isTesting.value) return
  isTesting.value = true
  try {
    let midi
    if (isDrums.value) {
      const piece = props.data.drumPiece && props.data.drumPiece !== 'auto' ? props.data.drumPiece : 'kick'
      midi = DRUM_NOTES[piece]
    } else {
      // Root of the configured scale/octave (same math as the score)
      midi = buildMelody(1, {
        mode: 'fixed',
        root: props.data.root || 'C',
        scale: props.data.scale || 'pentatonic',
        octave: props.data.octave || 4
      })[0]
    }
    await audioStore.previewNote({
      instrument: props.data.instrument || 'Piano',
      midi,
      velocity: 0.85,
      duration: 0.8,
      volume: volume.value,
      pan: pan.value
    })
  } catch (error) {
    console.error('Failed to play test note:', error)
  } finally {
    setTimeout(() => { isTesting.value = false }, 800)
  }
}
</script>

<style scoped>
.voice-desc { margin-top: 0.3rem; }
.fallback-melody {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.4rem 0.5rem;
}
.fallback-melody__summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 500;
}
.fallback-melody[open] .fallback-melody__summary { margin-bottom: 0.4rem; }
.fx-hint { margin-bottom: 0.5rem; }
.test-btn { width: 100%; padding: 0.4rem; }
</style>
