<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1>CarriGraph</h1>
        <p>Música generativa con grafos de nodos</p>
        <button @click="toggleTheme" class="theme-toggle-btn" type="button" :aria-label="isDark() ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'" :title="isDark() ? 'Modo claro' : 'Modo oscuro'">
          {{ isDark() ? '☀️' : '🌙' }}
        </button>
      </div>
      
      <form @submit.prevent="handleSubmit" class="login-form">
        <div class="form-tabs">
          <button 
            type="button" 
            :class="['tab-btn', { active: isLogin }]"
            :aria-pressed="isLogin"
            @click="isLogin = true"
          >
            Ingresar
          </button>
          <button 
            type="button" 
            :class="['tab-btn', { active: !isLogin }]"
            :aria-pressed="!isLogin"
            @click="isLogin = false"
          >
            Crear cuenta
          </button>
        </div>
        
        <div class="form-fields">
          <div v-if="!isLogin" class="form-group">
            <label class="form-label" for="login-name">Nombre</label>
            <input 
              id="login-name"
              autocomplete="name"
              v-model="form.name"
              type="text" 
              class="form-input"
              placeholder="Tu nombre"
              required
            />
          </div>
          
          <div class="form-group">
            <label class="form-label" for="login-email">Email</label>
            <input 
              id="login-email"
              autocomplete="email"
              v-model="form.email"
              type="email" 
              class="form-input"
              placeholder="tu@email.com"
              required
            />
          </div>
          
          <div class="form-group">
            <label class="form-label" for="login-password">Contraseña</label>
            <input 
              id="login-password"
              :autocomplete="isLogin ? 'current-password' : 'new-password'"
              v-model="form.password"
              type="password" 
              class="form-input"
              :placeholder="isLogin ? 'Tu contraseña' : 'Al menos 8 caracteres'"
              required
            />
          </div>
          
          <div v-if="!isLogin" class="form-group">
            <label class="form-label" for="login-confirm">Repetir contraseña</label>
            <input 
              id="login-confirm"
              autocomplete="new-password"
              v-model="form.confirmPassword"
              type="password" 
              class="form-input"
              placeholder="Repetí la contraseña"
              required
            />
          </div>
        </div>
        
        <div v-if="authStore.error" class="error-message" role="alert">
          {{ authStore.error }}
        </div>
        
        <button 
          type="submit" 
          class="submit-btn"
          :disabled="authStore.isLoading"
        >
          <span v-if="authStore.isLoading">Procesando…</span>
          <span v-else>{{ isLogin ? 'Ingresar' : 'Crear cuenta' }}</span>
        </button>
      </form>

      <div class="guest-entry">
        <button type="button" class="guest-btn" @click="enterAsGuest">Entrar como invitado</button>
        <p class="guest-hint">Sin cuenta: podés abrir proyectos públicos y modificarlos, pero los cambios no se guardan.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { safeRedirect } from '../router/redirect.js'
import { useAuthStore } from '../stores/useAuthStore'
import { useTheme } from '../composables/useTheme.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { isDark, toggle: toggleTheme } = useTheme()

const isLogin = ref(true)
const form = reactive({
  name: '',
  email: '',
  password: '',
  confirmPassword: ''
})

// Clear error when switching between login/register
watch(isLogin, () => {
  authStore.clearError()
  form.name = ''
  form.email = ''
  form.password = ''
  form.confirmPassword = ''
})

/** Guest mode: no credentials. Goes to the gallery (or back to a page a guest may see). */
const enterAsGuest = () => {
  authStore.clearError()
  authStore.enterGuest()
  const target = safeRedirect(route.query.redirect, '/gallery')
  const resolved = router.resolve(target)
  const allowed = !resolved.meta.requiresAuth ||
    (resolved.meta.allowGuest && !(resolved.name === 'Editor' && resolved.params.id))
  router.push(allowed ? target : '/gallery')
}

const handleSubmit = async () => {
  authStore.clearError()
  
  if (!isLogin.value) {
    // Validate registration form
    if (form.password !== form.confirmPassword) {
      authStore.error = 'Las contraseñas no coinciden'
      return
    }
    
    if (form.password.length < 8) {
      authStore.error = 'La contraseña debe tener al menos 8 caracteres'
      return
    }
  }
  
  const credentials = {
    email: form.email,
    password: form.password
  }
  
  if (!isLogin.value) {
    credentials.name = form.name
  }
  
  const result = isLogin.value 
    ? await authStore.login(credentials)
    : await authStore.register(credentials)
  
  if (result.success) {
    router.push(safeRedirect(route.query.redirect))
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  height: 100%;
  overflow-y: auto;
  background: var(--background-dark);
  padding: 2rem;
}

.login-card {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 2rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 8px 32px var(--shadow-color, rgba(0, 0, 0, 0.3));
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-header h1 {
  color: var(--primary-color);
  font-size: 2rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.login-header p {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.theme-toggle-btn {
  background: var(--secondary-color);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 2.5rem;
  height: 2.5rem;
  font-size: 1.25rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.75rem;
  transition: background 0.2s ease;
}

.theme-toggle-btn:hover {
  background: var(--secondary-hover);
}

.form-tabs {
  display: flex;
  margin-bottom: 2rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.tab-btn {
  flex: 1;
  padding: 0.75rem;
  background: var(--background-dark);
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: var(--primary-color);
  color: white;
}

.tab-btn:hover:not(.active) {
  background: var(--secondary-color);
  color: var(--text-primary);
}

.form-fields {
  margin-bottom: 1.5rem;
}

.error-message {
  background: color-mix(in srgb, var(--danger-color) 10%, transparent);
  border: 1px solid var(--danger-color);
  color: var(--danger-color);
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.submit-btn {
  width: 100%;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.875rem;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.guest-entry {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-color);
  text-align: center;
}

.guest-btn {
  width: 100%;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.guest-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.guest-hint {
  margin-top: 0.6rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
</style>
<style scoped>
/* Phones (Fase 4B): less padding, the card uses the whole width and the
   page scrolls when the on-screen keyboard is open. */
@media (max-width: 480px) {
  .login-container { padding: 1rem 0.75rem; align-items: flex-start; }
  .login-card { padding: 1.25rem; border-radius: 10px; }
  .login-header { margin-bottom: 1.25rem; }
  .login-header h1 { font-size: 1.6rem; }
  .form-tabs { margin-bottom: 1.25rem; }
  .form-input { font-size: 16px; } /* no zoom on focus in iOS */
}
</style>
