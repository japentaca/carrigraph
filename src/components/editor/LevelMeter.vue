<template>
  <div class="meter" :title="title" role="meter" aria-label="Nivel de salida"
       :aria-valuenow="Math.round(peakDb)" aria-valuemin="-60" aria-valuemax="0">
    <div class="meter__track">
      <div class="meter__rms" :class="zoneClass" :style="{ width: `${rmsPos * 100}%` }"></div>
      <div class="meter__peak" :style="{ left: `calc(${holdPos * 100}% - 1px)` }" v-show="holdPos > 0"></div>
    </div>
    <span class="meter__value" :class="{ 'meter__value--clip': clipping }">
      {{ peakDb <= -60 ? '−∞' : `${Math.round(peakDb)} dB` }}
    </span>
  </div>
</template>

<script setup>
/**
 * Output level (after the master volume): RMS bar, peak hold line and peak
 * dB. Polls the engine's analyser while playing (not through Pinia state:
 * ~20 reads per second would only churn reactivity).
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { useAudioStore } from '../../stores/useAudioStore'
import { meterPosition, METER_FLOOR_DB } from '../../audio/engine/meter.js'

const props = defineProps({
  /** Poll period, ms. */
  interval: { type: Number, default: 50 }
})

const audioStore = useAudioStore()
const rmsDb = ref(METER_FLOOR_DB)
const peakDb = ref(METER_FLOOR_DB)
const holdDb = ref(METER_FLOOR_DB)
const clipping = ref(false)
let holdUntil = 0
let timer = null

const rmsPos = computed(() => meterPosition(rmsDb.value))
const holdPos = computed(() => meterPosition(holdDb.value))
const zoneClass = computed(() => (peakDb.value > -1 ? 'meter__rms--hot' : peakDb.value > -9 ? 'meter__rms--warm' : ''))
const title = computed(() => `Nivel de salida: pico ${peakDb.value <= METER_FLOOR_DB ? '−∞' : Math.round(peakDb.value) + ' dBFS'}, RMS ${rmsDb.value <= METER_FLOOR_DB ? '−∞' : Math.round(rmsDb.value) + ' dBFS'}`)

function read() {
  const level = audioStore.getLevel()
  const now = Date.now()
  // Falls smoothly (about 20 dB/s) instead of jumping to silence
  const fall = (prev, next) => Math.max(next, prev - 1)
  rmsDb.value = fall(rmsDb.value, level ? level.rmsDb : METER_FLOOR_DB)
  peakDb.value = fall(peakDb.value, level ? level.peakDb : METER_FLOOR_DB)
  if (peakDb.value >= holdDb.value || now > holdUntil) {
    holdDb.value = peakDb.value
    holdUntil = now + 1200
  }
  clipping.value = !!level && level.peak >= 0.99
}

function start() {
  stop()
  timer = setInterval(read, props.interval)
}

function stop() {
  if (timer != null) clearInterval(timer)
  timer = null
}

function reset() {
  rmsDb.value = METER_FLOOR_DB
  peakDb.value = METER_FLOOR_DB
  holdDb.value = METER_FLOOR_DB
  clipping.value = false
}

watch(() => audioStore.isPlaying, (playing) => {
  if (playing) start()
  else { stop(); reset() }
}, { immediate: true })

onUnmounted(stop)

defineExpose({ read })
</script>

<style scoped>
.meter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 120px;
}

.meter__track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
}

.meter__rms {
  height: 100%;
  background: var(--accent-color);
  transition: width 60ms linear;
}

.meter__rms--warm { background: var(--warning-color); }
.meter__rms--hot { background: var(--danger-color); }

.meter__peak {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--text-primary);
}

.meter__value {
  font-variant-numeric: tabular-nums;
  font-size: 0.7rem;
  color: var(--text-secondary);
  min-width: 3.4rem;
  text-align: right;
}

.meter__value--clip {
  color: var(--danger-color);
  font-weight: 600;
}
</style>
