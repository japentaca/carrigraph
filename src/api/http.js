import axios from 'axios'
import { translateServerMessage } from './messages.js'

const http = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor — attach token from localStorage
http.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor — normalize errors
http.interceptors.response.use(
  (response) => response,
  (error) => {
    // Network error (no response at all)
    if (!error.response) {
      error.friendlyMessage = 'No se pudo conectar con el servidor. Verificá tu conexión.'
      return Promise.reject(error)
    }

    const { status, data } = error.response
    // The API answers in English; show the Spanish version when there is one.
    const serverMessage = translateServerMessage(data?.message)

    switch (status) {
      case 401:
        // Requests that answer 401 for a reason other than the session (a
        // wrong current password in the profile) or public pages opt out.
        if (error.config?.skipAuthRedirect) {
          error.friendlyMessage = serverMessage || 'No autorizado.'
          break
        }
        // Token expired or invalid — clear auth and redirect
        localStorage.removeItem('token')
        delete http.defaults.headers.common['Authorization']
        // Only redirect if not already on login page
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
        error.friendlyMessage = serverMessage || 'Sesión expirada. Iniciá sesión de nuevo.'
        break
      case 403:
        error.friendlyMessage = serverMessage || 'No tenés permiso para esta acción.'
        break
      case 404:
        error.friendlyMessage = serverMessage || 'Recurso no encontrado.'
        break
      case 409:
        error.friendlyMessage = serverMessage || 'Conflicto — el recurso ya existe.'
        break
      case 422:
        error.friendlyMessage = serverMessage || 'Datos inválidos.'
        break
      case 500:
      case 502:
      case 503:
        error.friendlyMessage = 'Error interno del servidor. Intentá de nuevo más tarde.'
        break
      default:
        error.friendlyMessage = serverMessage || 'Ocurrió un error inesperado.'
    }

    return Promise.reject(error)
  }
)

export default http
