# Investigación arquitectónica: sincronización del preview editable de SofLIA Engine

**Repositorio principal:** Courseforge (SofLIA Engine, según la aclaración del encargo)  
**Repositorios comparados:** HyperFrames, Remotion y OpenMontage, todos locales  
**Fecha del análisis:** 22 de agosto de 2026  
**Método:** inspección estática de código, pruebas y migraciones locales; no se usó búsqueda web ni se ejecutó una sesión autenticada del editor.

## Convenciones de evidencia

- **HECHO**: comprobado directamente en una ruta, símbolo, prueba o migración de los repositorios locales.
- **INFERENCIA**: consecuencia técnica razonable de hechos observados, pero no reproducida en una sesión real.
- **HIPÓTESIS**: explicación pendiente de confirmar con instrumentación en runtime.
- **RECOMENDACIÓN**: decisión arquitectónica propuesta.

Las referencias de archivo y línea corresponden al estado local inspeccionado. El análisis no atribuye a SofLIA capacidades que no estén presentes en Courseforge.

---

## 1. Resumen ejecutivo

### Conclusión principal

**HECHO — alta confianza.** Courseforge sí contiene actualmente un editor audiovisual nativo, dependencias de HyperFrames y Remotion, un documento de composición, timeline, inspector, edición directa dentro de un `iframe`, control de concurrencia por hash y generación de snapshots para render. Esto contradice el supuesto inicial de que Courseforge solo publicaba assets hacia Soflia.

**HECHO — causa dominante localizada.** El preview completo no renderiza el documento local vigente. Su URL carga un endpoint que vuelve a obtener el documento persistido y compila HTML. Una edición actualiza de forma optimista el `payload` React, marca `previewDirty`, persiste por `PUT`, pero no cambia la URL ni transmite el nuevo documento al `iframe`. El preview solo se recompila al pulsar “Actualizar preview” o al iniciar reproducción cuando está sucio.

**HECHO.** Durante drag, resize o crop, el controlador que vive dentro del `iframe` modifica directamente el estilo del nodo seleccionado y al terminar envía un `layout-commit` o `crop-commit` al padre. Esto explica con precisión el síntoma “solo se actualiza el elemento activo”: ese nodo quedó modificado en el DOM vivo; el resto del `iframe` continúa representando la compilación anterior.

**HECHO — defecto adicional.** `savePatch()` retorna inmediatamente si `saveInFlightRef.current` es verdadero. No hay cola, coalescing ni rebase de comandos. Una edición que llegue durante un guardado puede ser ignorada. HyperFrames Studio, en contraste, tiene una cola serial explícita y guards de versión.

**DECISIÓN.** El arreglo mínimo no es “guardar y volver a cargar más rápido”. Debe establecerse este flujo:

```text
Interacción → comando → Composition Store local → Preview / Timeline / Inspector / Layers
                                ↓
                         cola de autosave
                                ↓
                      backend con revisión/OCC
```

El documento local debe ser la fuente de verdad de la sesión. El backend es la fuente durable, no el reloj de render del editor. El preview debe recibir patches locales ordenados por una revisión monotónica y confirmar qué revisión pintó. La recompilación completa queda como mecanismo de convergencia para cambios estructurales, recuperación y errores, no como camino normal de cada edición.

### Prioridad práctica

1. Instrumentar `commandRevision`, `storeRevision`, `previewRevision` y `persistedRevision`.
2. Introducir un Composition Store local y acciones inmutables sin cambiar las capacidades de edición existentes.
3. Suscribir el preview a patches del store; aplicar en vivo transform/style/timing y hacer reload selectivo para cambios estructurales.
4. Sustituir el gate booleano de guardado por una cola serial con debounce/coalescing y protección de respuestas fuera de orden.
5. Compartir un evaluador temporal y probar paridad preview/render.

---

## 2. Alcance confirmado en Courseforge y límites

### 2.1 Qué existe realmente

| Área | Evidencia verificada | Conclusión |
|---|---|---|
| Editor nativo | `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx` | Contiene preview, transporte, timeline, inspector, selección y edición directa. |
| Modelo de composición | `apps/web/src/domains/production/composition-editor/composition-document.types.ts` | Hay un documento serializable de clips, tracks, motion y audio. |
| Patching | `editor-patch.service.ts` y `savePatch()` en `NativeCompositionPreview.tsx:525` | Las operaciones se aplican localmente y luego se persisten. |
| Preview HyperFrames | `composition-preview-compiler.service.ts`; endpoint `.../[draftId]/preview/route.ts` | Se compila HTML interactivo y se aloja en un `iframe`. |
| Remotion | `apps/web/package.json:24`, `RemotionPreviewPlayer.tsx` | Existe un segundo camino de preview con `@remotion/player`. |
| HyperFrames Studio | `apps/web/package.json:19` | Courseforge fija `@hyperframes/studio` 0.7.106. |
| Zustand | `apps/web/package.json:47` | Está instalado, pero los stores localizados son auth y organización, no la composición. |
| Render durable | `composition-snapshot.service.ts:95-99` | Compila un snapshot exacto con target `HYPERFRAMES_RENDER`. |
| Concurrencia | endpoint `document/route.ts`, `composition-document.service.ts`, RPCs en migraciones | El guardado usa `If-Match`, hash de contenido y append transaccional. |
| Publicación | `/api/save-draft`, `/api/publish`, `publication_requests` | Publicación y preview editable son flujos distintos. |

### 2.2 Integración Courseforge → Soflia

**HECHO.** El borrador de publicación almacena categoría, nivel, instructor, thumbnail, slug, precio, `lesson_videos` y `selected_lessons` en `publication_requests`. El endpoint de publicación carga una solicitud `READY`, construye el payload y hace upsert en el inbox externo de Soflia identificado por `course_slug`; después marca la solicitud local como `SENT`.

**HECHO.** Antes de publicar, las acciones de la pantalla de publicación pueden hidratar las lecciones con videos finales durables producidos por el flujo HyperFrames.

**Conclusión.** Este contrato entrega resultados durables. No gobierna, ni debe gobernar, la reactividad de una sesión del editor. Un fallo de sincronización en el preview ocurre antes y dentro de Courseforge.

### 2.3 Límites del análisis

- No se reprodujo una sesión autenticada contra Supabase; los síntomas de runtime se correlacionan con rutas de código, pero sus frecuencias deben medirse.
- No se evaluaron implementaciones privadas externas a los cuatro repositorios locales.
- La comparación de Remotion usa el checkout local 4.0.508; Courseforge fija 4.0.484. Se señalan conceptos estables observados, no se presume identidad línea por línea entre ambas revisiones.
- OpenMontage se evaluó como está en el checkout local, rama `main`, commit `cd9f3c1f...` del 22 de agosto de 2026.

### 2.4 Verificación automatizada ejecutada

