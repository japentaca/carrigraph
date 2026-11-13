<template>
  <div
    v-if="open"
    ref="root"
    class="palette"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    :style="{ left: `${place.left}px`, top: `${place.top}px`, maxHeight: `${place.maxHeight}px` }"
    v-trap-focus="close"
    @pointerdown.stop
    @contextmenu.prevent
  >
    <div class="palette__title">{{ title }}</div>
    <input
      ref="input"
      v-model="query"
      class="palette__search"
      type="search"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="results.length > 0"
      aria-controls="cg-palette-list"
      :aria-activedescendant="results.length ? `cg-palette-opt-${active}` : undefined"
      placeholder="Buscar nodo…"
      aria-label="Buscar tipo de nodo"
      data-autofocus
      @keydown="onKey"
    />
    <ul id="cg-palette-list" class="palette__list" role="listbox" aria-label="Tipos de nodo">
      <li
        v-for="(entry, i) in results"
        :id="`cg-palette-opt-${i}`"
        :key="entry.type"
        class="palette__item"
        :class="{ 'palette__item--active': i === active }"
        role="option"
        :aria-selected="i === active"
        @pointerenter="active = i"
        @click="pick(entry)"
      >
        <span class="palette__icon" :style="{ background: entry.color }" aria-hidden="true">{{ entry.icon }}</span>
        <span class="palette__text">
          <span class="palette__label">{{ entry.label }}</span>
          <span class="palette__desc">{{ entry.portLabel ? `Conecta a: ${entry.portLabel}` : entry.description }}</span>
        </span>
      </li>
      <li v-if="!results.length" class="palette__none">Ningún nodo coincide con “{{ query }}”.</li>
    </ul>
    <div class="palette__hint"><kbd>↑</kbd><kbd>↓</kbd> elegir · <kbd>Enter</kbd> crear · <kbd>Esc</kbd> cerrar</div>
  </div>
</template>

<script setup>
/**
 * Searchable node palette (Fase 4B), opened with a double click or Tab on the
 * canvas, or by dropping a connection on empty canvas (then it lists only the
 * node types that can take that connection). Typing filters; ↑/↓ choose;
 * Enter or a click creates the node where the palette was opened.
 */
import { ref, computed, watch } from 'vue'
import { searchPalette } from '../../editor/palette.js'
import { menuPlacement } from '../../composables/useContextMenu.js'
import { vTrapFocus } from '../../composables/useFocusTrap.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** Screen point where it opens. */
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  /** [{ type, label, description, icon, color, portLabel? }] */
  entries: { type: Array, default: () => [] },
  title: { type: String, default: 'Agregar nodo' }
})
const emit = defineEmits(['pick', 'close'])

const query = ref('')
const active = ref(0)
const root = ref(null)

const results = computed(() => searchPalette(props.entries, query.value))

watch(() => props.open, (open) => {
  if (open) { query.value = ''; active.value = 0 }
})
watch(results, () => { active.value = 0 })

const place = computed(() => menuPlacement(props.x, props.y, {
  width: 280,
  height: 380,
  viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
  viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 768
}))

function close() { emit('close') }

function pick(entry) {
  if (entry) emit('pick', entry)
}

function scrollActive() {
  root.value?.querySelector(`#cg-palette-opt-${active.value}`)?.scrollIntoView?.({ block: 'nearest' })
}

function onKey(event) {
  const n = results.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (n) { active.value = (active.value + 1) % n; scrollActive() }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (n) { active.value = (active.value - 1 + n) % n; scrollActive() }
  } else if (event.key === 'Enter') {
    event.preventDefault()
    pick(results.value[active.value])
  } else if (event.key === 'Tab') {
    // Tab inside the palette moves through the results instead of leaving it.
    event.preventDefault()
    if (n) { active.value = (active.value + (event.shiftKey ? n - 1 : 1)) % n; scrollActive() }
  }
}
</script>

<style scoped>
.palette {
  position: fixed;
  z-index: 1200;
  width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 10px 30px var(--shadow-color);
  padding: 0.5rem;
  gap: 0.4rem;
}
.palette__title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  padding: 0 0.25rem;
}
.palette__search {
  width: 100%;
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
  color: var(--text-primary);
  font-size: 0.85rem;
}
.palette__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
.palette__item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
}
.palette__item--active { background: var(--background-light); outline: 1px solid var(--primary-color); }
.palette__icon {
  width: 1.6rem;
  height: 1.6rem;
  flex: none;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.85rem;
}
.palette__text { display: flex; flex-direction: column; min-width: 0; }
.palette__label { font-size: 0.85rem; color: var(--text-primary); }
.palette__desc {
  font-size: 0.7rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.palette__none { padding: 0.5rem; font-size: 0.8rem; color: var(--text-secondary); }
.palette__hint { font-size: 0.68rem; color: var(--text-secondary); padding: 0 0.25rem; }
kbd {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 0 0.25rem;
  margin-right: 0.15rem;
  font-size: 0.65rem;
}
</style>
