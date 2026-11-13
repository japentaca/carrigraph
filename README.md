# CarriGraph

Aplicación web para hacer **música generativa conectando nodos en un lienzo**. Cada cadena
*patrón → (transformaciones) → notas → voz → (efectos) → salida* es una pista; varias pistas suenan a la vez,
cada una con su propio largo (polimetría). Lo que se edita suena en vivo, se guarda en un servidor con historial
de versiones, se exporta a WAV, stems y MIDI, se graba en vivo y se comparte con un enlace de solo lectura o en una
galería pública.

- **Frontend**: Vue 3 + Vite, Vue Flow (lienzo), Pinia (estado), Vue Router. Audio solo con Web Audio API nativa.
- **Backend**: Node + Express 5, SQLite (`sqlite` + `sqlite3`), autenticación JWT (Passport), `helmet`,
  `express-rate-limit`, `cors`.
- **Tests**: Vitest (frontend en jsdom, backend en Node con SQLite en memoria).

---

## Levantarlo

Requisitos: Node 22.9 o superior (los scripts usan `node --env-file-if-exists`) y npm.

```bash
npm install
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
# editar .env: como mínimo JWT_SECRET
npm run dev:full              # API en :3001 y Vite en :3000 (con proxy de /api)
```

Abrir `http://localhost:3000`. También se pueden levantar por separado: `npm run server` (API) y `npm run dev` (Vite).

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite en el puerto 3000; `/api` se redirige a `http://localhost:3001` |
| `npm run server` / `npm start` | API (`node --env-file-if-exists=.env server/index.js`) |
| `npm run dev:full` | las dos cosas a la vez (`concurrently`) |
| `npm run build` | compila el frontend a `dist/` |
| `npm run preview` | sirve `dist/` con Vite |
| `npm run seed` | carga los proyectos de ejemplo en la base y los publica en la galería (se puede repetir) |
| `npm run seed:export` | reescribe `server/seeds/examples.json` desde los proyectos locales llamados "Ejemplo…" |
| `npm test` | todos los tests (frontend y backend) |
| `npm run test:unit` / `npm run test:server` | solo frontend / solo backend |
| `npm run test:watch` / `npm run test:coverage` | modo observador / cobertura (v8) |

### Variables de entorno (`.env.example`)

| Variable | Por defecto | Uso |
|---|---|---|
| `JWT_SECRET` | — (obligatoria) | Secreto para firmar los JWT. Sin ella el servidor no arranca. |
| `PORT` | `3001` | Puerto de la API. |
| `CORS_ORIGIN` | `http://localhost:3000` | Orígenes permitidos, separados por coma, o `*`. |
| `DB_PATH` | `server/data/carrigraph.db` | Archivo SQLite. Se crea y se migra solo al arrancar. |
| `NODE_ENV` | — | `production`: el servidor además sirve `dist/` (ver Despliegue). `test`: apaga los límites de tasa. |

---

## Cómo se usa

1. **Crear cuenta** (contraseña de 8 caracteres o más) e iniciar sesión.
2. **Proyectos**: crear, renombrar, eliminar, importar un `.cgproj`, compartir (🔗) y ver la galería.
3. **Editor**: arrastrar nodos desde la paleta (o doble clic / `Tab` en el lienzo para buscarlos), unir una salida
   con una entrada del mismo color, editar parámetros en el inspector (derecha) o expandiendo el nodo (▾).
   Soltar una conexión en el vacío abre la paleta filtrada a los nodos compatibles y los deja conectados.
   El panel de **presets** agrega grafos armados (de una pista y multipista).
4. **Transporte** (barra fija): Play/Stop, loop, posición (compás.tiempo.semicorchea), tempo con *Tap*, swing global,
   volumen maestro, medidor de nivel, osciloscopio, **Grabar**, **Performance** y **MIDI**.
5. **Guardar**: `Ctrl+S` o el botón. Los proyectos ya guardados se **autoguardan** 2 s después del último cambio;
   si otro cliente guardó antes, aparece un diálogo de conflicto (sobrescribir / recargar / decidir después).
6. **Historial**: lista de versiones (se guardan las últimas 50), vista previa con el grafo, escuchar y restaurar.
7. **Exportar**: WAV de la mezcla, **stems** (un `.zip` con un WAV por pista; con una sola pista, el WAV), MIDI
   Tipo 1 y `.cgproj`. "×N" fija cuántas pasadas se exportan.
