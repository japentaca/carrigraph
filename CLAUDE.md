# CarriGraph — guía para agregar funcionalidades

Música generativa conectando nodos en un lienzo. Vue 3 + Vite + Vue Flow + Pinia en el frontend, Express 5 +
SQLite + JWT en el backend, audio solo con Web Audio API nativa. El `README.md` es confiable y tiene lo que
acá no se repite: uso, nodos y puertos, motor de audio, tabla de la API, despliegue y limitaciones conocidas.
Leelo antes de explorar el código.

## Comandos

```bash
npm run dev:full     # API (3001) + Vite (3000, proxy de /api)
npm test             # todo: 635 tests, ~20 s
npm run test:unit    # src/**/__tests__ (jsdom)
npm run test:server  # tests/ (Node, SQLite en memoria)
npx vitest run src/__tests__/guest.test.js   # un archivo
npm run build        # dist/
```

`.env` (no versionado) necesita `JWT_SECRET`; ver `.env.example`.

## Convenciones

- **Idioma**: interfaz, README y mensajes al usuario en español rioplatense (vos: "guardá", "podés").
  Comentarios de código e identificadores en inglés. Los mensajes de la API están en inglés y el frontend los
  traduce en `src/api/messages.js`: un mensaje nuevo del servidor necesita su traducción ahí.
- **Estilo**: JS sin TypeScript, sin punto y coma en `src/` (con punto y coma en `tests/`), `<script setup>`.
  Los comentarios explican el porqué; se mantienen al día cuando cambia el código.
- **Fin de línea**: los archivos están en CRLF en el disco (git los normaliza). Un script que reescriba
  archivos tiene que conservarlo.
- **Lógica pura aparte**: lo que no necesita Vue vive en `src/audio/`, `src/editor/`, `src/sharing/` y se
  prueba sin montar componentes. Los composables (`src/composables/`) lo unen con los stores; las vistas solo
  componen.
- **Dependencias**: no agregar librerías de audio ni de UI; todo el sonido es Web Audio nativo.
- Las menciones "Fase 1…5B" en comentarios y nombres de tests son del plan original con el que se reescribió
  el proyecto; son solo historia.

## Dónde va cada cosa

| Quiero… | Tocar |
|---|---|
| Un tipo de nodo nuevo | `NODE_TYPES` + `NODE_TYPE_ORDER` (`src/audio/graph/nodeTypes.js`), su evaluador en `NODE_EVALUATORS` (`compile.js`), sus parámetros en `nodeParams.js`, el componente en `src/components/nodes/` registrado en `nodeRegistry.js` |
| Cambiar el formato guardado del grafo | subir `CURRENT_SCHEMA_VERSION` y agregar el paso en `src/audio/graph/migrate.js`; los proyectos viejos se migran al abrir, importar y servir públicamente |
| Un efecto o algo que suena | `src/audio/engine/` (`effects.js`, `bus.js`, `voices.js`); tiene que sonar igual en vivo y en `renderScore` (WAV/stems) |
| Un endpoint | `server/routes/*.js`, helpers de datos en `server/database.js` (`dbHelpers`, `withTransaction`), fila en la tabla de API del README |
| Una columna o tabla | migración segura en `initializeDatabase` (`ALTER TABLE` solo si falta la columna); nunca borrar datos |
| Una ruta o vista | `src/router/index.js` (carga diferida con `import()`), metas `requiresAuth` / `requiresGuest` / `allowGuest` |
| Una acción del editor | `useEditorNodes.js` (nodos, selección, grupo), atajo en `useKeyboard` dentro de `Editor.vue` y en `ShortcutsHelp.vue` |
| Estado del proyecto | `src/stores/useProjectStore.js` |

## Cosas que no se ven leyendo un solo archivo

**Vue Flow y el store**
- El lienzo usa `v-model` sobre `projectStore.nodes` / `edges`. Vue Flow solo se entera de cambios hechos
  **reemplazando el arreglo**: usar las acciones del store (`replaceGraph`, `insertGraph`, `removeNodes`,
  `updateNodesData`, `setNodePositions`), no mutar en el lugar.
- Editar datos de un nodo: siempre `projectStore.updateNodeData(id, data)`; agrupa el deshacer y dispara la
  edición en vivo. Deslizadores continuos: `{ history: false }` + `commitHistory()`.
- El proyecto se carga durante el `setup` de `Editor.vue` (`loadFromRoute()`), no en `onMounted`: si Vue Flow
  se monta con los nodos del proyecto anterior y se vacían después, los sigue mostrando.
- `selected`, tamaños y posiciones calculadas no cuentan como "cambios sin guardar" (`graphSignature` en
  `src/editor/graphState.js`).