Se ejecutó `npm run test:hyperframes --workspace=apps/web`. TypeScript y toda la cadena configurada de pruebas HyperFrames/composition-editor finalizaron con código 0. Entre otras, pasaron las pruebas de documento/ETag/OCC, patching, compiler, assets, snapshot, paridad de crop/timing/audio entre preview y render y telemetría existente. Esto confirma los mecanismos descritos; no prueba todavía la reactividad store→iframe, porque esa prueba no existe en la suite observada y forma parte del plan propuesto.

---

## 3. Diagnóstico conceptual y árbol de causas

```text
Preview desactualizado
├── 1. Composition State no cambió
│   ├── mutación directa sin nueva referencia
│   ├── acción/patch incorrecto
│   ├── comando descartado durante save en curso       ← verificado en Courseforge
│   └── interaction state nunca confirmado
├── 2. Store cambió, Preview no reaccionó              ← verificado en Courseforge
│   ├── preview deriva de endpoint persistido, no del estado local
│   ├── iframe mantiene la compilación anterior
│   ├── estado duplicado: payload local vs DOM del iframe
│   ├── selector/memo/equality incorrectos
│   └── stale closure o props con referencia estable
├── 3. Preview actualizó y luego revirtió
│   ├── respuesta antigua sobrescribe estado local
│   ├── rehidratación desde fetch obsoleto
│   ├── carrera entre autosaves
│   └── revisión del servidor inferior a la local
├── 4. Solo falla con assets
│   ├── identidad o versión de asset sin cambio
│   ├── CDN/browser/service worker cache
│   ├── <video> conserva recurso previo
│   ├── React key no representa la identidad del recurso
│   └── caché de frames/media no invalidada
└── 5. Preview y render final difieren
    ├── targets interactivo/render toman ramas diferentes
    ├── evaluadores temporales distintos
    ├── reglas de layout duplicadas
    └── snapshot serializa una revisión diferente
```

### Matriz de diagnóstico

| Causa | Estado en Courseforge | Síntoma característico | Evidencia/instrumentación requerida | Corrección |
|---|---|---|---|---|
| Comando descartado durante save | **HECHO**: `savePatch()` retorna `false` con `saveInFlightRef.current` | Gestos rápidos desaparecen; no hay request ni cambio final | `EDIT_COMMAND` sin `STORE_UPDATED`; contador `commands_dropped` | Cola serial; nunca descartar silenciosamente |
| Mutación directa del estado React | No demostrada en el patch service; riesgo general | Ningún suscriptor reacciona aunque cambien valores internos | `Object.freeze` en dev, tests de referencia, Zustand devtools | Acciones inmutables/Immer |
| Estado local cambia, iframe no | **HECHO** | Badge “Cambios pendientes”; preview anterior | Comparar hash/revisión de payload e iframe | Canal store→preview y ACK de revisión |
| Solo el nodo activo cambia | **HECHO** | Drag visible, efectos colaterales o capas no | Log del DOM patch y revisión del documento compilado | Patch del scene graph completo o reevaluación central |
| Refresh condicionado a play/button | **HECHO** | Reproducir o refrescar “arregla” el preview | `isPreviewRefreshRequired()` y handlers | No usar refresh como condición de visibilidad |
| Selector incorrecto | **HIPÓTESIS futura** al migrar a store | Una entidad no rerenderiza, otras sí | Contador de renders por `elementId`; selector tracer | Selector por entidad/campo y structural sharing |
| `memo`/`useMemo` con deps incompletas | **HIPÓTESIS** | Valor cambia tras una acción ajena | React Profiler y tests de cambio aislado | Dependencias correctas; no memoizar antes de medir |
| Stale closure | **HIPÓTESIS** | Gestos usan revisión/elemento anterior | Incluir revision/id en eventos y callbacks | Acciones leen `getState()` actual o comandos capturan before/after |
| Respuesta vieja pisa una nueva | Backend OCC reduce el riesgo; cliente no modela revisiones locales | Reversión tras guardar | `SAVE_*` con base/local/server revision y request id | Guard monotónico + rebase; nunca `setState` desde ACK inferior |
| 409 reemplaza estado optimista | **HECHO en el flujo actual** | Cambio visible se pierde ante conflicto | Log `conflict`, local hash y server hash | Mantener branch local, rebase/merge o pedir resolución |
| Fetch/rehydrate obsoleto | **HIPÓTESIS** | Preview revierte tras evento/refetch | `PROJECT_REHYDRATED` con origen y revisión | Rehidratar solo si servidor ≥ base y no hay cambios locales |
| URL de asset sin versión | Mitigado para assets públicos por checksum; revisar privados y rutas auxiliares | Solo reemplazos muestran bytes viejos | Registrar `assetId`, checksum, URL fingerprint | ID/hash inmutable en identidad del recurso |
| `<video>` no recarga | **HIPÓTESIS** | Poster/audio/duración viejos con src conceptualmente nuevo | eventos `loadedmetadata`, `emptied`, `canplay`; `currentSrc` | Cambiar key/source; `load()` o recrear según cambio |
| Cache de frames | **HIPÓTESIS** | Un frame sigue viejo después de sustituir asset | cache key y asset hash en telemetría | Clave `(assetId, version, frame)`; invalidación selectiva |
| Evaluador distinto | Riesgo real por targets `INTERACTIVE_PREVIEW`/`HYPERFRAMES_RENDER` | Frame N no coincide | test pixel/datos evaluados por frame | Evaluador puro compartido + regression visual |

---

## 4. Hipótesis de causa raíz priorizadas

### P0 — El preview completo no consume el documento local

**HECHO.** `NativeCompositionPreview` mantiene `payload` (`:159`) y calcula la URL usando `previewDocumentHash`/`previewRefreshKey` (`:417`). El `iframe` usa esa URL (`:1331`). El endpoint de preview vuelve a cargar `current.document` y lo compila. `savePatch()` cambia `payload` y `previewDirty`, pero no cambia `previewDocumentHash`; el botón de refresh sí lo hace (`:503-510`).

**Posición:** esta es la causa raíz primaria del stale preview, no una posibilidad genérica.

### P0 — Dos representaciones visuales sin reconciliación continua

**HECHO.** En el `iframe`, pointermove modifica estilos del target y pointerup emite un commit. El padre aplica el patch con `preservePreviewRuntime: true`. El DOM del `iframe` y el documento React quedan temporalmente divergentes.

**INFERENCIA de alta confianza.** Cambios derivados —z-order, restricciones, timing, otras capas, evaluación de animación— no quedan reflejados porque solo se tocó el target activo.

### P0 — Pérdida de comandos por guardado en curso

**HECHO.** `if (!currentPayload || saveInFlightRef.current) return false;` (`NativeCompositionPreview.tsx:532`).