8. **Compartir**: enlace de solo lectura (`/s/<token>`, revocable) y casilla para publicar en la galería
   (`/gallery`). Quien abre el enlace ve el grafo y el piano roll y puede reproducir; con sesión puede
   "Hacer una copia".
9. **Perfil** (`/profile`, desde el menú del usuario): cambiar contraseña y borrar la cuenta.
10. **Modo invitado** (sin cuenta): "Entrar como invitado" en el login, o "✏️ Editar" / "Editar como invitado"
    en la galería y en un enlace compartido. Abre en el editor los proyectos públicos (`/editor/gallery/<id>`,
    `/editor/shared/<token>`) o uno en blanco (`/editor`); se puede modificar, reproducir y exportar, pero
    **nada se guarda en el servidor** (sin Guardar, autoguardado, historial ni compartir) y los cambios se
    pierden al salir del editor. Dura mientras la pestaña esté abierta o hasta iniciar sesión. Los proyectos
    privados, "Mis proyectos" y el perfil siguen pidiendo sesión.

### Modo performance, grabación y MIDI

- **Grabar**: graba lo que sale del bus maestro (lo que se oye, incluidos los cambios en vivo, mute/solo y volumen)
  con `MediaRecorder` y lo descarga al detener (`<proyecto> - grabación <fecha>.webm`; el contenedor depende del
  navegador: WebM/Opus, Ogg o MP4). El botón muestra el tiempo transcurrido.
- **Performance** (panel lateral): mute y solo grandes por pista, 🎲 variación por pista o de todo (nuevas semillas en
  los nodos con semilla no bloqueada; se oye en el próximo compás y se puede deshacer) y **4 macros**: cada macro es
  un control que mueve uno o varios parámetros numéricos de nodos dentro de los rangos del registro
  (`src/audio/graph/nodeParams.js`), con opción de invertir. Las macros se guardan con el proyecto
  (`metadata.macros`); mover una macro es una sola entrada de deshacer.
- **MIDI** (Web MIDI; Chrome/Edge): las teclas tocan la voz seleccionada (o la primera del grafo) con notas de
  duración fija; cualquier perilla/fader (CC) mueve el control deslizante o numérico que tenga el foco (o el último
  enfocado). Sin soporte o sin permiso, el botón queda deshabilitado o avisa. **No se probó con un dispositivo real**:
  la lógica está probada con mensajes simulados.

### Atajos de teclado (editor)

| Atajo | Acción |
|---|---|
| `Ctrl/Cmd+S` | Guardar |
| `Ctrl/Cmd+Z` · `Ctrl/Cmd+Shift+Z` · `Ctrl+Y` | Deshacer · rehacer · rehacer |
| `Espacio` | Reproducir / detener |
| `Supr` / `Retroceso` | Eliminar los nodos seleccionados (o las conexiones seleccionadas) |
| `Ctrl/Cmd+C` · `X` · `V` | Copiar · cortar · pegar (en el puntero si está sobre el lienzo) |
| `Ctrl/Cmd+D` | Duplicar la selección con sus conexiones internas |
| `Ctrl/Cmd+A` | Seleccionar todos los nodos (foco en el lienzo) |
| `Shift` + clic / `Shift` + arrastrar | Agregar a la selección / seleccionar con un recuadro |
| `Tab` (puntero o foco en el lienzo) · doble clic en el vacío | Buscar un nodo y crearlo ahí |
| Flechas (foco en un nodo) | Mover los nodos seleccionados |
| `Ctrl/Cmd+E` · `Ctrl/Cmd+M` | Exportar WAV · MIDI |
| `?` | Ayuda de atajos |
| `Escape` | Cerrar menú, paleta, diálogo, ayuda o panel; si no hay nada abierto, quitar la selección |

Los atajos no actúan mientras se escribe en un campo ni dentro de un diálogo.

---

## Nodos y puertos

Los puertos tienen tipo y color; solo se conectan tipos compatibles, en la dirección salida → entrada, sin ciclos,
y cada entrada acepta una sola conexión (conectar a una entrada ocupada reemplaza la anterior).

| Tipo de puerto | Color | Qué viaja |
|---|---|---|
| `pattern` | ámbar | pasos activos/inactivos de un ciclo |
| `number` | verde | un número (largo, loop) |
| `notes` | rosa | notas con tiempo, altura (o sin altura) e intensidad |
| `audio` | violeta | una voz con sus notas y efectos, lista para ser pista |

