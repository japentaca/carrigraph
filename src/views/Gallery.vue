<template>
  <div class="gallery">
    <header class="gallery__header">
      <div class="gallery__head">
        <h1>🌐 Galería</h1>
        <p class="gallery__sub">Proyectos que sus autores publicaron. Escuchalos acá mismo o abrilos para ver el grafo.</p>
      </div>
      <nav class="gallery__nav" aria-label="Navegación">
        <router-link v-if="authStore.isAuthenticated" class="btn secondary" to="/projects">Mis proyectos</router-link>
        <template v-else>
          <span v-if="authStore.isGuest" class="gallery__guest" title="Podés abrir y modificar proyectos, pero los cambios no se guardan">Modo invitado</span>
          <button class="btn secondary" title="Editor en blanco como invitado: no se guarda" @click="newAsGuest">Proyecto nuevo (sin guardar)</button>
          <router-link class="btn secondary" :to="{ path: '/login', query: { redirect: '/gallery' } }">Iniciar sesión</router-link>
        </template>
      </nav>
    </header>

    <main class="gallery__content">
      <p v-if="loading && !items.length" class="gallery__state" role="status">Cargando…</p>
      <div v-else-if="error" class="gallery__state" role="alert">
        <p>{{ error }}</p>
        <button class="btn secondary" @click="load">Reintentar</button>
      </div>
      <div v-else-if="!items.length" class="gallery__state">
        <div class="gallery__icon" aria-hidden="true">🎵</div>
        <p>Todavía no hay proyectos publicados.</p>
        <p class="gallery__hint">Publicá uno desde “Compartir” en tus proyectos.</p>
      </div>

      <ul v-else class="gallery__grid" aria-label="Proyectos publicados">
        <li v-for="item in items" :key="item.id" class="gallery__card">
          <h2 class="gallery__name">{{ item.name }}</h2>
          <p class="gallery__author">por {{ item.author || 'anónimo' }}</p>
          <p v-if="item.description" class="gallery__desc">{{ item.description }}</p>
          <p class="gallery__meta">
            <span>{{ trackText(item.track_count) }}</span>
            <span>📅 {{ formatDate(item.published_at || item.updated_at) }}</span>
          </p>
          <div class="gallery__actions">
            <button
              class="btn"
              :class="{ 'gallery__play--on': playingId === item.id }"
              :disabled="loadingId === item.id || item.track_count === 0"
              :aria-pressed="playingId === item.id"
              :aria-label="playingId === item.id ? `Detener ${item.name}` : `Escuchar ${item.name}`"
              @click="togglePlay(item)"
            >
              {{ loadingId === item.id ? '⏳' : (playingId === item.id ? '⏹ Detener' : '▶ Escuchar') }}
            </button>
            <router-link class="btn secondary" :to="`/gallery/${item.id}`" :aria-label="`Abrir ${item.name}`">Abrir</router-link>
            <button
              v-if="!authStore.isAuthenticated"
              class="btn secondary"
              title="Abrir en el editor como invitado: los cambios no se guardan"
              :aria-label="`Editar ${item.name} como invitado (sin guardar)`"
              @click="editAsGuest(item)"
            >
              ✏️ Editar
            </button>
          </div>
        </li>
      </ul>

      <nav v-if="pages > 1" class="gallery__pager" aria-label="Páginas">
        <button class="btn secondary" :disabled="page <= 1 || loading" @click="goTo(page - 1)">← Anterior</button>
        <span>Página {{ page }} de {{ pages }}</span>
        <button class="btn secondary" :disabled="page >= pages || loading" @click="goTo(page + 1)">Siguiente →</button>
      </nav>
    </main>
  </div>
</template>