**INFERENCIA.** Gestos encadenados, inspector más timeline o commit de crop durante un save pueden perderse. Aunque no fuera la causa del caso observado, viola el requisito de consistencia.

### P1 — Convergencia por reload en lugar de invalidación

**HECHO.** La UI expone un badge de cambios pendientes y un botón “Actualizar preview con los cambios guardados”. El texto exterior afirma, contradictoriamente, que el preview se actualiza automáticamente.

**RECOMENDACIÓN.** Mantener reload como fallback para cambios estructurales, no como protocolo normal.

### P1 — Versiones no explícitas entre subsistemas

**HECHO.** Hay hash de documento persistido y versión DB, pero no se observó un contrato `storeRevision → previewRevision` ni ACK de render.

**HIPÓTESIS.** Sin estos contadores es imposible distinguir “store nunca cambió”, “preview no recibió”, “preview recibió pero no pintó” y “servidor revirtió”.

### P2 — Cache/media

**HECHO.** Assets públicos reciben `?v=<checksum SHA-256>`; URLs privadas se firman por una hora y se renuevan en cada carga de preview. La ruta de redirect usa `private, no-store`.

**Posición:** caché no explica el stale preview general. Sigue siendo una causa específica posible al reemplazar recursos manteniendo identidad o nodo multimedia.

---

## 5. Arquitectura actual verificada y zonas inciertas

```text
                             ┌──────── React local payload ───── Timeline/Inspector
User gesture ─ iframe DOM ───┤            │
                 activo      │            └─ savePatch ─ PUT If-Match ─ DB/RPC
                             │
                             └─ iframe sigue con HTML compilado anterior

Refresh/Play cuando dirty ─ URL nueva ─ GET preview ─ fetch documento persistido
                                          └─ compilar HTML ─ iframe nuevo
```

### Lo positivo que debe conservarse

- Patch service tipado y documento serializable.
- Actualización optimista del payload.
- Hash estable, `If-Match` y append transaccional.
- Compilador compartido con targets de preview y render.
- Assets ligados al draft y checksum de contenido.
- Snapshot durable y content-addressed para render.

### Incertidumbres a medir

- Frecuencia real de comandos descartados durante save.
- Latencia p50/p95 desde input hasta paint.
- Qué operaciones del inspector ya tienen mensajes live hacia el `iframe` además de crop/layout.
- Diferencias exactas de evaluación entre los targets interactivo y render.
- Comportamiento del nodo `<video>` para cada tipo de reemplazo y navegador soportado.
- Presencia de service workers/CDN intermedios en despliegue.

---

## 6. Arquitectura objetivo recomendada

```text
Interaction Layer
  ↓ intentos efímeros
Command Dispatcher
  ↓ comandos confirmados
Composition Store (fuente de verdad de sesión)
  ├── Preview Bridge/Renderer ── ACK previewRevision
  ├── Timeline
  ├── Inspector
  ├── Layer Panel
  ├── History Manager
  ├── Revision Manager
  └── Autosave Queue
        ↓ patches/snapshot + baseRevision
      Persistence Adapter
        ↓
      Backend OCC / durable snapshot

Asset Manager ───────────→ Preview Renderer
Playback Controller ─────→ Frame Evaluator
Composition Store ───────→ Frame Evaluator ───→ Preview + Final Render
```

### Contrato de componentes

| Componente | Responsabilidad | Posee | Consume / produce | No debe hacer | Concurrencia |
|---|---|---|---|---|---|
| Interaction Layer | Capturar pointer/keyboard y estados transitorios | hover, drag draft, snapping | Intents; overlay visual | Persistir cada `pointermove` | Un gesto activo por puntero; RAF para visuales |
| Command Dispatcher | Validar y convertir intentos confirmados | Ningún documento duplicado | `Command` atómico | Renderizar o llamar backend directamente | Orden total local por `commandRevision` |
| Composition Store | Fuente de verdad de la sesión | documento normalizado, `localRevision`, dirty metadata | Acciones inmutables; selectors | Esperar un fetch/save para publicar cambios | Actualización síncrona local |
| Preview Bridge | Traducir cambios del store a patch/reload | `previewRevision`, capacidad del runtime | Patch batches + ACK | Ser dueño del documento durable | Coalesce por RAF; aplica solo revisión creciente |
| Preview Renderer | Evaluar y pintar | scene graph/runtime derivado | `EvaluatedFrame`, asset handles | Mutar silenciosamente el store | Un paint por RAF; workers opcionales |
| Timeline | Mostrar/editar tiempo | interaction state de su gesto | Selectores y comandos | Duplicar reglas de activación | High-frequency local; commit único |
| Inspector/Layers | Editar propiedades/estructura | formularios efímeros | Selectores y comandos | Mantener copia durable del elemento | Commit por campo/transacción |
| Playback Controller | Reloj de reproducción | playing, currentFrame, rate, loop | ticks hacia evaluator | Guardar el playhead en cada frame | RAF/media clock; sin renders globales obligatorios |
| Frame Evaluator | Función pura de composición+frame | cachés derivados versionados | `EvaluatedFrame` | Acceder a DB/DOM | Determinista y cancelable |
| History Manager | Undo/redo semántico | stacks o log de comandos | before/after/inverse | Incluir pointermoves individuales | Un gesto = un comando |
| Revision Manager | Ordenar estado local/preview/server | revisiones y request ids | guards/ACK | Usar timestamps como orden causal | Monotónico por proyecto/sesión |
| Autosave Queue | Debounce, coalescing, retry | cola, backoff, status | patches/snapshot | Bloquear preview o descartar comandos | Un write en vuelo por proyecto inicialmente |
| Persistence Adapter | Traducir al contrato backend | ETag/base server revision | save result/conflict | Rehidratar React por su cuenta | OCC; idempotency key |
| Asset Manager | Resolver identidad, URL y lifecycle | handles/cache por hash | asset refs→media resource | Invalidar por transform | Deduplicación y cancelación |

---

## 7. Flujo de actualización inmediato

### Durante drag/resize

```text
pointerdown
  → Interaction State abre gesto y captura before
pointermove
  → actualiza draft transform
  → Preview Bridge pinta transform en el próximo RAF
  → no escribe backend, no crea history entry
pointerup
  → crea Move/Resize Command(before, after)
  → aplica/normaliza al Composition Store
  → localRevision++
  → history.push(command)
  → preview recibe patch revisionado
  → autosave agenda patch
```

La optimización de manipular el DOM activo puede conservarse, siempre que sea una proyección explícita del Interaction State y que el commit obligue al runtime a confirmar la misma revisión para todas las entidades afectadas.

### Cambio desde inspector o layers

```text
input/change → Command Dispatcher → Store síncrono → Preview patch → autosave async
```

No debe existir el tramo `Save → Fetch → Rehydrate → Refresh` en el camino crítico. Ese patrón añade latencia de red, introduce carreras y hace que la UI dependa de disponibilidad del backend. Escala peor porque cada gesto fuerza escritura, lectura y recompilación completa.

