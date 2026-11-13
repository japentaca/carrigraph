<template>
  <div class="seed" :class="{ 'seed--idle': !matters, 'seed--compact': compact }" role="group" aria-label="Semilla">
    <span v-if="!compact" class="seed__label">Semilla</span>
    <input
      class="seed__input nodrag"
      type="number" min="0" max="999" step="1"
      :value="display"
      :disabled="locked"
      :aria-label="`Semilla (0 a 999)${locked ? ', bloqueada' : ''}`"
      :title="matters ? 'Semilla: decide la variación aleatoria de este nodo' : 'Con los ajustes actuales este nodo no usa la semilla'"
      @change="onInput($event)"
    />
    <button
      type="button"
      class="seed__btn nodrag"
      :disabled="locked"
      :aria-label="locked ? 'Nueva semilla (bloqueada)' : 'Nueva semilla'"
      :title="locked ? 'La semilla está bloqueada' : 'Nueva semilla'"
      @click="renew"
    ><span aria-hidden="true">🎲</span></button>
    <button
      type="button"
      class="seed__btn nodrag"
      :class="{ 'seed__btn--on': locked }"
      :aria-pressed="locked"
      :aria-label="locked ? 'Desbloquear semilla' : 'Bloquear semilla'"
      :title="locked ? 'Desbloquear: nueva semilla y aleatorizar la pueden cambiar' : 'Bloquear: nueva semilla y aleatorizar no la cambian'"
      @click="emit('update', { ...node.data, seedLocked: !locked })"
    ><span aria-hidden="true">{{ locked ? '🔒' : '🔓' }}</span></button>
  </div>
</template>

<script setup>
/**
 * Seed of a node (Fase 4B): value (0–999, stored /1000 as before), "nueva
 * semilla" and "bloquear". Shown on the canvas node and in the inspector, for
 * the node types with a seed (nodeParams.SEED_TYPES).
 */
import { computed } from 'vue'
import { nodeSeed } from '../../audio/graph/nodeTypes.js'
import { seedMatters, withNewSeed } from '../../audio/graph/nodeParams.js'

const props = defineProps({
  /** { id, type, data } */
  node: { type: Object, required: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['update'])

const locked = computed(() => !!props.node.data?.seedLocked)
const matters = computed(() => seedMatters(props.node))
const display = computed(() => Math.round(nodeSeed(props.node) * 1000))

function onInput(event) {
  const v = parseInt(event.target.value)
  if (!Number.isFinite(v)) { event.target.value = display.value; return }
  const clamped = Math.max(0, Math.min(999, v))
  event.target.value = clamped
  emit('update', { ...props.node.data, seed: clamped / 1000 })
}

function renew() {
  const data = withNewSeed(props.node)
  if (data) emit('update', data)
}
</script>

<style scoped>
.seed {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
}
.seed--idle .seed__input { opacity: 0.6; }
.seed__label { color: var(--text-secondary); margin-right: 0.15rem; }
.seed__input {
  width: 3.4rem;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.15rem 0.3rem;
  color: var(--text-primary);
  font-size: 0.72rem;
}
.seed--compact .seed__input { width: 3rem; padding: 0.1rem 0.25rem; }
.seed__btn {
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.05rem 0.3rem;
  cursor: pointer;
  font-size: 0.75rem;
  line-height: 1.3;
}
.seed__btn:hover:not(:disabled) { border-color: var(--primary-color); }
.seed__btn:disabled { opacity: 0.4; cursor: not-allowed; }
.seed__btn--on { border-color: var(--warning-color); background: color-mix(in srgb, var(--warning-color) 20%, transparent); }
</style>
