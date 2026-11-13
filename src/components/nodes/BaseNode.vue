<template>
  <!-- Parameters of a node (no ports, no header): the same panel is shown
       inside the expanded node on the canvas and in the side inspector. -->
  <div ref="root" class="cg-node-body" :class="`cg-node-body--${type}`">
    <slot />
  </div>
</template>

<script setup>
/**
 * BaseNode (Fase 4B): body-only wrapper of a node's parameter controls.
 * Labels: every `.cg-label` names the control that follows it for screen
 * readers (labelControls), so the components do not need ids.
 */
import { ref, onMounted, onUpdated } from 'vue'
import { labelControls } from '../../editor/a11y.js'

defineProps({
  type: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  /** Kept for compatibility (old fixed widths); the container decides the width now. */
  width: { type: String, default: '' }
})

const root = ref(null)
onMounted(() => labelControls(root.value))
onUpdated(() => labelControls(root.value))
</script>

<style>
/* Shared look of the node parameter panels (global, cg- prefix). The
   chrome around them (ports, header, thumbnail) is CanvasNode on the canvas
   and NodeInspector in the side panel (Fase 4B). */
.cg-node-body {
  font-size: 12px;
  color: var(--text-primary);
}
.cg-field { margin-bottom: 0.6rem; }
.cg-field:last-child { margin-bottom: 0; }
.cg-label {
  display: block;
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}
.cg-select, .cg-input {
  width: 100%;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.35rem 0.4rem;
  color: var(--text-primary);
  font-size: 0.75rem;
}
.cg-control { display: flex; align-items: center; gap: 0.5rem; }
.cg-range { flex: 1; min-width: 0; }
.cg-value { min-width: 2.6rem; text-align: right; font-size: 0.72rem; }
.cg-row { display: flex; gap: 0.5rem; }
.cg-col { flex: 1; min-width: 0; }
.cg-buttons { display: flex; gap: 0.25rem; flex-wrap: wrap; }
.cg-btn {
  flex: 1;
  min-width: 0;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.25rem 0.4rem;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.72rem;
}
.cg-btn:hover { color: var(--text-primary); }
.cg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cg-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--text-primary); }
.cg-range { accent-color: var(--primary-color); }
.cg-btn.active { background: var(--primary-color); border-color: var(--primary-color); color: white; }
.cg-hint { color: var(--text-secondary); font-size: 0.68rem; line-height: 1.35; margin: 0; }
</style>