---

## 8. Composition Store y state management

### 8.1 Tres niveles explícitos

1. **Interaction State:** selección, hover, gesture draft, snapping, resize handles, playhead en movimiento. Es efímero y puede vivir en un store/slice separado, refs o un controlador externo a React.
2. **Composition State:** documento exacto que debe mostrar el preview. Es la fuente de verdad durante la sesión activa.
3. **Persisted Project State:** último snapshot confirmado por backend, con `serverRevision`/ETag. Sirve para recuperación, auditoría, render y colaboración futura.

Al cargar, el servidor hidrata el Composition Store una sola vez. Después:

- un save exitoso avanza `persistedRevision`, no reemplaza indiscriminadamente el documento local;
- un save fallido conserva visible el cambio, marca `unsaved/error` y reintenta;
- al recuperar conexión se envían operaciones pendientes sobre su base;
- un conflicto no destruye el branch local: se rebasa si las operaciones no chocan o se solicita resolución;
- una rehidratación solo puede sustituir el store si no hay cambios locales o si la revisión aceptada es causalmente posterior.

### 8.2 Recomendación explícita: conservar Zustand

**RECOMENDACIÓN.** Usar Zustand 5 para el Composition Store. Ya está en el stack, soporta selectores granulares, suscripciones fuera de React y estado serializable, y no obliga a reescribir toda la UI. Añadir Immer es razonable solo dentro de actions complejas; las interfaces públicas deben seguir siendo comandos/patches, no acceso libre a drafts.

Configuración sugerida:

- store normalizado: `elementsById`, `tracksById`, `sceneOrder`, `trackOrder`;
- selectores por entidad/campo;
- `useShallow` únicamente para tuplas/objetos derivados pequeños;
- structural sharing: solo cambia la entidad y ancestros afectados;
- `subscribeWithSelector` para Preview Bridge/autosave fuera de React;
- slices separados para composition, interaction, playback, history y sync;
- `devtools` en desarrollo con nombre de comando y revisión;
- persist middleware **no** como sustituto del Persistence Adapter/OCC;
- no guardar nodos DOM, `HTMLVideoElement`, blob URLs o controladores en el documento serializable.

### 8.3 Por qué la mutación directa falla

```ts
element.transform.x = 500;
```

Conserva las referencias de `element` y `transform`. React/Zustand y sus equality functions suelen detectar cambios por identidad; un selector puede devolver el mismo objeto y no notificar. También rompe snapshots de undo, memoización y comparación de revisiones.

```ts
updateElement(id, {
  transform: {
    ...previousTransform,
    x: 500,
  },
});
```

Crea una nueva referencia solo en la rama afectada. Los selectores observan el cambio, las entidades no relacionadas conservan identidad y el history puede retener el valor anterior.

### 8.4 Comparación enfocada

| Alternativa | Alta frecuencia / granularidad | Undo/serialización/depuración | Decisión |
|---|---|---|---|
| Zustand | Buena con selectores y suscripción externa; requiere disciplina inmutable | Flexible, serializable, devtools; history se diseña explícitamente | **Elegida**: menor migración y suficiente escala |
| Redux Toolkit | Muy buen event log/devtools y reducers Immer; más ceremonia | Excelente para commands/undo y persistencia | Alternativa si el equipo prioriza auditabilidad estricta sobre migración |
| Jotai | Gran granularidad atómica | Grafo de átomos puede complicar snapshot/versionado global | No elegir como store central; útil solo para UI local |
| MobX | Reactividad fina y ergonomía mutable | Serialización, causalidad y replay menos explícitos | No recomendado para este editor durable |
| XState | Excelente para estados de workflow | No es un scene graph/store de entidades de alta frecuencia | Usar, si acaso, para estados de save/render, no composición |
| Signals | Actualizaciones finas | Ecosistema/contratos de persistencia e history dependen de implementación | No justifica migración ahora |
| RxJS | Excelente para streams, clocks, coalescing y backpressure | Excesivo como store documental; depuración exige experiencia | Útil internamente en playback/autosave, no como verdad central |

---

## 9. Autosave, persistencia y revisiones

### Política recomendada

- `pointermove`: interaction/preview a RAF, cero saves.
- `pointerup`: un comando semántico y un patch durable.
- Inspector de texto/slider: preview inmediato; debounce de 300–500 ms tras pausa, flush en blur/Enter.
- Estructura/timing discreto: save inmediato en cola.
- Debounce global inicial: 500 ms; máximo de espera 2 s para no dejar edición continua sin checkpoint.
- Un request en vuelo por proyecto en MVP. La cola puede coalescer patches sobre la misma propiedad antes de enviarlos.
- Flush en `visibilitychange`, navegación y antes de render/publicación, con UI de pendiente si no termina.

### Snapshot, patch o command log

**MVP:** patches tipados + snapshot periódico. Courseforge ya tiene patch service y snapshot durable; es el cambio más pequeño.

- Patch: eficiente y conserva intención suficiente para rebase simple.
- Snapshot: cada N comandos, antes de render y para recuperación rápida.
- Command log completo: útil para auditoría/replay, pero puede diferirse si history local guarda comandos semánticos.
- CRDT: **no es necesario para el MVP monousuario**. Introducirlo solo con colaboración concurrente real y semántica de conflictos definida.

### Reintentos y errores

- Reintentar errores de red/5xx con backoff exponencial y jitter; no reintentar automáticamente 400/403/409.
- Mantener el cambio visible y mostrar “Cambios sin guardar”.
- No hacer rollback por timeout o desconexión: el estado local sigue siendo válido y pendiente.
- Rollback solo para rechazo semántico definitivo que no puede representarse localmente, y preferiblemente como comando compensatorio visible.
- En 409, conservar las operaciones locales, cargar metadatos de la revisión remota y rebasear; no reemplazar ciegamente el store.
- Guardar en IndexedDB el snapshot local y la outbox si se requiere recuperación offline. Blob URLs no son persistibles; guardar referencias de asset.

### Carrera A/B

```text
Save A: base 180 → revision local 181, responde tarde
Save B: base 181 → revision local 182, responde primero
```

El MVP serializa requests, por lo que B no sale hasta confirmar A. Si más adelante se permiten requests concurrentes, cliente y servidor deben cumplir:

- el servidor acepta un patch solo si `baseRevision === currentRevision`;
- cada comando lleva `operationId` idempotente;
- el ACK incluye `acceptedRevision`;
- el cliente solo avanza `persistedRevision = max(actual, acceptedRevision)`;
- un ACK de 181 nunca reemplaza documento, hash ni estado visible de revisión 182;
- el servidor tampoco puede materializar 181 después de haber materializado 182.

