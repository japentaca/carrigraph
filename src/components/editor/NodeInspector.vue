<template>
  <aside id="cg-inspector" ref="root" class="inspector" aria-label="Inspector de nodos" tabindex="-1">
    <div class="inspector__head">
      <h2 class="inspector__title">Inspector</h2>
      <button type="button" class="inspector__close" aria-label="Cerrar inspector" title="Cerrar inspector" @click="emit('close')">
        <span aria-hidden="true">×</span>
      </button>
    </div>

    <!-- Several nodes -->
    <section v-if="count > 1" class="inspector__section" aria-label="Selección múltiple">
      <p class="inspector__lead">{{ count }} nodos seleccionados</p>

      <h3 class="inspector__sub">Alinear</h3>
      <div class="inspector__grid" role="group" aria-label="Alinear">
        <button v-for="a in ALIGN" :key="a.mode" type="button" class="cg-btn" :title="a.title" :aria-label="a.title" @click="emit('align', a.mode)">
          <span aria-hidden="true">{{ a.icon }}</span>
        </button>
      </div>
      <h3 class="inspector__sub">Distribuir</h3>
      <div class="inspector__grid inspector__grid--2" role="group" aria-label="Distribuir">
        <button type="button" class="cg-btn" :disabled="count < 3" title="Mismo espacio horizontal entre nodos (3 o más)" @click="emit('align', 'distribute-h')">↔ Horizontal</button>
        <button type="button" class="cg-btn" :disabled="count < 3" title="Mismo espacio vertical entre nodos (3 o más)" @click="emit('align', 'distribute-v')">↕ Vertical</button>
      </div>

      <h3 class="inspector__sub">Acciones</h3>
      <div class="inspector__actions">
        <button type="button" class="cg-btn" title="Duplicar con sus conexiones internas (Ctrl+D)" @click="emit('duplicate')">⧉ Duplicar</button>
        <button type="button" class="cg-btn" title="Copiar (Ctrl+C)" @click="emit('copy')">📋 Copiar</button>
        <button type="button" class="cg-btn" :disabled="!seededCount" :title="seededCount ? 'Nueva semilla en los nodos con semilla no bloqueada' : 'Ningún nodo seleccionado usa semilla'" @click="emit('new-seeds')">🎲 Nuevas semillas</button>
        <button type="button" class="cg-btn" title="Aleatorizar los parámetros de todos (respeta semillas bloqueadas)" @click="emit('randomize')">🔀 Aleatorizar</button>
        <button type="button" class="cg-btn cg-btn--danger" title="Eliminar (Supr)" @click="emit('delete')">🗑 Eliminar</button>
      </div>
    </section>

    <!-- One node -->
    <section v-else-if="node" class="inspector__section" :aria-label="`Parámetros de ${name}`">
      <div class="inspector__node" :style="{ '--node-color': color }">
        <span class="inspector__icon" aria-hidden="true">{{ entry?.icon }}</span>
        <div class="inspector__node-text">
          <input
            class="inspector__name"
            :value="name"
            :placeholder="entry?.label"
            aria-label="Nombre del nodo"
            maxlength="40"
            @change="rename($event)"
          />
          <span class="inspector__type">{{ entry?.label }}</span>
        </div>
      </div>

      <NodePreview v-if="preview" class="inspector__preview" :preview="preview" :active="active" :width="248" :height="36" :color="color" />

      <ul v-if="diagnostics.length" class="inspector__diags">
        <li v-for="(d, i) in diagnostics" :key="i" :class="`inspector__diag--${d.level}`">
          <span aria-hidden="true">{{ d.level === 'error' ? '⛔' : d.level === 'warning' ? '⚠️' : 'ℹ️' }}</span>
          <span class="sr-only">{{ d.level === 'error' ? 'Error:' : d.level === 'warning' ? 'Aviso:' : 'Info:' }}</span>
          {{ d.message }}
        </li>
      </ul>

      <div class="inspector__tools">
        <SeedControls v-if="seeded" :node="node" @update="(d) => emit('update', node.id, d)" />
        <button
          type="button" class="cg-btn inspector__random"
          :disabled="!randomizable"
          :title="randomizable ? 'Valores al azar dentro de los rangos válidos (la semilla bloqueada se respeta)' : 'Este nodo no tiene parámetros para aleatorizar'"
          @click="emit('randomize', [node.id])"
        >🔀 Aleatorizar parámetros</button>
      </div>

      <div class="inspector__body">
        <component :is="entry?.component" :data="node.data" @update="(d) => emit('update', node.id, d)" />
      </div>
    </section>

    <!-- Nothing selected -->
    <section v-else class="inspector__section inspector__empty">
      <p>Seleccioná un nodo para ver y editar sus parámetros.</p>
      <ul>
        <li><kbd>Shift</kbd> + clic o arrastrar con <kbd>Shift</kbd>: seleccionar varios</li>
        <li>Doble clic o <kbd>Tab</kbd> en el lienzo: buscar un nodo para crear</li>
        <li>Soltá una conexión en el vacío para crear un nodo ya conectado</li>
        <li><kbd>?</kbd>: todos los atajos</li>
      </ul>
    </section>
  </aside>
