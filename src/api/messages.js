// Spanish (rioplatense) versions of the error messages the API answers in
// English. The API keeps its English messages (server tests and API clients
// rely on them); the UI translates the ones it shows. Unknown messages pass
// through unchanged. Pure module (Fase 5B).

const EXACT = {
  'Name, email, and password are required': 'Completá nombre, email y contraseña.',
  'Please provide a valid email address': 'Ingresá un email válido.',
  'User with this email already exists': 'Ya existe una cuenta con ese email.',
  'Email and password are required': 'Completá email y contraseña.',
  'Invalid email or password': 'Email o contraseña incorrectos.',
  'Current password and new password are required': 'Completá la contraseña actual y la nueva.',
  'User not found': 'No se encontró el usuario.',
  'Current password is incorrect': 'La contraseña actual no es correcta.',
  'Name and email are required': 'Completá nombre y email.',
  'Email is already taken by another user': 'Ese email ya lo usa otra cuenta.',
  'Password is required to delete account': 'Ingresá tu contraseña para borrar la cuenta.',
  'Password is incorrect': 'La contraseña no es correcta.',
  Unauthorized: 'No autorizado.',
  'Authentication error': 'Error de autenticación.',
  'Invalid or expired token': 'La sesión expiró. Iniciá sesión de nuevo.',
  'Route not found': 'Recurso no encontrado.',
  'Invalid JSON body': 'El pedido no es JSON válido.',
  'Request body too large (max 1 MB)': 'El proyecto es demasiado grande para guardarlo (máximo 1 MB).',
  'Internal server error': 'Error interno del servidor. Intentá de nuevo más tarde.',
  'Project not found': 'No se encontró el proyecto.',
  'Access denied - you do not own this project': 'Ese proyecto no es tuyo.',
  'Invalid project ID': 'Identificador de proyecto inválido.',
  'Metadata must be an object': 'Los metadatos del proyecto no son válidos.',
  'The project was modified elsewhere since it was loaded':
    'El proyecto se modificó en otro lado desde que lo abriste.',
  'New project name is required': 'Ingresá un nombre para el proyecto.',
  'Project name must be 100 characters or less': 'El nombre puede tener hasta 100 caracteres.',
  'Invalid project ID or version number': 'Versión inválida.',
  'Version not found': 'No se encontró esa versión.',
  'Shared project not found': 'El enlace no existe o fue revocado.',
  'The shared project has an invalid format': 'El proyecto compartido tiene un formato inválido.',
  'Public project not found': 'El proyecto no está en la galería.',
  'The project has an invalid format': 'El proyecto tiene un formato inválido.'
}

const PATTERNS = [
  [/^(New p|P)assword must be at least (\d+) characters long$/,
    (m) => `La contraseña debe tener al menos ${m[2]} caracteres.`],
  [/^Internal server error/, () => EXACT['Internal server error']],
  [/^Invalid /, () => 'Datos inválidos.']
]

/** Translate an API message for display; unknown text is returned as is. */
export function translateServerMessage (message) {
  if (typeof message !== 'string' || !message) return message
  if (Object.prototype.hasOwnProperty.call(EXACT, message)) return EXACT[message]
  for (const [re, fn] of PATTERNS) {
    const m = message.match(re)
    if (m) return fn(m)
  }
  return message
}
