// Fase 5A — the 401 handler of the HTTP client: a request marked
// skipAuthRedirect (wrong current password in the profile, public pages)
// keeps the session; any other 401 still ends it.
import { describe, it, expect, beforeEach } from 'vitest'
import http from '../api/http.js'

const rejected = http.interceptors.response.handlers.find(h => h?.rejected).rejected
const error401 = (config = {}) => Object.assign(new Error('401'), {
  config, response: { status: 401, data: { message: 'Current password is incorrect' } }
})

describe('http 401 handling', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'jwt')
    window.history.replaceState(null, '', '/login') // avoid a real navigation in jsdom
  })

  it('skipAuthRedirect keeps the token', async () => {
    const err = await rejected(error401({ skipAuthRedirect: true })).catch(e => e)
    expect(localStorage.getItem('token')).toBe('jwt')
    expect(err.friendlyMessage).toBe('La contraseña actual no es correcta.') // Fase 5B: mensajes del servidor traducidos en la UI
  })

  it('a plain 401 clears the session as before', async () => {
    await rejected(error401()).catch(e => e)
    expect(localStorage.getItem('token')).toBe(null)
  })
})