El hash/`If-Match` actual ya es una forma de OCC. Añadir una revisión monotónica explícita mejora observabilidad y simplifica guards; no requiere eliminar el hash de integridad.

---

## 10. Estrategia de assets y caché

### Identidad

```ts
type AssetRef = {
  assetId: string;          // identidad lógica inmutable
  contentHash: string;      // identidad de bytes
  assetVersion: number;     // opcional, monotónica
  mimeType: string;
};
```

Reemplazar `avatar_v1.mp4` por `avatar_v2.mp4` debe cambiar `assetId`, `contentHash` o `assetVersion`. Sobrescribir bytes bajo la misma identidad impide invalidación determinista.

### Por capa

| Capa | Regla |
|---|---|
| Composition Store | Elemento referencia `AssetRef`; transform y asset son dependencias distintas |
| Asset Manager | Cache key `(assetId, contentHash)`; resuelve URL firmada sin confundir URL temporal con identidad |
| CDN/browser | Assets públicos content-addressed o `?v=checksum`; cache larga para bytes inmutables |
| URLs firmadas | Renovar antes de expirar; la firma puede cambiar sin que cambien los bytes |
| TanStack Query/SWR | Si se usan, invalidar metadata/query de ese asset; no invalidar todo el proyecto |
| Service worker | Versionar cache names y keys por hash; purgar solo entrada reemplazada |
| Blob/Object URL | Crear por versión; `URL.revokeObjectURL` al liberar o sustituir, nunca mientras lo usa un nodo |
| Frame cache | Key `(assetHash, frame/time, decodeProfile)` |
| React key | `elementId` para estabilidad normal; media child puede usar `${assetId}:${contentHash}` para recreación selectiva |
| `<video>` | Si cambia src: pausar, recordar tiempo relativo si aplica, asignar src/source, llamar `load()`, esperar metadata y restaurar playhead válido |

Recrear el nodo multimedia cuando cambie tipo, codec/source set, el navegador no reconverja tras `load()`, o deba resetearse el decoder. No recrearlo por posición, tamaño, opacidad, z-index o texto: eso perdería buffer y playhead sin necesidad.

**HECHO en Courseforge.** Los assets públicos del compiler incorporan checksum SHA-256 como `v`; los privados obtienen signed URLs de una hora al cargar preview; el redirect auxiliar es `private, no-store`. La base es buena. Falta que el Preview Bridge invalide el media node cuando cambia la referencia del documento, sin recompilar todo por transforms.

---

## 11. Sincronización timeline ↔ preview

### Propiedad del playhead

- `Playback Controller` posee `currentFrame`, `playing`, `playbackRate`, loop y clock source.
- `currentFrame` vive en Playback State, no en Composition State durable.
- Durante reproducción puede mantenerse fuera del render global de React y notificarse por RAF/suscripción, como hace HyperFrames Studio con `liveTime`.
- Al pausar/seek, se publica el frame estable necesario para controles y accesibilidad.

### Evaluación única

```ts
function evaluateComposition(
  composition: Composition,
  frame: number,
): EvaluatedFrame;
```

El evaluator resuelve clips activos, offsets, trims, transformaciones, interpolación, orden, audio y asset refs. Timeline y preview no deben implementar por separado “está activo entre start/end”. La timeline puede consumir un índice derivado del mismo modelo; el preview consume el frame evaluado.

Separar playback y composición evita incrementar la revisión durable 60 veces por segundo. Una modificación de timing invalida intervalos/índices temporales; mover el playhead solo evalúa, no modifica la composición.

---

## 12. Actualización incremental e invalidación

### Estrategia

Un scene graph retained-mode mantiene nodos por `elementId`. Cada comando produce un `ChangeSet`:

```ts
type ChangeSet = {
  revision: number;
  entities: string[];
  domains: Array<"transform" | "style" | "timing" | "asset" | "structure" | "global">;
};
```

| Cambio | Invalidación mínima | Qué preservar |
|---|---|---|
| Transform | Nodo, bounds/layout y región anterior+nueva | media buffer, timeline index |
| Estilo | Nodo y raster/effect dependiente | asset decode y nodos no afectados |
| Timing | Índice temporal del clip/track y frame actual | media bytes; layout si no depende del tiempo |
| Reemplazo asset | Handle/media child, metadata y frame cache del asset | transform, otras entidades |
| Estructura de escena | Escena/subárbol, orden y dependencias | escenas no afectadas |
| Global (fps/canvas) | Evaluator y viewport completo | asset bytes compatibles |

En preview DOM/React, reconciliation por claves estables suele bastar; no implementar dirty rectangles manuales antes de perfilar. En Canvas/WebGL, dirty flags por nodo/subárbol y, si el renderer lo soporta, dirty rectangles. Coalescer múltiples patches en el mismo `requestAnimationFrame`: actualizar store síncronamente, pintar una vez.

Memoizar por `(entity reference, frame-dependent inputs)`, no por un objeto composition recreado completo. La normalización y structural sharing hacen viable esta granularidad.

---

## 13. Paridad preview ↔ render final

**HECHO.** Courseforge usa `compileCompositionPreview()` tanto para interactivo como para snapshot, con targets `INTERACTIVE_PREVIEW` y `HYPERFRAMES_RENDER`. Es una base fuerte, pero las ramas por target pueden divergir.

Contrato recomendado:

```text
Composition snapshot R + frame N
              ↓
       evaluator compartido
        ↙             ↘
preview adapter     render adapter
        ↓             ↓
   pixels/state     pixels/state
```

Antes de render:

1. flush de autosave/outbox;
2. congelar `compositionRevision` y asset hashes;
3. generar snapshot content-addressed;
4. render report registra revision/hash;
5. comparar frames canónicos contra preview de la misma revisión.

No renderizar desde “lo último que tenga el backend” sin comprobar que coincide con la revisión visible y solicitada.

---

## 14. Evidencia de Remotion, HyperFrames y OpenMontage

### 14.1 Remotion

**HECHOS del checkout local 4.0.508:**

- `packages/player/src/Player.tsx:224` mantiene frame/playing como estado del Player.
- `actualInputProps` se memoiza por referencia de `inputProps` (`:428`) y se propaga al componente renderizado.
- `Sequence` usa un contexto central para offsets/ventanas temporales.
- El renderer instala los props serializados en `window.remotion_inputProps` (`packages/renderer/src/set-props-and-env.ts:118`).

**Implicación.** `<Player inputProps={newImmutableSnapshot}>` reacciona a nuevas props. Mutar un objeto ya entregado no convierte sus campos en observables y puede quedar oculto por memoización en el árbol del consumidor. Integrar un store externo correctamente significa seleccionar el snapshot/entidades relevantes, crear nuevas referencias y mantener el componente estable; usar `key` para remontar todo el Player en cada movimiento sería costoso y perdería playback.