Un `pattern` también entra en una entrada `notes` (son notas sin altura); al revés no.

| Nodo (`type`) | Entradas | Salidas | Parámetros |
|---|---|---|---|
| Generador de patrones (`pattern`) | `length` (number), `loop` (number) | `pattern` | algoritmo (euclídeo, aleatorio, binario, Fibonacci, autómata celular con regla 30/90/110, ruido con umbral), densidad, rotación, semilla; regla y generaciones (celular), suavidad (ruido) |
| Patrón por pasos (`steps`) | — | `pattern` | grilla de 4 a 64 pasos dibujada a mano |
| Largo del patrón (`length`) | — | `value` (number) | 4–512 pasos (sin él, 16) |
| Tamaño de loop (`loop`) | — | `value` (number) | 1–64: el patrón se genera con ese largo y se repite hasta completar el largo |
| Lógica de patrones (`logic`) | `a`, `b` (pattern) | `pattern` | AND, OR, XOR, NOT |
| Transformar (`transform`) | `in` (pattern) | `pattern` | invertir, reversa, rotar, doble/mitad de velocidad, probabilidad por paso (con semilla) |
| Escala / Melodía (`scale`) | `in` (notes) | `notes` | tónica, escala (mayor, menor, pentatónica mayor y menor, dórica, frigia, blues, cromática), modo (fija, ascendente, arpegio, aleatoria con semilla), octava, rango |
| Acorde (`chord`) | `in` (notes) | `notes` | tríada, séptima, quintas (según la escala anterior) |
| Groove (`groove`) | `in` (notes) | `notes` | swing, humanizar tiempo e intensidad (con semilla), acento cada N pasos y su fuerza |
| Voz (`voice`) | `notes` | `audio` | instrumento (Piano, Synth, Guitar, Bass, Drums), volumen, paneo; melodía por defecto si no hay Escala; pieza de batería (auto, bombo, redoblante, hi-hat cerrado/abierto) |
| Efectos (`effects`) | `in` (audio) | `audio` | distorsión, filtro (pasa bajos/altos/banda), delay con realimentación y reverb, cada uno activable con su cantidad; se pueden encadenar varios nodos |
| Salida (`output`) | `audio` | — | nombre de pista, volumen, paneo, mute, solo |

Sin ningún nodo Salida el proyecto funciona en **modo compatibilidad** (como las versiones viejas: el primer patrón
con su largo, loop y voz es una única pista). Los nodos de semilla (patrón, transformar, escala, groove) tienen 🎲
nueva semilla y 🔒 bloquear; "Aleatorizar parámetros" sortea dentro de rangos válidos.

Los proyectos guardados llevan `metadata.schemaVersion` (actual: 3). Al abrir un proyecto o importar un `.cgproj`
viejo, `migrateProject` (`src/audio/graph/migrate.js`) lo lleva al esquema actual sin cambiar cómo suena. Los nombres
viejos en inglés de los nodos originales (Pattern Generator, Voice Selector…) se muestran con el nombre nuevo; los
datos guardados no se renombran.

---

## Motor de audio y compilador

**Compilador** (`src/audio/graph/compile.js`, puro: sin Vue, Pinia ni Web Audio). Recorre nodos y aristas,
descarta con un diagnóstico las conexiones inválidas (tipo, dirección, ciclo, entrada ocupada), evalúa cada nodo
de forma perezosa y memorizada, y produce la **partitura**: `{ tempo, stepsPerBeat, tracks }`, donde cada pista
(una por nodo Salida alcanzado; su id es el de la Salida) tiene largo propio, eventos `{ step, time, duration, midi,
velocity }` en pasos de semicorchea, volumen, paneo, efectos y mute/solo. Devuelve también los diagnósticos que el
editor muestra sobre cada nodo y una vista previa de lo que sale de cada nodo (las miniaturas). Las semillas son
deterministas: un nodo sin semilla guardada usa una derivada de su id. El swing global se aplica después
(`applySwing`).

