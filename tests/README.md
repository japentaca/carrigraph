# CarriGraph — tests del backend

Los tests corren con **Vitest** (Jest y Babel se quitaron en la Fase 1).
`vitest.config.js` define dos proyectos:

| Proyecto | Carpeta            | Entorno | Qué cubre                         |
|----------|--------------------|---------|-----------------------------------|
| `unit`   | `src/__tests__/`   | jsdom   | stores, generadores, frontend     |
| `server` | `tests/`           | node    | API Express + SQLite              |

## Comandos

```bash
npm test             # todo (unit + server)
npm run test:unit    # solo frontend
npm run test:server  # solo backend
npm run test:watch   # modo watch
npm run test:coverage
npx vitest run tests/auth.test.js   # un archivo
```

No hace falta definir variables de entorno: `tests/setup.js` pone `NODE_ENV=test`
y un `JWT_SECRET` de prueba.

## Aislamiento de datos

Cada archivo de test crea su propia base **en memoria** (`createTestDatabase()` en
`helpers.js` llama a `initializeDatabase(':memory:')`, con el mismo esquema y
migraciones que producción). Nunca se toca `server/data/carrigraph.db`.

La app que se prueba es la real: `createTestApp(db)` llama a `createApp()` de
`server/app.js` (helmet, CORS, límites de cuerpo, rutas), con el límite de intentos
desactivado salvo en los tests que lo prueban explícitamente.

## Archivos

- `auth.test.js` — registro, login, perfil, contraseña, token, borrar cuenta.
- `projects.test.js` — CRUD de proyectos, duplicado, versiones, restauración, permisos.
- `database.test.js` — helpers de `server/database.js`, restricciones y cascadas.
- `integration.test.js` — recorridos completos y multiusuario.
- `app.test.js` — configuración de la app: helmet, CORS, rate limit, límite 1 MB,
  servido de `dist/`, que importar `server/index.js` no haga `listen`, migración de
  `user_sessions`.
- `phase1-api.test.js` — normalización de email, contraseña mínima, resumen de
  proyectos, validación de grafo, versiones (lista liviana, versión completa,
  máximo 50, numeración con `MAX`), transacciones.
- `seed.test.js` — proyectos de ejemplo: el archivo es válido y suena, se publican en orden,
  el seed es idempotente y no toca datos de usuarios, nadie puede entrar como su dueño.
- `helpers.js` / `setup.js` — utilidades y entorno.