**Courseforge.** `RemotionPreviewPlayer.tsx` construye props con `useMemo` desde config/assets/layout/timeline y los entrega a `Player`. Este camino es conceptualmente reactivo si sus entradas cambian inmutablemente. La composición final debe recibir exactamente el snapshot serializable usado por preview.

### 14.2 HyperFrames

**HECHOS del repositorio local:**

- Studio renderiza la composición dentro de un `iframe`; el chrome del editor vive fuera.
- `playerStore.ts` usa Zustand. `updateElement` hace `map`/spread inmutable (`:565`).
- `liveTime.ts` y el player separan el tick de alta frecuencia para evitar un render React global por frame.
- El SDK declara que `serialize()` recorre el DOM vivo; no mantiene otro árbol mutable (`packages/sdk/src/engine/model.ts:5`). La fuente durable del proyecto es el archivo/HTML, no el player store completo.
- `usePreviewPersistence.ts` crea una `domEditSaveQueue` serial.
- `useDomEditCommits.ts:333-340` omite reload solo cuando las operaciones son inline-style y la persistencia está probadamente sincronizada; si no, recarga para reconverger.
- `domEditCommitRunner.ts:25-37` usa guards monotónicos por commit/clave para ignorar resultados obsoletos.
- `useSdkSession.ts:193-200` documenta un único writer y un history de Studio autoritativo.

**Lección aplicable.** La edición puede ser optimista y flashless, pero necesita cola, identidad de commit y una política explícita de convergencia. HyperFrames no prueba que todo editor deba usar un único store JSON; sí demuestra que no se deben descartar saves y que el reload debe ser selectivo/fallback.

### 14.3 OpenMontage

**Identidad y estado confirmados.** El repositorio local se llama OpenMontage, declara ser un sistema de producción de video agentic open source, licencia AGPLv3, remoto `calesthio/OpenMontage`, rama `main` y commit local `cd9f3c1f...`.

**HECHOS:**

- Su arquitectura es instruction-driven: artefactos JSON, checkpoints y archivos son canónicos.
- `Backlot` es un board de observación. `backlot/README.md:16-27` dice que un watcher sobre `projects/` emite cambios por SSE y el navegador vuelve a obtener el estado.
- `backlot/server.py:132-148` agrupa cambios de filesystem; `:178-212` expone estado y SSE; el servidor “never writes to project directories”.
- El estado se deriva defensivamente de checkpoints, history, artifacts y renders en `backlot/state.py`.
- Remotion y HyperFrames son runtimes de composición seleccionables por herramientas, no un Composition Store interactivo del board.

**Límite.** No hay evidencia en Backlot de un editor visual de alta frecuencia comparable con SofLIA Engine. Su patrón fetch-after-change es adecuado para observabilidad de archivos producidos externamente, pero sería el patrón problemático para pointermove/preview local. No se extrapolan detalles internos inexistentes.

### 14.4 Benchmark comparativo

| Sistema | Fuente de verdad | Preview | Timeline | Persistencia | Optimistic UI | Invalidación | Undo/redo | Paridad render | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| Courseforge actual | Documento persistido + `payload` local + DOM de iframe, parcialmente duplicados | iframe compilado desde backend; DOM patch del activo | React sobre payload local | Patch PUT, hash/If-Match/RPC | Sí en payload y target activo | Refresh manual/play; assets por checksum | Agent proposal/inversas y versiones; no history general uniforme observado | Mismo compiler con dos targets | **Código local directo** |
| Arquitectura propuesta | Composition Store local revisionado | Suscripción/patch directa + reload de fallback | Mismo store/evaluator | Outbox async + OCC | Sí, siempre local-first | ChangeSet por dominio/entidad | Commands semánticos | Evaluator/snapshot común | **Recomendación** |
| Remotion Player | Props React + estado interno de frame | Componente React recibe `inputProps` | No es editor completo por sí mismo | Externa al Player | Depende del host | React reconciliation/Sequences | Externo | Misma composición y props serializados | **Código local 4.0.508** |
| HyperFrames Studio | DOM/archivo de composición + stores de player/editor | iframe, edits optimistas y reconvergencia | Zustand/player hooks | Cola serial a archivo, single writer | Sí | skip reload solo si durable; reload en estructural/fallo | History de Studio autoritativo | Timeline pausado/seek determinista | **Código local 0.7.106** |
| OpenMontage Backlot | Artefactos/checkpoints en disco | Board/media, no editor live comparable | Replay de run, no timeline de edición equivalente | Herramientas escriben; board read-only | No aplicable | watcher→SSE→refetch; cache de thumbnails por mtime/size | History de checkpoints | Herramientas de render con Remotion/HyperFrames | **Código local commit citado** |

---

## 15. Pseudocódigo TypeScript implementable

### 15.1 Acción inmutable

```ts
type ElementPatch = Omit<Partial<CompositionElement>, "transform"> & {
  transform?: Partial<CompositionElement["transform"]>;
};

type EditorState = {
  elementsById: Record<string, CompositionElement>;
  localRevision: number;
  updateElement: (id: string, patch: ElementPatch) => void;
};

const useCompositionStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    elementsById: {},
    localRevision: 0,
    updateElement: (id, patch) => set((state) => {
      const previous = state.elementsById[id];
      if (!previous) return state;

      const next = {
        ...previous,
        ...patch,
        transform: patch.transform
          ? { ...previous.transform, ...patch.transform }
          : previous.transform,
      };

      return {
        elementsById: { ...state.elementsById, [id]: next },
        localRevision: state.localRevision + 1,
      };
    }),
  })),
);
```

### 15.2 `MoveElementCommand` con undo/redo

```ts
interface EditorCommand {
  id: string;
  apply(): void;
  undo(): void;
  toPatch(): CompositionPatch;
}

class MoveElementCommand implements EditorCommand {
  readonly id = crypto.randomUUID();

  constructor(
    private readonly elementId: string,
    private readonly before: Point,
    private readonly after: Point,
    private readonly store: CompositionStoreApi,
  ) {}

  apply() {
    this.store.getState().updateElement(this.elementId, {
      transform: { x: this.after.x, y: this.after.y },
    });
  }

  undo() {
    this.store.getState().updateElement(this.elementId, {
      transform: { x: this.before.x, y: this.before.y },
    });
  }

  toPatch(): CompositionPatch {
    return {
      operationId: this.id,
      type: "element.transform",
      elementId: this.elementId,
      transform: this.after,
    };
  }
}
```

Un drag captura `before` en pointerdown, muestra drafts en pointermove y crea **un** comando con `after` en pointerup.

### 15.3 Autosave revisionado