**Motor** (`src/audio/engine/`, sin Vue ni Pinia; contexto, reloj y temporizadores inyectables). Un planificador
con ventana de anticipación (100 ms, temporizador de 25 ms) sobre el reloj del `AudioContext` toca la partitura en
loop o una vez; cada pista cicla sobre su largo. Los cambios de notas y de tempo se aplican en el próximo compás;
volumen, paneo, mute/solo y parámetros de efectos, al instante (un cambio de estructura de efectos hace un fundido
de 50 ms). Cada pista pasa por `voces → volumen → efectos → paneo → mute` hacia un bus maestro con compresor suave,
volumen y un analizador (medidor y osciloscopio). Las voces se arman con una sola función sobre cualquier
`BaseAudioContext`, así que el WAV y los stems se renderizan con `OfflineAudioContext` usando exactamente las mismas
voces, efectos y partitura (estéreo, 16 bits, con la cola de release y de efectos). El MIDI (Tipo 1, una pista y canal
por pista, batería en el canal 10) sale de la misma partitura. `useAudioStore` es una capa reactiva fina sobre el motor.

---

## API

Base `/api`. Autenticación con `Authorization: Bearer <token>` (el token lo dan `register` y `login`; dura 7 días).
Cuerpo JSON de hasta 1 MB (más → 413; JSON mal formado → 400). Los mensajes de error de la API están en inglés; la
interfaz muestra su traducción.

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| GET | `/api/health` | no | `{ status, timestamp, version }` |
| POST | `/api/register` | no | `{ name, email, password }` (8+ caracteres) → `{ token, user }` |
| POST | `/api/login` | no | `{ email, password }` → `{ token, user }` |
| GET | `/api/logout` | no | responde OK (el token se descarta en el cliente) |
| GET | `/api/me` | sí | usuario actual |
| PUT | `/api/profile` | sí | `{ name, email }` |
| PUT | `/api/change-password` | sí | `{ currentPassword, newPassword }` |
| DELETE | `/api/account` | sí | `{ password }`; borra usuario, proyectos, versiones y enlaces |
| POST | `/api/verify-token` | no | `{ token }` → si es válido, el usuario |
| GET | `/api/projects` | sí | resumen de los proyectos del usuario (sin grafo; con `node_count`, `edge_count`, `is_public`, `share_token`) |
| POST | `/api/projects/create` | sí | crea un proyecto (versión 1) |
| GET | `/api/projects/:id` | dueño | proyecto completo |
| PUT | `/api/projects/:id` | dueño | guarda (nueva versión). `base_updated_at` opcional: si no coincide → 409 con la versión del servidor. Sin `nodes`/`edges` conserva el grafo. `metadata` se mezcla con la guardada |
| DELETE | `/api/projects/:id` | dueño | elimina el proyecto, sus versiones y su enlace |
| POST | `/api/projects/:id/duplicate` | dueño | `{ name }` → copia |
| GET | `/api/projects/:id/versions` | dueño | lista liviana de versiones (máx. 50) |
| GET | `/api/projects/:id/versions/:n` | dueño | una versión completa |
| POST | `/api/projects/:id/restore/:n` | dueño | restaura (crea una versión nueva) |
| GET | `/api/projects/:id/share` | dueño | estado del enlace y de la galería |
| POST | `/api/projects/:id/share` | dueño | crea el enlace (201) o devuelve el existente (200) |
| DELETE | `/api/projects/:id/share` | dueño | revoca el enlace |
| PUT | `/api/projects/:id/public` | dueño | `{ public: boolean }` publica o despublica en la galería |
| GET | `/api/shared/:token` | no | proyecto de solo lectura (lista blanca de campos; sin email ni ids internos) |
| POST | `/api/shared/:token/copy` | sí | copia el proyecto compartido a la cuenta |
| GET | `/api/gallery?page=&limit=` | no | listado paginado (12 por defecto, máx. 48) |
| GET | `/api/gallery/:id` | no | proyecto público de solo lectura |
| POST | `/api/gallery/:id/copy` | sí | copia un proyecto de la galería |

"Dueño": con sesión y siendo el dueño del proyecto (si no, 403; si no existe, 404). Límites de tasa por IP:
`/api/login`, `/api/register`, `/api/change-password` y `/api/account`, 20 pedidos cada 15 min; `/api/shared` y
`/api/gallery`, 120 por minuto (`createApp({ rateLimit, publicRateLimit })`). Cabeceras de seguridad con `helmet`
(CSP con `default-src 'self'`).

---

## Tests

```bash
npm test             # todo
npm run test:unit    # src/**/__tests__ en jsdom
npm run test:server  # tests/ en Node, SQLite en memoria
```

