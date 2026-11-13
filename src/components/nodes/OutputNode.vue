<template>
  <BaseNode type="output" :data="data" width="200px">
    <div class="cg-field">
      <label class="cg-label">Nombre de la pista</label>
      <input
        type="text" class="cg-input nodrag" maxlength="40"
        :value="data.name || ''" placeholder="(el instrumento)"
        @change="update({ name: $event.target.value.trim() || undefined })"
      />
    </div>

    <div class="cg-field">
      <label class="cg-label">Volumen</label>
      <div class="cg-control">
        <input
          type="range" class="cg-range nodrag" min="0" max="1" step="0.01"
          :value="mix.volume"
          @input="update({ volume: parseFloat($event.target.value) })"
        />
        <span class="cg-value">{{ Math.round(mix.volume * 100) }}%</span>
      </div>
    </div>

    <div class="cg-field">
      <label class="cg-label">Paneo</label>
      <div class="cg-control">
        <input
          type="range" class="cg-range nodrag" min="-1" max="1" step="0.05"
          :value="mix.pan"
          @input="update({ pan: parseFloat($event.target.value) })"
          @dblclick="update({ pan: 0 })"
        />
        <span class="cg-value">{{ formatPan(mix.pan) }}</span>
      </div>
    </div>

    <div class="cg-field cg-buttons">
      <button
        class="cg-btn nodrag mix-btn mix-btn--mute" :class="{ active: mix.mute }"
        :aria-pressed="mix.mute" title="Silenciar esta pista"
        @click="update({ mute: !mix.mute })"
      >M · Mute</button>
      <button
        class="cg-btn nodrag mix-btn mix-btn--solo" :class="{ active: mix.solo }"
        :aria-pressed="mix.solo" title="Escuchar solo esta pista (y las demás en solo)"
        @click="update({ solo: !mix.solo })"
      >S · Solo</button>
    </div>
    <p class="cg-hint">El volumen multiplica el de la voz; el paneo se suma.</p>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'
import { outputMix } from '../../audio/graph/compile.js'

const props = defineProps({ data: { type: Object, required: true } })
const emit = defineEmits(['update'])

const mix = computed(() => outputMix({ data: props.data }))
const update = (changes) => emit('update', { ...props.data, ...changes })
const formatPan = (v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `I${Math.round(-v * 100)}` : `D${Math.round(v * 100)}`)
</script>

<style scoped>
.mix-btn--mute.active { background: var(--mute-color); border-color: var(--mute-color); }
.mix-btn--solo.active { background: var(--solo-color); border-color: var(--solo-color); color: #171717; }
</style>
