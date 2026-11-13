<template>
  <div class="transport" role="toolbar" aria-label="Transporte">
    <button
      class="transport__play"
      :class="{ 'transport__play--on': t.isPlaying.value }"
      :disabled="!t.isPlaying.value && !t.canPlay.value"
      :title="t.isPlaying.value ? 'Detener (Espacio)' : (t.canPlay.value ? 'Reproducir (Espacio)' : 'Conectá Patrón → Voz (→ Salida) para reproducir')"
      @click="t.togglePlay()"
    >
      {{ t.isPlaying.value ? '⏹ Stop' : '▶ Play' }}
    </button>

    <button
      class="transport__toggle"
      :class="{ 'transport__toggle--on': t.loop.value }"
      :aria-pressed="t.loop.value"
      title="Repetir en loop (si está apagado, suena una pasada y se detiene)"
      @click="t.setLoop(!t.loop.value)"
    >
      🔁 Loop
    </button>

    <div class="transport__position" title="Posición: compás . tiempo . semicorchea">
      <span class="transport__pos-value">{{ t.position.value?.label ?? '–.–.–' }}</span>
      <span v-if="t.cycleBars.value" class="transport__pos-cycle">ciclo {{ t.cycleBars.value }} {{ t.cycleBars.value === 1 ? 'compás' : 'compases' }}</span>
    </div>

    <span v-if="readonly" class="transport__field" title="Tempo del proyecto">
      <span class="transport__label">Tempo</span>
      <span class="transport__value">{{ t.tempo.value }} BPM</span>
    </span>
    <span v-if="readonly && t.swing.value > 0" class="transport__field" title="Swing del proyecto">
      <span class="transport__label">Swing</span>
      <span class="transport__value">{{ Math.round(t.swing.value * 100) }}%</span>
    </span>

    <label v-if="!readonly" class="transport__field" title="Tempo (60–200 BPM)">
      <span class="transport__label">Tempo</span>
      <input
        class="transport__number"
        type="number" min="60" max="200" step="1"
        :value="t.tempo.value"
        @change="onTempo($event)"
      />
      <span class="transport__unit">BPM</span>
    </label>
    <button v-if="!readonly" class="transport__tap" title="Tap tempo: tocá varias veces al ritmo" @click="t.tap()">Tap</button>

    <label v-if="!readonly" class="transport__field" title="Swing global: atrasa las semicorcheas a contratiempo (se suma al Groove de cada pista)">
      <span class="transport__label">Swing</span>
      <input
        class="transport__range"
        type="range" min="0" max="1" step="0.01"
        :value="t.swing.value"
        @input="t.setSwing(parseFloat($event.target.value))"
      />
      <span class="transport__value">{{ Math.round(t.swing.value * 100) }}%</span>
    </label>

    <label class="transport__field" title="Volumen maestro">
      <span class="transport__label">Vol</span>
      <input
        class="transport__range"
        type="range" min="0" max="1" step="0.01"
        :value="t.volume.value"
        @input="t.setVolume(parseFloat($event.target.value))"
      />
      <span class="transport__value">{{ Math.round(t.volume.value * 100) }}%</span>
    </label>

    <LevelMeter class="transport__meter" />
    <Oscilloscope class="transport__scope" />

    <!-- Editor only (Fase 5B): live recording, performance mode, MIDI input -->
    <template v-if="!readonly">
      <button
        class="transport__rec"
        :class="{ 'transport__rec--on': rec.isRecording.value }"
        :aria-pressed="rec.isRecording.value"
        :disabled="!rec.supported.value"
        :title="!rec.supported.value ? 'Este navegador no permite grabar (falta MediaRecorder)' : (rec.isRecording.value ? 'Detener y descargar la grabación' : 'Grabar lo que suena (incluye los cambios en vivo) y descargarlo')"
        @click="rec.toggle()"
      >
        <span class="transport__rec-dot" aria-hidden="true">●</span>
        {{ rec.isRecording.value ? rec.elapsedLabel.value : 'Grabar' }}
      </button>
      <button
        v-if="performance !== null"
        class="transport__toggle"
        :class="{ 'transport__toggle--on': performance }"
        :aria-pressed="performance"
        title="Modo performance: mute/solo grandes, variaciones y macros"
        @click="emit('toggle-performance')"
      >🎛 Performance</button>
      <button
        v-if="midi"
        class="transport__toggle"
        :class="{ 'transport__toggle--on': midi.enabled.value }"
        :aria-pressed="midi.enabled.value"
        :disabled="!midi.supported.value"
        :title="midiTitle"
        @click="midi.toggle()"
      >🎹 MIDI</button>
    </template>
  </div>