```ts
class AutosaveManager {
  private queue: PendingCommand[] = [];
  private inFlight = false;
  private timer?: ReturnType<typeof setTimeout>;

  enqueue(command: PendingCommand) {
    this.queue = coalesce(this.queue, command);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  async flush() {
    if (this.inFlight || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue.splice(0);
    const baseRevision = syncStore.getState().persistedRevision;
    const requestId = crypto.randomUUID();

    try {
      const result = await persistence.save({
        projectId,
        requestId,
        baseRevision,
        operations: batch.map((item) => item.patch),
      });
      acceptSaveAck(result); // no rehidrata el documento visible
    } catch (error) {
      this.queue.unshift(...batch);
      syncStore.getState().markSaveError(error);
      scheduleRetryWithBackoff();
    } finally {
      this.inFlight = false;
      if (this.queue.length > 0) void this.flush();
    }
  }
}
```

### 15.4 Suscripción granular del preview

```ts
const unsubscribe = useCompositionStore.subscribe(
  (state) => state.elementsById[elementId],
  (element, previous) => {
    if (!element) return;
    const revision = useCompositionStore.getState().localRevision;
    previewBridge.patch({
      revision,
      operations: diffElement(previous, element),
    });
  },
  { equalityFn: Object.is },
);
```

En la implementación real conviene una sola suscripción a un journal de `ChangeSet`, no N suscripciones permanentes por cada elemento fuera de viewport.

### 15.5 Guard contra respuestas obsoletas

```ts
function acceptSaveAck(ack: SaveAck) {
  const sync = syncStore.getState();

  if (ack.projectId !== sync.projectId) return;
  if (ack.acceptedRevision < sync.persistedRevision) return;
  if (!sync.pendingRequestIds.has(ack.requestId)) return;

  syncStore.setState((state) => ({
    persistedRevision: Math.max(state.persistedRevision, ack.acceptedRevision),
    serverHash: ack.documentHash,
    pendingRequestIds: without(state.pendingRequestIds, ack.requestId),
    // Deliberadamente no se reemplaza composition/document.
  }));
}
```

El Preview Bridge aplica la misma regla: ignora patches con `revision <= previewRevision` y emite ACK solo después de pintar o alcanzar un estado evaluado equivalente.

---

## 16. Instrumentación propuesta

### Evento mínimo extendido

```ts
type EditorTelemetryEvent = {
  projectId: string;
  revision: number;
  elementId?: string;
  requestId?: string;
  baseRevision?: number;
  previewRevision?: number;
  source: "editor" | "timeline" | "inspector" | "preview" | "persistence";
  event:
    | "EDIT_COMMAND"
    | "STORE_UPDATED"
    | "PREVIEW_PATCH_RECEIVED"
    | "PREVIEW_RENDERED"
    | "SAVE_STARTED"
    | "SAVE_SUCCEEDED"
    | "SAVE_FAILED"
    | "SAVE_CONFLICT"
    | "PROJECT_REHYDRATED"
    | "ASSET_INVALIDATED";
  timestamp: string;
  monotonicMs: number;
};
```

### Detección automática de desincronización

Mantener cuatro gauges:

```text
commandRevision ≤ storeRevision
previewRevision ≤ storeRevision
persistedRevision ≤ storeRevision
```

- Tras `STORE_UPDATED(R)`, iniciar un deadline de 1–2 frames.
- El `iframe` recibe `{type: PATCH, revision: R}` y responde `{type: RENDERED, revision: R}` después de aplicar/evaluar.
- Si al vencer el deadline `previewRevision < storeRevision`, emitir `preview_revision_lag` con last operation/domain.
- Si el lag supera 250 ms pausado o 500 ms durante playback, capturar diagnóstico: hashes, IDs afectados, estado del iframe y cola.
- Si `previewRevision > storeRevision`, tratarlo como violación de sesión/proyecto y reconstruir el preview.
- `persistedRevision < storeRevision` es normal mientras haya autosave pendiente; alertar solo por edad/cola, no por desigualdad inmediata.

Métricas: input-to-store, store-to-preview-received, preview-received-to-paint, store-to-save-ACK, queue depth, conflicts, retries, reload rate y comandos descartados (debe ser cero).

---

## 17. Plan de pruebas

### Unitarias

- Patch inmutable cambia referencias del elemento/transform afectado y conserva las de entidades no afectadas.
- Selector de `element_24` notifica al moverlo y no al editar `element_25`.
- `MoveElementCommand.apply/undo/redo` produce exactamente before/after y una sola history entry.
- Coalescing convierte 120 pointermoves en un comando/save.
- Evaluator activa/desactiva clips correctamente en límites de frames.
- Guard rechaza ACK 181 cuando ya se aceptó 182.
- Cache key cambia con `contentHash`, no con transform.

### Integración store ↔ preview

1. Mover, redimensionar y cambiar estilo; esperar `PREVIEW_RENDERED` de la misma revisión sin save.
2. Editar z-order o timing y verificar todos los elementos afectados, no solo el seleccionado.
3. Simular backend lento/fallido; el preview permanece actualizado y aparece estado “sin guardar”.
4. Simular 409; el branch local no desaparece y se inicia rebase/resolución.
5. Undo/redo actualiza store y preview antes del ACK de persistencia.
6. Rehidratar con servidor inferior y confirmar que no pisa cambios locales.

### Assets

- Cambiar posición de video: cero requests nuevos del recurso y playhead preservado.
- Sustituir asset con hash nuevo: nuevo recurso, metadata/duración actualizadas, frame cache anterior no usada.
- Signed URL renovada con mismo hash: no interpretar como contenido distinto innecesariamente.
- Imagen→video o codec incompatible: recreación selectiva del media child.

### Carreras deterministas

Con Mock Service Worker o adapter fake:

```text
emitir A(181), emitir B(182)
resolver B primero, resolver A después
assert storeRevision = 182
assert previewRevision = 182
assert persistedRevision = 182
assert A no ejecutó setDocument
```

Aunque el MVP serialice, mantener esta prueba sobre el guard protege futuras optimizaciones.

### Paridad

- Congelar composición R y assets por hash.
- Evaluar frames 0, límites de Sequence/clip, mitad de animaciones y último frame.
- Comparar `EvaluatedFrame` estructural y screenshot preview/render con tolerancia definida.
- Falla si el render report no contiene R/hash esperado.

### Rendimiento

- Drag de 10 s con composición representativa: p95 input-to-paint < 32 ms y objetivo de 60 FPS.
- Cero saves por pointermove; un save al commit.
- Perfilar commits React, style/layout/paint, memoria de media y reload de iframe.
- Escenarios de 50/200/1000 elementos y múltiples videos; presupuestos separados para DOM y Canvas/WebGL si se introduce.

---

