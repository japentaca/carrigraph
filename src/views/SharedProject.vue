<template>
  <div class="shared">
    <header class="shared__header">
      <div class="shared__nav">
        <router-link class="shared__brand" to="/gallery">🎛️ CarriGraph</router-link>
        <router-link v-if="kind === 'gallery'" class="shared__navlink" to="/gallery">← Galería</router-link>
        <router-link v-if="authStore.isAuthenticated" class="shared__navlink" to="/projects">Mis proyectos</router-link>
      </div>

      <div v-if="project" class="shared__title">
        <h1>{{ project.name }}</h1>
        <p class="shared__meta">
          <span v-if="author">por {{ author }}</span>
          <span class="shared__badge" title="No se puede editar ni guardar">Solo lectura</span>
          <span>{{ trackLabel }}</span>
        </p>
        <p v-if="project.description" class="shared__desc">{{ project.description }}</p>
      </div>

      <div v-if="project" class="shared__actions">
        <button
          v-if="authStore.isAuthenticated"
          class="btn" :disabled="copying" @click="makeCopy"
        >
          {{ copying ? 'Copiando…' : '📄 Hacer una copia' }}
        </button>
        <template v-else>
          <button class="btn" title="Abrir en el editor sin cuenta: los cambios no se guardan" @click="editAsGuest">
            ✏️ Editar como invitado
          </button>
          <router-link class="btn secondary" :to="{ path: '/login', query: { redirect: route.fullPath } }">
            Iniciá sesión para hacer una copia
          </router-link>
        </template>
      </div>
    </header>

    <div v-if="loading" class="shared__state" role="status">Cargando…</div>
    <div v-else-if="error" class="shared__state" role="alert">
      <div class="shared__state-icon" aria-hidden="true">🔒</div>
      <h2>{{ error.title }}</h2>
      <p>{{ error.message }}</p>
      <router-link class="btn secondary" to="/gallery">Ir a la galería</router-link>
    </div>

    <template v-else-if="project">
      <TransportBar :transport="player" readonly />
      <main class="shared__graph">
        <ReadOnlyGraph
          :flow-id="`cg-shared-${kind}`"
          :nodes="project.nodes"
          :edges="project.edges"
        />
      </main>
      <TimelinePanel :compiled="player.compiled.value" readonly />
    </template>
  </div>
</template>

<script setup>
/**
 * Read-only player (Fase 5A) for `/s/:token` (shared link) and
 * `/gallery/:id` (public gallery): the graph drawn read-only, transport and
 * piano roll. Nothing can be edited or saved; the project store is not
 * touched. Signed-in users can make their own copy.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useToastStore } from '../stores/useToastStore'
import { fetchShared, fetchGalleryProject, copyPublicProject } from '../api/sharing.js'
import { preparePublicProject } from '../sharing/publicProject.js'
import { usePublicPlayer } from '../composables/usePublicPlayer.js'
import ReadOnlyGraph from '../components/ReadOnlyGraph.vue'
import TransportBar from '../components/editor/TransportBar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'

const props = defineProps({
  /** 'shared' (/s/:token) or 'gallery' (/gallery/:id) */
  kind: { type: String, default: 'shared' }
})

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toastStore = useToastStore()

const project = ref(null)
const author = ref('')
const loading = ref(true)
const error = ref(null)
const copying = ref(false)

const player = usePublicPlayer(project)

const trackLabel = computed(() => {
  const n = player.compiled.value.score.tracks.length
  return `${n} ${n === 1 ? 'pista' : 'pistas'} · ${project.value?.settings.tempo} BPM`
})

const key = computed(() => (props.kind === 'shared' ? route.params.token : route.params.id))

async function load() {
  loading.value = true
  error.value = null
  project.value = null
  const result = props.kind === 'shared'
    ? await fetchShared(key.value)
    : await fetchGalleryProject(key.value)
  loading.value = false
  if (!result.success) {
    error.value = result.status === 404
      ? (props.kind === 'shared'
        ? { title: 'Enlace no disponible', message: 'Este enlace no existe o su dueño lo revocó.' }
        : { title: 'Proyecto no disponible', message: 'Este proyecto no existe o ya no está en la galería.' })
      : { title: 'No se pudo abrir', message: result.error }
    return
  }
  const prepared = preparePublicProject(result.data)
  if (!prepared.ok) {
    error.value = { title: 'No se puede mostrar', message: prepared.error }
    return
  }
  project.value = prepared.project
  author.value = prepared.author
  document.title = `${prepared.project.name} · CarriGraph`
}

watch(key, load, { immediate: true })

// The tab shows the project name while here; the app title comes back when leaving.
const previousTitle = document.title
onBeforeUnmount(() => { document.title = previousTitle })

/** Guest mode: the project opens in the editor; changes are never saved. */
function editAsGuest() {
  authStore.enterGuest()
  router.push(props.kind === 'shared'
    ? `/editor/shared/${encodeURIComponent(route.params.token)}`
    : `/editor/gallery/${route.params.id}`)
}

async function makeCopy() {
  copying.value = true
  const result = await copyPublicProject({ kind: props.kind, token: route.params.token, id: route.params.id })
  copying.value = false
  if (!result.success) {
    toastStore.error(result.error)
    return
  }
  toastStore.success('Copia creada en tus proyectos')
  router.push(`/editor/${result.project.id}`)
}
</script>

<style scoped>
.shared {
  /* flex item of the app layout (.app-root, a column): take the whole width */
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--background-dark);
  color: var(--text-primary);
}

.shared__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.5rem;
  padding: 0.75rem 1rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
}

.shared__nav {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.shared__brand {
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}

.shared__navlink {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.85rem;
}

.shared__navlink:hover,
.shared__brand:hover {
  text-decoration: underline;
}

.shared__title {
  flex: 1;
  min-width: 14rem;
}

.shared__title h1 {
  font-size: 1.15rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.shared__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0.2rem 0 0;
}

.shared__badge {
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0 0.5rem;
}

.shared__desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0.3rem 0 0;
}

.shared__actions .btn {
  text-decoration: none;
  display: inline-block;
}

.shared__graph {
  flex: 1;
  min-height: 200px;
  position: relative;
}

.shared__state {
  margin: auto;
  text-align: center;
  padding: 2rem 1rem;
  max-width: 28rem;
  color: var(--text-secondary);
}

.shared__state h2 {
  color: var(--text-primary);
  margin: 0.5rem 0;
}

.shared__state p {
  margin-bottom: 1rem;
}

.shared__state-icon {
  font-size: 2.5rem;
}

.shared__state .btn {
  text-decoration: none;
  display: inline-block;
}
</style>
