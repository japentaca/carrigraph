<template>
  <aside ref="root" class="perf" role="dialog" aria-label="Modo performance" tabindex="-1" @keydown.esc.stop="emit('close')">
    <div class="perf__header">
      <h3>🎛 Performance</h3>
      <button class="close-btn" aria-label="Cerrar modo performance" @click="emit('close')">×</button>
    </div>

    <!-- Tracks: big mute / solo, one variation button per track -->
    <section class="perf__section" aria-labelledby="perf-tracks">
      <h4 id="perf-tracks">Pistas</h4>
      <p v-if="!tracks.length" class="perf__hint">Conectá Patrón → Voz → Salida para tener pistas.</p>
      <p v-else-if="compat" class="perf__hint">
        Modo compatibilidad (sin nodo Salida): mute y solo necesitan una Salida por pista.
      </p>
      <div class="perf__tracks">
        <div v-for="(t, i) in tracks" :key="t.id" class="perf__track" :style="{ '--track-color': color(i) }">
          <span class="perf__track-name" :title="t.name">{{ t.name }}</span>
          <div class="perf__track-buttons">
            <button
              class="perf__big perf__big--mute"
              :class="{ 'perf__big--on': t.mute }"
              :aria-pressed="!!t.mute"
              :disabled="compat"
              :aria-label="`Mute ${t.name}`"
              @click="toggleMix(t, 'mute')"
            >M</button>
            <button
              class="perf__big perf__big--solo"
              :class="{ 'perf__big--on': t.solo }"
              :aria-pressed="!!t.solo"
              :disabled="compat"
              :aria-label="`Solo ${t.name}`"
              @click="toggleMix(t, 'solo')"
            >S</button>
            <button
              class="perf__big"
              :disabled="!seedIds(t).length"
              :title="seedIds(t).length ? 'Nueva semilla en los nodos de esta pista (suena en el próximo compás)' : 'Esta pista no tiene nodos con semilla libre'"
              :aria-label="`Variación de ${t.name}`"
              @click="vary(seedIds(t))"
            >🎲</button>
          </div>
        </div>
      </div>
      <button
        class="perf__wide"
        :disabled="!allSeedIds.length"
        title="Nueva semilla en todos los nodos con semilla sin bloquear"
        @click="vary(allSeedIds)"
      >🎲 Variación de todo</button>
      <p class="perf__hint">Las variaciones cambian semillas (las bloqueadas 🔒 no) y suenan en el próximo compás. Se pueden deshacer.</p>
    </section>

    <!-- Macros -->
    <section class="perf__section" aria-labelledby="perf-macros">
      <h4 id="perf-macros">Macros</h4>
      <p class="perf__hint">Un control mueve uno o varios parámetros dentro de su rango. Se guardan con el proyecto.</p>
      <div v-for="m in macros" :key="m.id" class="perf__macro">
        <div class="perf__macro-head">
          <input
            class="perf__macro-name"
            :value="m.name"
            maxlength="40"
            :aria-label="`Nombre de ${m.id}`"
            @change="rename(m, $event.target.value)"
          />
          <span class="perf__macro-value">{{ Math.round(m.value * 100) }}%</span>
        </div>
        <input
          class="perf__macro-slider"
          type="range" min="0" max="1" step="0.01"
          :value="m.value"
          :disabled="!m.targets.length"
          :aria-label="m.name"
          @input="move(m, parseFloat($event.target.value))"
        />
        <ul v-if="m.targets.length" class="perf__targets">
          <li v-for="(tg, k) in m.targets" :key="tg.nodeId + tg.path" :class="{ 'perf__target--missing': !nodeById(tg.nodeId) }">
            <span>{{ targetLabel(tg) }}</span>
            <label class="perf__invert" title="Invertir: el máximo de la macro lleva el parámetro a su mínimo">
              <input type="checkbox" :checked="!!tg.invert" @change="setInvert(m, k, $event.target.checked)" /> inv.
            </label>
            <button class="perf__remove" :aria-label="`Quitar ${targetLabel(tg)}`" @click="removeTarget(m, k)">×</button>
          </li>
        </ul>
        <div class="perf__assign">
          <select v-model="pick[m.id].nodeId" :aria-label="`Nodo para ${m.name}`" @change="pick[m.id].path = ''">
            <option value="">Nodo…</option>
            <option v-for="n in assignableNodes" :key="n.id" :value="String(n.id)">{{ n.label }}</option>
          </select>
          <select v-model="pick[m.id].path" :disabled="!pick[m.id].nodeId" :aria-label="`Parámetro para ${m.name}`">
            <option value="">Parámetro…</option>
            <option v-for="p in paramsOf(pick[m.id].nodeId)" :key="p.path" :value="p.path">{{ p.label }}</option>
          </select>
          <button class="cg-btn" :disabled="!pick[m.id].nodeId || !pick[m.id].path" @click="addTarget(m)">Asignar</button>
        </div>
      </div>
    </section>
  </aside>