## 18. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Dos fuentes de verdad durante migración | Adapter único desde payload actual al store; feature flag; eliminar writes directos progresivamente |
| Patch del iframe no cubre toda semántica | Matriz de operaciones; reload automático para operación no soportada; ACK revisionado |
| Optimización prematura del renderer | Empezar con React/DOM + batch RAF; perfilar antes de dirty rectangles/WebGL |
| Conflictos destruyen cambios | Outbox local, rebase y UI de conflicto; nunca reemplazo ciego |
| History crece demasiado | Comandos semánticos, coalescing y checkpoints |
| Asset leaks | Lifecycle central de object URLs/decoders; tests de memoria |
| Preview/render divergen | Snapshot con revisión, evaluator compartido y visual regression |
| Migración afecta editor existente | Mantener selección/drag/resize/inspector; cambiar solo propagación y persistencia |
| Telemetría expone contenido | Registrar IDs, revisiones, dominios y hashes; no texto/URLs firmadas |

---

## 19. Roadmap priorizado

### Fase 0 — Diagnóstico verificable

1. Añadir revisiones y eventos en `Interaction → Store/payload → iframe → Save → Backend → Rehydration`.
2. Añadir ACK `PREVIEW_RENDERED(revision)` desde el iframe.
3. Medir comandos descartados por `saveInFlightRef`, reloads y latencia input-to-paint.
4. Reproducir matriz de operaciones: layout, crop, style, timing, layer, asset y estructura.

**Criterio de salida:** cada fallo puede clasificarse automáticamente como command/store/preview/persistence/asset.

### Fase 1 — Corrección MVP

1. Crear Composition Store Zustand hidratado con el documento actual.
2. Encapsular todas las ediciones en actions/commands inmutables.
3. Hacer que timeline, inspector, layers y preview consuman ese store.
4. Implementar Preview Bridge con patches revisionados y reload de fallback.
5. Sustituir `saveInFlightRef` por cola serial; separar save de refresh.
6. Guardar con OCC actual y guard de ACK obsoleto.

**Criterio de salida:** toda edición soportada es visible sin guardar/recargar; `previewRevision === storeRevision` en reposo; cero comandos descartados.

### Fase 2 — Robustez

1. Debounce/coalescing y outbox recuperable.
2. Undo/redo uniforme por comandos.
3. ChangeSets e invalidación por entidad/dominio.
4. Identidad/versionado y lifecycle central de assets.
5. Tests de conflictos, offline, rehidratación y rendimiento.

### Fase 3 — Paridad y evolución

1. Extraer/fortalecer evaluator compartido de frame.
2. Visual regression preview/render por revisión.
3. Workers/Canvas/WebGL solo si el perfil lo exige.
4. CRDT/colaboración únicamente cuando exista requisito multiusuario concurrente.

---

## 20. Decisión arquitectónica final

### ADR resumido

**Decisión:** adoptar un Composition Store local, inmutable y revisionado como fuente de verdad de la sesión; conectar el preview directamente mediante un Preview Bridge incremental; relegar persistencia y reload a procesos asíncronos de durabilidad/convergencia.

**Se conserva:** modelo documental, patch service, compiler HyperFrames, snapshot, assets por checksum y OCC por hash.

**Se reemplaza:** el gate booleano de saves, la dependencia del endpoint persistido para visibilidad de cada cambio y el refresh manual como protocolo normal.

**No se introduce en MVP:** CRDT, reconstrucción completa en Canvas/WebGL, un framework de estado nuevo ni remount del player por cada edición.

### Respuesta directa a la pregunta obligatoria

> Si el objetivo inmediato es eliminar la experiencia de “editar a ciegas”, ¿cuál es la arquitectura mínima que debe implementarse primero?

Implementar primero cuatro piezas:

1. **Composition Store local Zustand**, hidratado una vez y actualizado inmutablemente por cada comando.
2. **Preview Bridge revisionado**, suscrito directamente al store, que aplique patches al `iframe` y confirme `previewRevision`; reload automático solo para cambios estructurales o pérdida de convergencia.
3. **Command Dispatcher**, donde cada drag/resize se previsualiza en Interaction State y se confirma como un único comando en pointerup, con history preparado.
4. **Autosave Queue desacoplada**, serial, con debounce, `If-Match`/revisión y guards para que respuestas antiguas nunca reemplacen el documento local.

El orden es: instrumentar revisiones → introducir store/actions → conectar store al preview → reemplazar el gate por la cola → endurecer conflictos/assets/paridad. El flujo crítico queda:

```text
edición → comando local → store revision R → preview pinta R
                              └→ autosave async → backend confirma R
```

Con esto cada cambio es visible antes de cualquier respuesta de red, el backend puede fallar sin volver obsoleto el preview y la recarga deja de ser una dependencia funcional.

---

## Apéndice A — Índice de evidencia principal

### Courseforge

- `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx:159, 417, 503-594, 1309, 1331-1339, 1382-1391`
- `apps/web/src/app/api/production/hyperframes/drafts/[draftId]/preview/route.ts:19-30`
- `apps/web/src/app/api/production/hyperframes/drafts/[draftId]/document/route.ts`
- `apps/web/src/app/api/production/hyperframes/drafts/[draftId]/assets/[assetId]/route.ts:19-47`
- `apps/web/src/domains/production/composition-editor/composition-preview-compiler.service.ts:14-39, 898-959`
- `apps/web/src/domains/production/composition-editor/composition-preview-assets.service.ts:6-79, 96-100`
- `apps/web/src/domains/production/composition-editor/composition-preview-playhead.service.ts:39-48`
- `apps/web/src/domains/production/composition-editor/composition-snapshot.service.ts:95-99`
- `apps/web/src/domains/production/composition-editor/composition-document.service.ts`
- `apps/web/src/domains/materials/components/HyperframesCompositionPanel.tsx:85, 282`
- `apps/web/package.json:19, 24, 47`

### HyperFrames

- `packages/studio/src/player/store/playerStore.ts:109-133, 515-570`
- `packages/studio/src/player/store/liveTime.ts`
- `packages/studio/src/player/hooks/useTimelinePlayer.ts`
- `packages/studio/src/hooks/usePreviewPersistence.ts:109-164`
- `packages/studio/src/utils/domEditSaveQueue.ts:38-107`
- `packages/studio/src/hooks/useDomEditCommits.ts:293-347`
- `packages/studio/src/hooks/domEditCommitTypes.ts:17-30`
- `packages/studio/src/hooks/domEditCommitRunner.ts:25-45`
- `packages/sdk/src/engine/model.ts:1-5`
- `packages/studio/src/hooks/useSdkSession.ts:193-200`

### Remotion

- `packages/core/src/version.ts:8`
- `packages/player/src/Player.tsx:224, 428, 457-471`
- `packages/core/src/Sequence.tsx`
- `packages/renderer/src/set-props-and-env.ts:118`

### OpenMontage

- `README.md`
- `PROJECT_CONTEXT.md`
- `AGENT_GUIDE.md`
- `backlot/README.md:16-33`
- `backlot/server.py:1-5, 132-148, 178-240, 295-305`
- `backlot/state.py:1-5, 588-658`