</template>

<script setup>
/**
 * Fixed transport bar (Fase 4A): play/stop, loop, position, tempo with tap,
 * global swing, master volume and output level. These controls exist only
 * here (they used to be in the sidebar, the toolbar and the piano roll).
 */
import { computed } from 'vue'
import { useTransport } from '../../composables/useTransport.js'
import { useRecording } from '../../composables/useRecording.js'
import { useProjectStore } from '../../stores/useProjectStore'
import LevelMeter from './LevelMeter.vue'
import Oscilloscope from './Oscilloscope.vue'

const props = defineProps({
  /**
   * Transport to drive (same shape as useTransport()). Default: the editor's.
   * The shared/gallery player passes its own (Fase 5A).
   */
  transport: { type: Object, default: null },
  /** Read-only player: tempo and swing are shown, not edited. */
  readonly: { type: Boolean, default: false },
  /** Performance panel open (null: no button). */
  performance: { type: Boolean, default: null },
  /** useMidiInput() of the editor (null: no button). */
  midi: { type: Object, default: null }
})
const emit = defineEmits(['toggle-performance'])

const t = props.transport || useTransport()

// Recording only exists in the editor (props are fixed per mount).
const rec = props.readonly
  ? null
  : (() => {
      const projectStore = useProjectStore()
      return useRecording({ name: () => projectStore.currentProject?.name })
    })()

const midiTitle = computed(() => {
  const m = props.midi
  if (!m) return ''
  if (!m.supported.value) return 'Este navegador no tiene Web MIDI'
  if (!m.enabled.value) return 'Usar un teclado/controlador MIDI: las teclas tocan la voz seleccionada; una perilla mueve el control enfocado'
  const names = m.devices.value.map(d => d.name).join(', ')
  return `MIDI activo${names ? `: ${names}` : ' (sin dispositivos)'}${m.lastEvent.value ? ` · último: ${m.lastEvent.value}` : ''}. Clic para apagar.`
})

function onTempo(event) {
  const value = parseInt(event.target.value)
  if (Number.isFinite(value)) t.setTempo(value)
  event.target.value = t.tempo.value
}
</script>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  padding: 0.4rem 1rem;
  background: var(--background-dark);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.transport button {
  border: 1px solid var(--border-color);
  background: var(--background-light);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.transport button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.transport__play {
  min-width: 5.5rem;
  font-weight: 600;
  background: var(--primary-color) !important;
  border-color: var(--primary-color) !important;
  color: #fff !important;
}

.transport__play--on {
  background: var(--danger-color) !important;
  border-color: var(--danger-color) !important;
}

.transport__toggle--on {
  border-color: var(--primary-color) !important;
  color: var(--primary-color) !important;
}

.transport__position {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  min-width: 5.5rem;
}

.transport__pos-value {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 1rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.transport__pos-cycle {
  font-size: 0.65rem;
}

.transport__field {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.transport__label {
  font-weight: 500;
}

.transport__number {
  width: 3.6rem;
  padding: 0.2rem 0.3rem;
  background: var(--background-light);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.transport__range {
  width: 90px;
}

.transport__value {
  min-width: 2.4rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.transport__meter {
  flex: 1;
  max-width: 220px;
}

.transport__rec { display: inline-flex; align-items: center; gap: 0.35rem; font-variant-numeric: tabular-nums; min-width: 5.2rem; justify-content: center; }
.transport__rec-dot { color: var(--danger-color); }
.transport__rec--on { background: var(--danger-color) !important; border-color: var(--danger-color) !important; color: #fff !important; }
.transport__rec--on .transport__rec-dot { color: #fff; animation: rec-blink 1s steps(2, start) infinite; }
@keyframes rec-blink { to { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) { .transport__rec--on .transport__rec-dot { animation: none; } }
</style>
