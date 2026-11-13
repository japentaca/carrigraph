/**
 * Where to go after logging in (Fase 5A: the shared view and the gallery send
 * people to /login?redirect=…). Only same-app paths are accepted: "/x", never
 * "//host", a backslash trick or a full URL (no open redirect).
 */
export function safeRedirect(value, fallback = '/projects') {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : fallback
}
