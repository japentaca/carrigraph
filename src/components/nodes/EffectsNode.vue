<template>
  <BaseNode type="effects" :data="data" width="240px">
    <div v-for="fx in EFFECTS" :key="fx.type" class="fx-block" :class="{ 'fx-block--on': cfg(fx.type).enabled }">
      <label class="fx-block__head nodrag">
        <input
          type="checkbox"
          :checked="!!cfg(fx.type).enabled"
          @change="set(fx.type, { enabled: $event.target.checked })"
        />
        <span>{{ fx.icon }} {{ fx.label }}</span>
      </label>

      <div v-if="cfg(fx.type).enabled" class="fx-block__body">
        <div v-if="fx.type === 'filter'" class="cg-field">
          <div class="cg-buttons">
            <button
              v-for="m in FILTER_MODE_OPTIONS" :key="m.value"
              class="cg-btn nodrag" :class="{ active: (cfg('filter').mode || 'lowpass') === m.value }"
              @click="set('filter', { mode: m.value })"
            >{{ m.label }}</button>
          </div>
        </div>

        <div v-for="p in fx.params" :key="p.key" class="cg-field">
          <label class="cg-label">{{ p.label }}</label>
          <div class="cg-control">
            <input
              type="range" class="cg-range nodrag"
              min="0" max="1" step="0.005"
              :value="toSlider(p, value(fx.type, p.key))"
              @input="set(fx.type, { [p.key]: fromSlider(p, parseFloat($event.target.value)) })"
            />
            <span class="cg-value">{{ p.format(value(fx.type, p.key)) }}</span>
          </div>
        </div>
      </div>
    </div>
    <p class="cg-hint">Orden fijo: distorsión → filtro → delay → reverb. Encadená otro nodo para otro orden.</p>
  </BaseNode>
</template>

<script setup>
import BaseNode from './BaseNode.vue'
import { EFFECT_DEFAULTS, EFFECT_RANGES } from '../../audio/engine/effects.js'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const pct = (v) => `${Math.round(v * 100)}%`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
const sec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)

// scale: 'lin' or 'log' (frequencies) between EFFECT_RANGES[key]
const param = (key, label, format, scale = 'lin') => ({ key, label, format, scale, range: EFFECT_RANGES[key] })
const amount = param('amount', 'Cantidad', pct)

const EFFECTS = [
  { type: 'distortion', label: 'Distorsión', icon: '⚡', params: [amount, param('drive', 'Saturación', pct), param('tone', 'Tono (Hz)', hz, 'log')] },
  { type: 'filter', label: 'Filtro', icon: '🔧', params: [amount, param('cutoff', 'Corte (Hz)', hz, 'log'), param('resonance', 'Resonancia', (v) => v.toFixed(1), 'log')] },
  { type: 'delay', label: 'Delay', icon: '⏰', params: [amount, param('time', 'Tiempo', sec), param('feedback', 'Realimentación', pct)] },
  { type: 'reverb', label: 'Reverb', icon: '🌊', params: [amount, param('decay', 'Duración', sec)] }
]

const FILTER_MODE_OPTIONS = [
  { value: 'lowpass', label: 'Pasa bajos' },
  { value: 'highpass', label: 'Pasa altos' },
  { value: 'bandpass', label: 'Pasa banda' }
]

const cfg = (type) => props.data[type] || { enabled: false }
const value = (type, key) => {
  const v = Number(cfg(type)[key])
  return Number.isFinite(v) ? v : EFFECT_DEFAULTS[type][key]
}

function toSlider(p, v) {
  const [lo, hi] = p.range
  if (p.scale === 'log') return Math.log(v / lo) / Math.log(hi / lo)
  return (v - lo) / (hi - lo)
}

function fromSlider(p, x) {
  const [lo, hi] = p.range
  const v = p.scale === 'log' ? lo * Math.pow(hi / lo, x) : lo + (hi - lo) * x
  return Math.round(v * 1000) / 1000
}

function set(type, changes) {
  const current = { ...EFFECT_DEFAULTS[type], enabled: false, ...cfg(type) }
  emit('update', { ...props.data, [type]: { ...current, ...changes } })
}
</script>

<style scoped>
.fx-block {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  margin-bottom: 0.4rem;
  background: var(--background-dark);
}
.fx-block--on { border-color: #6d28d9; }
.fx-block__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.fx-block__body { margin-top: 0.4rem; }
</style>