</template>

<script setup>
/**
 * Modo performance (Fase 5B): big mute/solo per track, variations (new seeds,
 * heard at the next bar like any note change) and macros that move several
 * node params inside their registry ranges (audio/graph/macros.js).
 * Everything writes the project through the store, so it plays live, can be
 * undone (variations, macro moves) and is saved.
 */
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { useProjectStore } from '../../stores/useProjectStore'
import { usePlayback } from '../../composables/usePlayback.js'
import { nodeDisplayName } from '../nodes/nodeRegistry.js'
import { hasSeed, withNewSeed } from '../../audio/graph/nodeParams.js'
import {
  applyMacro, assignableParams, paramLabel, paramSpec, positionFromValue, rangeLabel
} from '../../audio/graph/macros.js'
import { getParamValue } from '../../audio/graph/nodeParams.js'
import { trackColor } from '../timeline/pianoRoll.js'

const emit = defineEmits(['close'])
const projectStore = useProjectStore()
const playback = usePlayback()
const root = ref(null)

const color = (i) => trackColor(i)
const compiled = computed(() => playback.compiled.value)
const compat = computed(() => compiled.value.mode === 'compat')
const tracks = computed(() => {
  const infos = compiled.value.tracks || []
  return (compiled.value.score?.tracks || []).map((t, i) => ({
    id: t.id, name: t.name, mute: !!t.mute, solo: !!t.solo, nodeIds: infos[i]?.nodeIds || []
  }))
})

const nodeById = (id) => projectStore.nodes.find(n => String(n.id) === String(id))

// --- Mute / solo -----------------------------------------------------------
function toggleMix(track, key) {
  playback.setTrackMix(track.id, { [key]: !track[key] })
}

// --- Variations ------------------------------------------------------------
const freeSeed = (n) => n && hasSeed(n.type) && !n.data?.seedLocked
function seedIds(track) {
  return track.nodeIds.filter(id => freeSeed(nodeById(id))).map(String)
}
const allSeedIds = computed(() => projectStore.nodes.filter(freeSeed).map(n => String(n.id)))

function vary(ids) {
  const map = {}
  for (const id of ids) {
    const data = withNewSeed(nodeById(id))
    if (data) map[String(id)] = data
  }
  return projectStore.updateNodesData(map)
}

// --- Macros ----------------------------------------------------------------
const macros = computed(() => projectStore.macros)
const pick = reactive(Object.fromEntries(projectStore.macros.map(m => [m.id, { nodeId: '', path: '' }])))
watch(() => projectStore.macros.map(m => m.id), (ids) => {
  for (const id of ids) if (!pick[id]) pick[id] = { nodeId: '', path: '' }
})

const assignableNodes = computed(() => projectStore.nodes
  .filter(n => assignableParams(n.type).length)
  .map(n => ({ id: n.id, label: nodeDisplayName(n) })))

function paramsOf(nodeId) {
  const node = nodeById(nodeId)
  return node ? assignableParams(node.type).map(p => ({ path: p.path, label: `${paramLabel(p.path)} (${rangeLabel(p.spec)})` })) : []
}

function targetLabel(tg) {
  const node = nodeById(tg.nodeId)
  if (!node) return `${paramLabel(tg.path)} · nodo borrado`
  return `${nodeDisplayName(node)} · ${paramLabel(tg.path)}`
}

function update(macro, changes) {
  projectStore.setMacros(projectStore.macros.map(m => (m.id === macro.id ? { ...m, ...changes } : m)))
}

function rename(macro, name) {
  update(macro, { name })
}