</template>

<script setup>
/**
 * Side inspector (Fase 4B). One node: name, thumbnail, diagnostics, seed,
 * "aleatorizar" and the node's own parameter panel (the registry component,
 * the same one the expanded node shows on the canvas). Several nodes: align,
 * distribute and group actions. Edits go through the same store action as
 * the canvas (live, grouped undo). It replaced the modal of Fase 4A.
 */
import { ref, computed } from 'vue'
import NodePreview from '../nodes/NodePreview.vue'
import SeedControls from '../nodes/SeedControls.vue'
import { getNodeEntry, nodeDisplayName } from '../nodes/nodeRegistry.js'
import { hasSeed, canRandomize } from '../../audio/graph/nodeParams.js'

const props = defineProps({
  node: { type: Object, default: null },
  count: { type: Number, default: 0 },
  /** How many selected nodes have a seed (multi-selection). */
  seededCount: { type: Number, default: 0 },
  preview: { type: Object, default: null },
  active: { type: Boolean, default: false },
  diagnostics: { type: Array, default: () => [] }
})

const emit = defineEmits(['update', 'close', 'align', 'duplicate', 'copy', 'new-seeds', 'randomize', 'delete'])

const ALIGN = [
  { mode: 'left', icon: '⇤', title: 'Alinear a la izquierda' },
  { mode: 'center', icon: '↔', title: 'Centrar horizontalmente' },
  { mode: 'right', icon: '⇥', title: 'Alinear a la derecha' },
  { mode: 'top', icon: '⤒', title: 'Alinear arriba' },
  { mode: 'middle', icon: '↕', title: 'Centrar verticalmente' },
  { mode: 'bottom', icon: '⤓', title: 'Alinear abajo' }
]

const root = ref(null)
const entry = computed(() => getNodeEntry(props.node?.type))
const name = computed(() => nodeDisplayName(props.node))
const color = computed(() => props.node?.data?.color || entry.value?.color || '#737373')
const seeded = computed(() => hasSeed(props.node?.type))
const randomizable = computed(() => canRandomize(props.node?.type))

function rename(event) {
  const label = event.target.value.trim()
  emit('update', props.node.id, { ...props.node.data, label: label || entry.value?.label })
}

/** Move the keyboard focus into the inspector (double click on a node). */
function focus() {
  const target = root.value?.querySelector('.inspector__body select, .inspector__body input, .inspector__body button, .inspector__name')
  ;(target || root.value)?.focus({ preventScroll: true })
}

defineExpose({ focus })
</script>

<style scoped>
.inspector {
  width: 300px;
  flex: none;
  background: var(--background-dark);
  border-left: 1px solid var(--border-color);
  overflow-y: auto;
  padding: 0.75rem 0.85rem 1.5rem;
  color: var(--text-primary);
  outline: none;
}
.inspector__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.inspector__title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0;
}
.inspector__close {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 1.25rem;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
}
.inspector__close:hover { border-color: var(--border-color); color: var(--text-primary); }
.inspector__section { display: flex; flex-direction: column; gap: 0.6rem; }
.inspector__lead { font-weight: 600; margin: 0; }
.inspector__sub {
  font-size: 0.72rem;
  color: var(--text-secondary);
  margin: 0.3rem 0 0;
  font-weight: 500;
}
.inspector__grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.25rem; }
.inspector__grid--2 { grid-template-columns: 1fr 1fr; }
.inspector__grid .cg-btn { font-size: 1rem; padding: 0.3rem 0; }
.inspector__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; }
.inspector__actions .cg-btn { padding: 0.4rem; }
.cg-btn--danger { color: var(--danger-color); }
.inspector__node {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  border-left: 4px solid var(--node-color);
  padding-left: 0.5rem;
}
.inspector__icon {
  width: 2rem;
  height: 2rem;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--node-color) 28%, transparent);
}
.inspector__node-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.inspector__name {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.95rem;
  padding: 0.15rem 0.25rem;
  width: 100%;
}
.inspector__name:hover, .inspector__name:focus { border-color: var(--border-color); background: var(--background-light); }
.inspector__type { font-size: 0.7rem; color: var(--text-secondary); padding-left: 0.3rem; }
.inspector__diags { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; }
.inspector__diags li { padding: 0.3rem 0.45rem; border-radius: 4px; border: 1px solid var(--border-color); }
.inspector__diag--error { border-color: var(--danger-color) !important; }
.inspector__diag--warning { border-color: var(--warning-color) !important; }
.inspector__tools { display: flex; flex-direction: column; gap: 0.4rem; }
.inspector__random { padding: 0.35rem; }
.inspector__body {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.65rem;
}
.inspector__empty { color: var(--text-secondary); font-size: 0.8rem; line-height: 1.5; }
.inspector__empty ul { padding-left: 1rem; margin: 0; }
kbd {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 0 0.25rem;
  font-size: 0.7rem;
}
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
</style>
