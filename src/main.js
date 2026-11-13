import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { useAuthStore } from './stores/useAuthStore'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Restore the session before the router's first guard: the stored token is
// applied synchronously, then the user is fetched from GET /api/me. If the
// token is rejected, the session is cleared and protected routes go to /login.
const sessionRestored = useAuthStore(pinia).restoreSession()

app.use(router)

sessionRestored.then((result) => {
  if (result.error === 'invalid-token' && router.currentRoute.value.meta.requiresAuth) {
    router.replace('/login')
  }
})

app.mount('#app')