function move(macro, value) {
  update(macro, { value })
  const map = applyMacro({ ...macro, value }, value, projectStore.nodes)
  // One undo entry per gesture (the window pointerup closes the group).
  projectStore.updateNodesData(map, { group: `macro:${macro.id}` })
}

function addTarget(macro) {
  const { nodeId, path } = pick[macro.id]
  if (!nodeId || !path) return
  const node = nodeById(nodeId)
  const targets = [...macro.targets.filter(t => !(t.nodeId === nodeId && t.path === path)), { nodeId, path }]
  // The first target sets the macro where the param is now (no jump).
  const spec = node && paramSpec(node.type, path)
  const value = macro.targets.length || !spec ? macro.value : positionFromValue(spec, getParamValue(node.data, path))
  update(macro, { targets, value })
  pick[macro.id] = { nodeId: '', path: '' }
}

function removeTarget(macro, index) {
  update(macro, { targets: macro.targets.filter((_, i) => i !== index) })
}

function setInvert(macro, index, invert) {
  update(macro, { targets: macro.targets.map((t, i) => (i === index ? { ...t, invert } : t)) })
}

onMounted(async () => {
  await nextTick()
  root.value?.focus()
})
</script>

<style scoped>
.perf {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
  background: var(--background-light);
  border-left: 1px solid var(--border-color);
  box-shadow: -8px 0 24px var(--shadow-color);
  z-index: 1500;
  overflow-y: auto;
  color: var(--text-primary);
  padding-bottom: 1rem;
}
.perf:focus { outline: none; }
.perf__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  background: var(--background-light);
  z-index: 1;
}
.perf__header h3 { font-size: 1rem; }
.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
}
.perf__section { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-color); }
.perf__section h4 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); margin-bottom: 0.5rem; }
.perf__hint { font-size: 0.75rem; color: var(--text-secondary); margin: 0.4rem 0; line-height: 1.35; }
.perf__tracks { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.5rem; }
.perf__track {
  border: 1px solid var(--border-color);
  border-top: 4px solid var(--track-color);
  border-radius: 8px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  background: var(--background-dark);
}
.perf__track-name { font-weight: 600; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.perf__track-buttons { display: flex; gap: 0.35rem; }
.perf__big {
  flex: 1;
  min-height: 48px;
  font-size: 1.1rem;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--secondary-color);
  color: var(--text-primary);
  cursor: pointer;
}
.perf__big:disabled { opacity: 0.45; cursor: not-allowed; }
.perf__big--mute.perf__big--on { background: var(--danger-color); border-color: var(--danger-color); color: #fff; }
.perf__big--solo.perf__big--on { background: var(--warning-color); border-color: var(--warning-color); color: #171717; }
.perf__wide {
  width: 100%;
  margin-top: 0.6rem;
  min-height: 48px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--primary-color);
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
}
.perf__wide:disabled { opacity: 0.45; cursor: not-allowed; }
.perf__macro { border: 1px solid var(--border-color); border-radius: 8px; padding: 0.5rem 0.6rem; margin-bottom: 0.6rem; background: var(--background-dark); }
.perf__macro-head { display: flex; align-items: center; gap: 0.5rem; }
.perf__macro-name {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-primary);
  font-weight: 600;
  padding: 0.15rem 0.3rem;
}
.perf__macro-name:hover, .perf__macro-name:focus { border-color: var(--border-color); }
.perf__macro-value { font-variant-numeric: tabular-nums; color: var(--text-secondary); font-size: 0.8rem; }
.perf__macro-slider { width: 100%; height: 32px; accent-color: var(--primary-color); }
.perf__targets { list-style: none; padding: 0; margin: 0.2rem 0; font-size: 0.78rem; }
.perf__targets li { display: flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0; }
.perf__targets li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.perf__target--missing span { color: var(--danger-color); text-decoration: line-through; }
.perf__invert { display: flex; align-items: center; gap: 0.2rem; color: var(--text-secondary); font-size: 0.72rem; }
.perf__remove { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
.perf__assign { display: flex; gap: 0.3rem; margin-top: 0.35rem; flex-wrap: wrap; }
.perf__assign select {
  flex: 1;
  min-width: 0;
  background: var(--background-light);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.25rem;
  font-size: 0.78rem;
}
</style>
