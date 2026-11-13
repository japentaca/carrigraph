<template>
  <div class="profile">
    <header class="profile__header">
      <router-link class="btn secondary" to="/projects">← Proyectos</router-link>
      <h1>Perfil</h1>
    </header>

    <main class="profile__content">
      <section class="profile__card" aria-labelledby="profile-account">
        <h2 id="profile-account">Cuenta</h2>
        <p><strong>{{ authStore.currentUser?.name }}</strong></p>
        <p class="profile__muted">{{ authStore.currentUser?.email }}</p>
      </section>

      <section class="profile__card" aria-labelledby="profile-password">
        <h2 id="profile-password">Cambiar contraseña</h2>
        <form class="profile__form" novalidate @submit.prevent="submitPassword">
          <label for="pw-current">Contraseña actual</label>
          <input id="pw-current" v-model="pw.current" type="password" autocomplete="current-password" required />

          <label for="pw-new">Contraseña nueva <span class="profile__muted">(mínimo {{ MIN_PASSWORD }} caracteres)</span></label>
          <input id="pw-new" v-model="pw.next" type="password" autocomplete="new-password" :minlength="MIN_PASSWORD" required />

          <label for="pw-confirm">Repetí la contraseña nueva</label>
          <input id="pw-confirm" v-model="pw.confirm" type="password" autocomplete="new-password" required />

          <p v-if="pwError" class="profile__error" role="alert">{{ pwError }}</p>
          <button type="submit" class="btn" :disabled="pwBusy">{{ pwBusy ? 'Guardando…' : 'Cambiar contraseña' }}</button>
        </form>
      </section>

      <section class="profile__card profile__card--danger" aria-labelledby="profile-delete">
        <h2 id="profile-delete">Borrar la cuenta</h2>
        <p class="profile__muted">
          Se borran tu cuenta, <strong>{{ projectCountText }}</strong> con todo su historial de versiones,
          sus enlaces compartidos y lo que hayas publicado en la galería. No se puede deshacer.
        </p>
        <form class="profile__form" novalidate @submit.prevent="askDelete">
          <label for="del-password">Contraseña actual</label>
          <input id="del-password" v-model="del.password" type="password" autocomplete="current-password" required />
          <label class="profile__check">
            <input v-model="del.understood" type="checkbox" />
            Entiendo que se borra todo y no se puede recuperar
          </label>
          <p v-if="delError" class="profile__error" role="alert">{{ delError }}</p>
          <button type="submit" class="btn danger" :disabled="delBusy || !del.understood || !del.password">
            Borrar mi cuenta
          </button>
        </form>
      </section>
    </main>

    <ConfirmDialog
      :visible="confirmDelete"
      title="¿Borrar tu cuenta para siempre?"
      :message="`Se borran tu cuenta y ${projectCountText}, con sus versiones y enlaces. No hay vuelta atrás.`"
      confirm-text="Sí, borrar mi cuenta"
      cancel-text="Cancelar"
      type="danger"
      :loading="delBusy"
      @confirm="doDelete"
      @cancel="confirmDelete = false"
    />
  </div>
</template>

<script setup>
/**
 * Profile (Fase 5A): change the password (PUT /api/change-password) and
 * delete the account (DELETE /api/account, asks for the current password and
 * an explicit confirmation; the server deletes projects, versions and links).
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useToastStore } from '../stores/useToastStore'
import { changePassword, deleteAccount } from '../api/sharing.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const MIN_PASSWORD = 8

const router = useRouter()
const authStore = useAuthStore()
const projectStore = useProjectStore()
const toastStore = useToastStore()

const pw = reactive({ current: '', next: '', confirm: '' })
const pwError = ref('')
const pwBusy = ref(false)

const del = reactive({ password: '', understood: false })
const delError = ref('')
const delBusy = ref(false)
const confirmDelete = ref(false)

onMounted(() => { projectStore.fetchProjects() })

const projectCountText = computed(() => {
  const n = projectStore.projects.length
  return n === 1 ? 'tu proyecto' : `tus ${n} proyectos`
})

/** Validation of the change-password form before calling the server. */
function passwordFormError({ current, next, confirm }) {
  if (!current) return 'Escribí tu contraseña actual'
  if (next.length < MIN_PASSWORD) return `La contraseña nueva tiene que tener al menos ${MIN_PASSWORD} caracteres`
  if (next !== confirm) return 'Las contraseñas nuevas no coinciden'
  if (next === current) return 'La contraseña nueva tiene que ser distinta de la actual'
  return ''
}

async function submitPassword() {
  pwError.value = passwordFormError(pw)
  if (pwError.value) return
  pwBusy.value = true
  const result = await changePassword(pw.current, pw.next)
  pwBusy.value = false
  if (!result.success) {
    pwError.value = result.status === 401 ? 'La contraseña actual no es correcta' : result.error
    return
  }
  pw.current = pw.next = pw.confirm = ''
  toastStore.success('Contraseña cambiada')
}

function askDelete() {
  delError.value = ''
  if (!del.password) {
    delError.value = 'Escribí tu contraseña actual'
    return
  }
  if (!del.understood) {
    delError.value = 'Marcá la casilla para confirmar'
    return
  }
  confirmDelete.value = true
}

async function doDelete() {
  delBusy.value = true
  const result = await deleteAccount(del.password)
  delBusy.value = false
  confirmDelete.value = false
  if (!result.success) {
    delError.value = result.status === 401 ? 'La contraseña no es correcta' : result.error
    return
  }
  authStore.clearSession()
  projectStore.$reset()
  toastStore.info('Tu cuenta fue borrada')
  router.push('/login')
}
</script>

<style scoped>
.profile {
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

.profile__header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
}

.profile__header h1 {
  margin: 0;
  font-size: 1.4rem;
}

.profile__header .btn {
  text-decoration: none;
}

.profile__content {
  max-width: 560px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.profile__card {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 1.25rem;
}

.profile__card--danger {
  border-color: var(--danger-color);
}

.profile__card h2 {
  font-size: 1.05rem;
  margin: 0 0 0.75rem;
}

.profile__muted {
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.45;
}

.profile__form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.profile__form label {
  font-size: 0.85rem;
}

.profile__form input[type='password'] {
  padding: 0.55rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--background-dark);
  color: var(--text-primary);
  font-size: 16px;
  margin-bottom: 0.4rem;
}

.profile__form .btn {
  align-self: flex-start;
  margin-top: 0.4rem;
}

.profile__check {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.profile__error {
  color: var(--danger-color);
  font-size: 0.85rem;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