Los tests del motor usan un `AudioContext` falso y temporizadores falsos (`src/__tests__/helpers/fakeAudioContext.js`);
los del servidor usan la app real (`createApp`) sobre una base en memoria (`tests/helpers.js`). `tests/setup.js`
define `JWT_SECRET` para los tests.

---

## Despliegue en producción

```bash
npm ci
npm run build
npm run seed    # opcional: proyectos de ejemplo en la galería
NODE_ENV=production JWT_SECRET=... CORS_ORIGIN=https://tu-dominio npm start
```

**Proyectos de ejemplo.** `npm run seed` carga en la base (`DB_PATH`) los proyectos de
`server/seeds/examples.json` y los publica en la galería, para que un servidor nuevo tenga algo para escuchar y
los invitados algo para abrir. Pertenecen a un usuario del sistema ("CarriGraph") con el que nadie puede iniciar
sesión. Se puede correr más de una vez, también con el servidor andando: agrega los que falten, actualiza los que
cambiaron y no toca los proyectos de los usuarios. Para cambiar los ejemplos: editarlos localmente (proyectos cuyo
nombre empiece con "Ejemplo"), `npm run seed:export`, y versionar el archivo.

Con `NODE_ENV=production` el servidor sirve `dist/` y responde `index.html` a cualquier GET que no sea `/api/...`
(así funcionan las rutas del SPA: `/editor/:id`, `/s/:token`, `/gallery`, `/profile`…).

**El servidor importa módulos puros de `src/`** (`src/audio/graph/` —migración, compilador, validación— y
`src/editor/graphState.js`, `src/sharing/publicProject.js`) para validar y servir los proyectos públicos y contar
pistas. Hay que desplegar `server/` **junto con `src/`** (y `package.json`/`node_modules`), no `server/` solo.

Detrás de un proxy inverso, los límites por IP necesitan `app.set('trust proxy', …)`, que hoy no está configurado.
La base SQLite es un archivo (`DB_PATH`): conviene ubicarlo fuera del directorio de la app y respaldarlo.

---

## Estructura

```
server/            API: app.js (createApp), index.js (listen), database.js (SQLite y migraciones), routes/,
                   seed.js + seeds/examples.json (proyectos de ejemplo)
src/audio/engine/  motor: partitura, voces, efectos, buses, transporte, render WAV, medidor, grabación
src/audio/graph/   compilador, tipos de nodo y puertos, conexiones, migración, parámetros, macros, validación
src/audio/         generadores de patrones, MIDI (escritura y entrada)
src/editor/        lógica pura del editor (estado del grafo, selección, paleta, layout, zip…)
src/composables/   lógica del editor con Vue (reproducción, exportación, autoguardado, grabación, MIDI…)
src/components/    nodos, barra de transporte, inspector, piano roll, paneles y diálogos
src/stores/        Pinia: proyecto, audio, auth, presets, avisos
src/views/         Login, Proyectos, Editor, Compartido/Galería, Perfil (todas con carga diferida)
```

---

## Limitaciones conocidas

- Los cambios de notas, tempo y swing se oyen en el próximo compás de 16 pasos (a tempos lentos, hasta ~4 s).
- El planificador corre en el hilo principal: si se bloquea más de 100 ms puede haber huecos.
- El delay no se sincroniza al tempo (tiempo en segundos). No hay chorus ni compresor por pista.
- Mute/solo no existen en modo compatibilidad (sin nodo Salida). Las pistas muteadas siguen programando notas.
- MIDI de entrada: notas de duración fija (no se usa note off); no se probó con hardware.
- La grabación depende de `MediaRecorder` (formato según navegador; sin él, el botón queda deshabilitado).
- Expandir un nodo lo dibuja encima de sus vecinos, pero no los corre.
- El portapapeles de nodos es interno de la pestaña (no usa el del sistema).
- Límites de tasa por IP sin `trust proxy`; caché de cantidad de pistas en memoria del proceso.
- Con varios guardados en el mismo milisegundo no se detectaría un conflicto (impracticable desde la interfaz).
- `npm audit` informa 4 vulnerabilidades moderadas solo de desarrollo, en la cadena `@vue/test-utils → js-beautify`;
  la dependencia de producción no tiene ninguna (`npm audit --omit=dev`).

## Licencia

[MIT](LICENSE).
