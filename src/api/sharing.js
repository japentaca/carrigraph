/**
 * Sharing, gallery and profile endpoints (Fase 5A). Every function resolves
 * to { success: true, ...data } or { success: false, error, status }.
 */
import http from './http.js'

const fail = (error, fallback) => ({
  success: false,
  status: error.response?.status ?? null,
  error: error.friendlyMessage || error.response?.data?.message || fallback
})

async function call(fn, fallback) {
  try {
    return { success: true, ...(await fn()) }
  } catch (error) {
    return fail(error, fallback)
  }
}

/** Absolute URL of a share path ("/s/<token>") for the current origin. */
export function shareUrl(share, origin = globalThis.location?.origin ?? '') {
  return share?.token ? `${origin}/s/${share.token}` : ''
}

// --- Owner -------------------------------------------------------------------

export const getShareStatus = (projectId) => call(async () => {
  const { data } = await http.get(`/projects/${projectId}/share`)
  return { share: data.share, isPublic: !!data.is_public, publishedAt: data.published_at }
}, 'No se pudo leer el estado del enlace')

export const createShare = (projectId) => call(async () => {
  const { data } = await http.post(`/projects/${projectId}/share`)
  return { share: data.share }
}, 'No se pudo crear el enlace')

export const revokeShare = (projectId) => call(async () => {
  await http.delete(`/projects/${projectId}/share`)
  return { share: null }
}, 'No se pudo revocar el enlace')

export const setProjectPublic = (projectId, isPublic) => call(async () => {
  const { data } = await http.put(`/projects/${projectId}/public`, { public: !!isPublic })
  return { isPublic: !!data.is_public, publishedAt: data.published_at }
}, 'No se pudo cambiar la visibilidad')

// --- Public ------------------------------------------------------------------

export const fetchShared = (token) => call(async () => {
  const { data } = await http.get(`/shared/${encodeURIComponent(token)}`, { skipAuthRedirect: true })
  return { data }
}, 'No se pudo abrir el enlace')

export const fetchGalleryProject = (id) => call(async () => {
  const { data } = await http.get(`/gallery/${encodeURIComponent(id)}`, { skipAuthRedirect: true })
  return { data }
}, 'No se pudo abrir el proyecto')

export const fetchGallery = ({ page = 1, limit = 12 } = {}) => call(async () => {
  const { data } = await http.get('/gallery', { params: { page, limit }, skipAuthRedirect: true })
  return { data }
}, 'No se pudo cargar la galería')

/** Copy a shared ({ kind: 'shared', token }) or gallery ({ kind: 'gallery', id }) project. */
export const copyPublicProject = ({ kind, token, id }) => call(async () => {
  const path = kind === 'shared' ? `/shared/${encodeURIComponent(token)}/copy` : `/gallery/${encodeURIComponent(id)}/copy`
  const { data } = await http.post(path)
  return { project: data }
}, 'No se pudo hacer la copia')

// --- Profile -----------------------------------------------------------------

// A wrong current password answers 401: it must not end the session
// (skipAuthRedirect, see http.js).
export const changePassword = (currentPassword, newPassword) => call(async () => {
  await http.put('/change-password', { currentPassword, newPassword }, { skipAuthRedirect: true })
  return {}
}, 'No se pudo cambiar la contraseña')

export const deleteAccount = (password) => call(async () => {
  await http.delete('/account', { data: { password }, skipAuthRedirect: true })
  return {}
}, 'No se pudo borrar la cuenta')
