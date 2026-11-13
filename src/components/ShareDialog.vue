<template>
  <Teleport to="body">
    <div v-if="visible" class="share-overlay" @click.self="close">
      <div
        class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"
        v-trap-focus="close"
      >
        <div class="share-header">
          <h2 id="share-title">Compartir “{{ project?.name }}”</h2>
          <button class="share-close" aria-label="Cerrar" @click="close">×</button>
        </div>

        <p v-if="note" class="share-note">{{ note }}</p>
        <p v-if="loading" class="share-muted">Cargando…</p>
        <p v-else-if="loadError" class="share-error" role="alert">{{ loadError }}</p>

        <template v-else>
          <section class="share-section" aria-labelledby="share-link-title">
            <h3 id="share-link-title">🔗 Enlace de solo lectura</h3>
            <p class="share-muted">
              Cualquiera con el enlace puede escuchar el proyecto y ver el grafo, sin poder editarlo.
              Siempre muestra la versión actual. Si lo revocás, deja de funcionar al instante.
            </p>

            <div v-if="share" class="share-link">
              <label class="sr-only" for="share-url">Enlace para compartir</label>
              <input id="share-url" ref="urlInput" class="share-url" type="text" readonly :value="url" @focus="$event.target.select()" />
              <div class="share-actions">
                <button class="btn" data-autofocus @click="copy">{{ copied ? '✓ Copiado' : '📋 Copiar' }}</button>
                <a class="btn secondary" :href="url" target="_blank" rel="noopener">Abrir</a>
                <button v-if="!confirmRevoke" class="btn danger" :disabled="busy" @click="confirmRevoke = true">Revocar</button>
              </div>
              <div v-if="confirmRevoke" class="share-confirm" role="alert">
                <span>¿Revocar el enlace? Quien lo tenga ya no va a poder abrirlo.</span>
                <button class="btn secondary" @click="confirmRevoke = false">Cancelar</button>
                <button class="btn danger" :disabled="busy" @click="revoke">Sí, revocar</button>
              </div>
            </div>
            <button v-else class="btn" data-autofocus :disabled="busy" @click="create">
              {{ busy ? 'Creando…' : 'Crear enlace' }}
            </button>
          </section>

          <section class="share-section" aria-labelledby="share-gallery-title">
            <h3 id="share-gallery-title">🌐 Galería pública</h3>
            <label class="share-check">
              <input type="checkbox" :checked="isPublic" :disabled="busy" @change="togglePublic($event.target.checked)" />
              Mostrar este proyecto en la galería pública
            </label>
            <p class="share-muted">
              En la galería se ven el nombre del proyecto, tu nombre visible y la cantidad de pistas
              (nunca tu email). Deja de aparecer en cuanto lo desmarcás o borrás el proyecto.
            </p>
          </section>
        </template>

        <div class="share-footer">
          <button class="btn secondary" @click="close">Listo</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * Share dialog (Fase 5A): create / copy / revoke the read-only link of a
 * project and show or hide it in the public gallery. Used from the project
 * list and from the editor toolbar. Emits `changed` with
 * { share_token, is_public } so the caller can update what it shows.
 */
import { ref, computed, watch } from 'vue'
import { vTrapFocus } from '../composables/useFocusTrap.js'
import { useToastStore } from '../stores/useToastStore'
import {
  getShareStatus, createShare, revokeShare, setProjectPublic, shareUrl
} from '../api/sharing.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** { id, name } */
  project: { type: Object, default: null },
  /** Optional notice shown on top (the editor warns about unsaved changes). */
  note: { type: String, default: '' }
})
const emit = defineEmits(['close', 'changed'])

const toastStore = useToastStore()
const loading = ref(false)
const loadError = ref('')
const busy = ref(false)
const share = ref(null)
const isPublic = ref(false)
const copied = ref(false)
const confirmRevoke = ref(false)
const urlInput = ref(null)

const url = computed(() => shareUrl(share.value))

async function load() {
  if (!props.project?.id) return
  loading.value = true
  loadError.value = ''
  copied.value = false
  confirmRevoke.value = false
  const result = await getShareStatus(props.project.id)
  loading.value = false
  if (!result.success) {
    loadError.value = result.error
    return
  }
  share.value = result.share
  isPublic.value = result.isPublic
}

watch(() => [props.visible, props.project?.id], ([visible]) => { if (visible) load() }, { immediate: true })

function notify() {
  emit('changed', { share_token: share.value?.token ?? null, is_public: isPublic.value ? 1 : 0 })
}

async function create() {
  busy.value = true
  const result = await createShare(props.project.id)
  busy.value = false
  if (!result.success) return toastStore.error(result.error)
  share.value = result.share
  notify()
  toastStore.success('Enlace creado')
}

async function revoke() {
  busy.value = true
  const result = await revokeShare(props.project.id)
  busy.value = false
  confirmRevoke.value = false
  if (!result.success) return toastStore.error(result.error)
  share.value = null
  copied.value = false
  notify()
  toastStore.info('Enlace revocado: ya no funciona')
}

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
  } catch {
    // Without clipboard permission: select the text so Ctrl+C works.
    urlInput.value?.select()
    toastStore.info('Seleccioná el enlace y copialo con Ctrl+C')
    return
  }
  copied.value = true
  toastStore.success('Enlace copiado')
}

async function togglePublic(value) {
  busy.value = true
  const result = await setProjectPublic(props.project.id, value)
  busy.value = false
  if (!result.success) {
    toastStore.error(result.error)
    return
  }
  isPublic.value = result.isPublic
  notify()
  toastStore.success(result.isPublic ? 'Publicado en la galería' : 'Quitado de la galería')
}

function close() {
  emit('close')
}
</script>

<style scoped>
.share-overlay {
  position: fixed;
  inset: 0;
  background: var(--background-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}

.share-dialog {
  background: var(--background-light);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  width: 100%;
  max-width: 520px;
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  margin: 1rem;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 8px 32px var(--shadow-color);
}

.share-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.share-header h2 {
  font-size: 1.1rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.share-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
}

.share-section {
  margin-top: 1.1rem;
}

.share-section h3 {
  font-size: 0.95rem;
  margin: 0 0 0.35rem;
}

.share-muted {
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.45;
  margin: 0.3rem 0 0.6rem;
}

.share-note {
  margin: 0.75rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--warning-color);
  font-size: 0.8rem;
}

.share-error {
  color: var(--danger-color);
  margin: 1rem 0;
}

.share-url {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--background-dark);
  color: var(--text-primary);
  font-family: monospace;
  font-size: 0.8rem;
}

.share-actions,
.share-confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.6rem;
  align-items: center;
}

.share-confirm span {
  flex-basis: 100%;
  font-size: 0.8rem;
}

.share-actions a.btn {
  text-decoration: none;
}

.share-check {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.9rem;
  cursor: pointer;
}

.share-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.25rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
