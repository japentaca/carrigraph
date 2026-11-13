<template>
  <!-- Notes of one track. Only re-renders when its layout or the zoom
       changes (the cursor lives in the parent). -->
  <div
    class="lane"
    :style="{
      width: `${maxLength * cellWidth}px`,
      height: `${height}px`,
      '--cell': `${cellWidth}px`,
      '--beat': `${cellWidth * 4}px`,
      '--bar': `${cellWidth * 16}px`
    }"
  >
    <div
      v-if="length < maxLength"
      class="lane__repeat"
      :style="{ left: `${length * cellWidth}px` }"
      :title="`La pista mide ${length} pasos: desde acá se repite`"
    ></div>
    <div
      v-for="n in layout.notes"
      :key="n.key"
      class="lane__note"
      :class="{ 'lane__note--ghost': n.ghost }"
      :style="{
        left: `${n.x * cellWidth}px`,
        width: `${Math.max(2, n.w * cellWidth - 1)}px`,
        bottom: `${2 + n.row * rowHeight}px`,
        height: `${Math.max(2, rowHeight - 1)}px`,
        background: color,
        opacity: (n.ghost ? 0.35 : 0.45 + 0.55 * n.velocity)
      }"
      :title="n.title"
    ></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  layout: { type: Object, required: true }, // laneLayout() result
  length: { type: Number, required: true },
  maxLength: { type: Number, required: true },
  cellWidth: { type: Number, required: true },
  height: { type: Number, default: 56 },
  color: { type: String, required: true }
})

const rowHeight = computed(() => (props.height - 4) / Math.max(1, props.layout.rows))
</script>

<style scoped>
.lane {
  position: relative;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--background-light);
  background-image:
    linear-gradient(to right, var(--border-color) 1px, transparent 1px),
    linear-gradient(to right, color-mix(in srgb, var(--text-secondary) 18%, transparent) 1px, transparent 1px);
  background-size: var(--bar) 100%, var(--beat) 100%;
}
.lane__repeat {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.12) 0 6px, transparent 6px 12px);
  border-left: 2px dashed var(--text-secondary);
  pointer-events: none;
}
.lane__note {
  position: absolute;
  border-radius: 2px;
  margin-bottom: 2px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.lane__note--ghost { box-shadow: none; }
</style>