<script setup>
/**
 * Public gallery (Fase 5A): paginated list of public projects (name, author,
 * track count, date) with direct playback and a link to the read-only view.
 * Works without a session.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useAudioStore } from '../stores/useAudioStore'
import { useToastStore } from '../stores/useToastStore'
import { fetchGallery, fetchGalleryProject } from '../api/sharing.js'
import { preparePublicProject } from '../sharing/publicProject.js'
import { playPublicProject } from '../composables/usePublicPlayer.js'

const PAGE_SIZE = 12

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const audioStore = useAudioStore()
const toastStore = useToastStore()

const items = ref([])
const page = ref(1)
const pages = ref(1)
const loading = ref(false)
const error = ref('')
const playingId = ref(null)
const loadingId = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  const requested = Math.max(1, parseInt(route.query.page, 10) || 1)
  const result = await fetchGallery({ page: requested, limit: PAGE_SIZE })
  loading.value = false
  if (!result.success) {
    error.value = result.error
    return
  }
  items.value = result.data.items
  page.value = result.data.page
  pages.value = result.data.pages
}

watch(() => route.query.page, load, { immediate: true })

// Guest mode (no account): the editor opens, nothing is saved.
function editAsGuest(item) {
  authStore.enterGuest()
  router.push(`/editor/gallery/${item.id}`)
}

function newAsGuest() {
  authStore.enterGuest()
  router.push('/editor')
}

function goTo(n) {
  router.push({ path: '/gallery', query: n > 1 ? { page: n } : {} })
}

// The audio store stops by itself in one-pass mode or from elsewhere.
watch(() => audioStore.isPlaying, (playing) => { if (!playing) playingId.value = null })

async function togglePlay(item) {
  if (playingId.value === item.id) {
    audioStore.stop()
    playingId.value = null
    return
  }
  loadingId.value = item.id
  const result = await fetchGalleryProject(item.id)
  if (!result.success) {
    loadingId.value = null
    toastStore.error(result.status === 404 ? 'Ese proyecto ya no está en la galería' : result.error)
    if (result.status === 404) load()
    return
  }
  const prepared = preparePublicProject(result.data)
  if (!prepared.ok) {
    loadingId.value = null
    toastStore.error(prepared.error)
    return
  }
  try {
    const ok = await playPublicProject(prepared.project, audioStore)
    playingId.value = ok && audioStore.isPlaying ? item.id : null
    if (!ok) toastStore.info('Este proyecto no tiene pistas que suenen')
  } catch (err) {
    console.error(err)
    toastStore.error('Error al reproducir audio')
  } finally {
    loadingId.value = null
  }
}

onBeforeUnmount(() => {
  if (playingId.value != null) audioStore.stop()
})

const trackText = (n) => (n == null ? '¿? pistas' : `🎚️ ${n} ${n === 1 ? 'pista' : 'pistas'}`)

/** SQLite dates are UTC without a zone. */
function formatDate(value) {
  if (!value) return ''
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<style scoped>
.gallery {
  /* flex item of the app layout (.app-root, a column): take the whole width */
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  background: var(--background-dark);
  color: var(--text-primary);
}

.gallery__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
}

.gallery__head h1 {
  margin: 0;
  font-size: 1.5rem;
}

.gallery__sub {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.gallery__nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.gallery__nav .btn,
.gallery__actions .btn {
  text-decoration: none;
  display: inline-block;
}

.gallery__content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}

.gallery__state {
  text-align: center;
  color: var(--text-secondary);
  padding: 3rem 1rem;
}

.gallery__icon {
  font-size: 2.5rem;
}

.gallery__hint {
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.gallery__grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.gallery__card {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.gallery__name {
  font-size: 1.05rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.gallery__author,
.gallery__meta {
  color: var(--text-secondary);
  font-size: 0.8rem;
  margin: 0;
}

.gallery__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.gallery__desc {
  font-size: 0.85rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.gallery__guest {
  align-self: center;
  font-size: 0.8rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--warning-color);
  color: var(--warning-color);
  border-radius: 999px;
  white-space: nowrap;
}

.gallery__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.5rem;
}

.gallery__play--on {
  background: var(--danger-color);
  border-color: var(--danger-color);
}

.gallery__pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 1.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

@media (max-width: 600px) {
  .gallery__header,
  .gallery__content {
    padding: 1rem;
  }
}
</style>