**Guardado**
- `projectStore.projects` tiene **resúmenes** (`node_count`, no `nodes`); el editor siempre pide el proyecto
  completo. Proyecto nuevo = `currentProject.id == null` (`isPersisted` falso): el primer guardado es manual
  y después hay autoguardado a los 2 s (`useAutosave.js`).
- Cada guardado manda el `updated_at` en el que se basa; un 409 abre el diálogo de conflicto.
- Navegaciones que hace el propio editor (primer guardado, importar) ponen `keepProjectOnNavigation` para no
  recargar el lienzo.

**Sesión, invitado y público**
- `authStore.isAuthenticated` (token en `localStorage`) y `authStore.isGuest` (marca en `sessionStorage`, sin
  token). Un invitado solo entra a rutas con `allowGuest` y nunca a `/editor/:id`.
- **Invariante del modo invitado: nada se escribe en el servidor.** La garantía está en
  `projectStore.saveCurrent()`, que corta antes de cualquier pedido. Una funcionalidad nueva que escriba
  (guardar, compartir, historial, perfil) tiene que ocultarse o cortarse si `isGuest`.
- Un 401 en `src/api/http.js` borra el token y redirige a `/login`. Los pedidos públicos o que responden 401
  por otro motivo llevan `{ skipAuthRedirect: true }`.
- Lo que sale del servidor sin sesión pasa por `toPublicGraph` (`src/sharing/publicProject.js`): lista blanca
  de campos, sin ids de usuario, emails ni metadata interna (tampoco macros). Un dato nuevo del proyecto no
  se publica salvo que se agregue ahí a propósito.
- **El servidor importa módulos puros de `src/`** (`src/audio/graph/`, `src/editor/graphState.js`,
  `src/sharing/publicProject.js`): esos archivos no pueden usar Vue, Pinia ni APIs del navegador.

**Audio**
- El grafo se compila a una partitura (`compileGraph`); `usePlayback().compiled` es compartido por el editor,
  las miniaturas y el piano roll. Cambios de mezcla y efectos se aplican al instante; notas, tempo y swing en
  el próximo compás.
- Sin nodo Salida el proyecto suena en "modo compatibilidad" (una pista); tiene que seguir funcionando.
- Los parámetros de cada nodo, con ruta y rango, están en `NODE_PARAMS` (`nodeParams.js`); las macros y el
  aleatorizar se apoyan en eso.

## Tests

- Frontend: `src/__tests__/*.test.js` en jsdom. `http` se reemplaza con `vi.mock('../api/http.js', …)`; el
  motor usa `helpers/fakeAudioContext.js` y temporizadores falsos.
- Backend: `tests/*.test.js` con la app real (`createTestApp(db)`) sobre una base en memoria
  (`createTestDatabase()`); nunca tocan `server/data/carrigraph.db`. Detalle en `tests/README.md`.
- Cada funcionalidad nueva lleva tests de lo que promete. No modificar ni borrar tests existentes para que
  pasen, salvo que el comportamiento haya cambiado a propósito.

## Verificar en el navegador

Los tests no alcanzan para cambios de interfaz o de audio: probar en Chrome.

- El usuario suele tener `npm run dev:full` corriendo en 3000/3001 con su base real. **No escribir en esa
  base** para armar datos de prueba.
- Para probar con datos: `npm run build` y un servidor temporal en otro puerto con base descartable,
  `PORT=3011 DB_PATH=<temporal>.db NODE_ENV=production CORS_ORIGIN=http://localhost:3011 JWT_SECRET=<cualquiera> node server/index.js`
  (sirve `dist/`), sembrado por la API (`/api/register`, `/api/projects/create`, `PUT /api/projects/:id/public`,
  `POST /api/projects/:id/share`). Al terminar, matar el proceso y borrar la base.
- Con cambios sin guardar en el editor el navegador muestra el diálogo nativo `beforeunload`, que bloquea la
  automatización: salir con la navegación de la app, no cambiando la URL.
- Nadie escuchó el audio de oído (todo se verificó midiendo señal) y la entrada MIDI no se probó con
  hardware: decirlo cuando un cambio dependa de eso.

## Al terminar una funcionalidad

1. `npm test` y `npm run build` sin errores.
2. Actualizar el `README.md` si cambia el uso, la API, los nodos o las limitaciones.
3. Actualizar este archivo si aparece una convención nueva o una trampa que no se ve en el código.
4. Informar qué se verificó en el navegador, qué solo por tests y qué no se verificó.

## Repositorio

Público en `github.com/japentaca/carrigraph`, rama `main`, licencia MIT. Los commits usan la dirección
`noreply` de GitHub configurada en el repo local (no cambiarla). Nunca se versionan `.env`, la base SQLite,
`dist/` ni `node_modules/`. Commit y push solo cuando el usuario lo pide.
