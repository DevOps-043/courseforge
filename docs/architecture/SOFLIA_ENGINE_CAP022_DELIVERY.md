# CAP-022 / R13 — entrega aislada

Fecha: 2026-10-06. Estado: implementación parcial; QA formal pendiente.

## T022-1 — auditoría y propuesta de integración

Base comprobada: rama `stagin-2`, HEAD `96a191b9dfb4dc1bf8060e364816bb5079a1e273`, checkout inicialmente limpio. El commit consolida el avance local del corte `7e16e8c3`: incluye los tres archivos de media-derivatives y los archivos nuevos del traspaso. No fue necesario reconstruir trabajo faltante.

Leídos AGENTS.md, traspaso, roadmap y registro de requisitos. Contrato V1 existente: tenant/SHA/duración/intervalo/LOD/página, WebP 160×90, ocho columnas, 64 tiles, máximo 8 MiB por sprite y 512 tiles visibles. El planificador conserva offsets absolutos, viewport semiabierto y prioridad por distancia al playhead. Se reutilizan sin alterar identidad ni contrato.

La infraestructura actual `production_jobs` tiene idempotencia por tenant y recuperación de conflictos únicos; los tipos/provider registry no admiten thumbnails. El claim genérico cambia PENDING→RUNNING, pero no proporciona lease/fence/cancelación para este trabajo. Audio dispone de leases/RPC específicos y no puede recibir un job de video por disfrazar su tipo. No se implementará otra cola ni un scheduler local.

Interfaces **locales propuestas**, sin modificar contratos compartidos:

- Autoridad: resolver cada petición desde actor/organización/componente/asset autenticados; obtener fuente vigente, checksum, duración, tamaño, MIME y dimensiones del registro servidor. Revalidar antes de entregar/publicar. La cache key nunca concede permiso.
- Ejecutor: dependencia host-only de contención, con probe/generación/decodificación de sprite dentro del aislamiento y AbortSignal. Sin implementación predeterminada ni fallback a execFile en el proceso web. Ningún booleano de una petición o test acredita aislamiento.
- Almacenamiento: lookup por identidad V1, lectura acotada, publicación create-only y lectura de comprobación; binding completo tenant/identidad/hash/tamaño. Manifiesto y blobs externos al documento. Caché inválida produce error explícito, no entrega de bytes.
- Jobs: adapter de solicitud idempotente y handler de un claim ya adquirido. Lease/fence, estado durable, concurrencia, cancelación y commit atómico pertenecen a la infraestructura existente; las pruebas de ports simulados solo acreditan el contrato del handler.
- Cliente: loader inyectado y hook/componente aislados que consumen el plan por viewport/playhead, cancelan trabajo obsoleto y liberan URLs temporales. No importan ni mutan documento, render o editor compartido.

### Propuesta reservada para el responsable del núcleo

1. Añadir `THUMBNAIL_SPRITE_GENERATION` al catálogo común y permitirlo para FFmpeg; adaptar `createOrReuseProductionJob` preservando dedupe tenant-scoped. Extender el lease/fence/cancel/heartbeat existente mediante operaciones específicas sobre `production_jobs`, sin otro motor. El commit de manifiesto y SUCCEEDED debe comprobar el mismo lease vigente y ausencia de cancelación, con límite/backpressure por organización. Solicitud idempotente por componente+identidad; caché reutilizable entre componentes solo después de autorizar la fuente actual de cada uno.
2. Reader/solicitud/cancelación autenticados: resolver el tenant desde sesión y ownership, nunca desde body; verificar vínculo component/asset/draft vigente. Respuestas privadas no-store, sin URLs de origen ni locators Storage en el cliente. La cancelación de un consumidor de lectura no cancela un job durable compartido.
3. Almacenamiento privado create-only bajo tenant e identidad digestada y SHA del sprite, sin upsert sobre originales. CAS de índice/manifiesto y recuperación de ACK incierto; no borrado compensatorio de objetos compartidos. RLS, FK tenant-first y permisos actuales requieren propuesta SQL/Storage separada, revisión y pruebas reales posteriores.
4. Elegir/proveer ejecutor restringido Linux o Windows: filesystem efímero exclusivo, fuente de solo lectura, sin egress ni credenciales, binarios fijados, cuotas OS CPU/memoria/procesos/disco y cancelación de árbol entero. El Job Object de CAP-027 no demuestra contención filesystem/red/token y no se modifica aquí.
5. El núcleo realiza wiring de timeline/biblioteca y regresiones CAP-023/026/027. No se propone reemplazar fuentes finales por thumbnails ni proxies.

Supabase: [control de acceso Storage](https://supabase.com/docs/guides/storage/security/access-control) y [uploads/create-only](https://supabase.com/docs/guides/storage/uploads/standard-uploads) revisados. Service key elude RLS: el adapter privilegiado necesita autorización explícita previa. El changelog Markdown no fue legible mediante web (content-type); no se implementan APIs Supabase ni se afirma compatibilidad nueva verificada.

### Decisiones externas necesarias

Aceptar/adaptar operaciones de jobs comunes, rutas y Storage; proporcionar el ejecutor contenido. Hasta entonces estas conexiones son implementación pendiente, no QA pendiente. No se aplican migraciones, flags ni deploy. Proxies: sin mediciones reales, decisión diferida; no se generan ni se inventa un umbral aprobado.

## Evidencia y cierre de actividades

El usuario confirmó que **el responsable del núcleo integra la propuesta**, incluidas las dependencias reservadas y el ejecutor con contención real. Se completó el trabajo independiente dentro de media-derivatives; CAP-022 permanece parcial por las conexiones e implementaciones concretas indicadas abajo. No corresponde declarar «implementación completada, QA pendiente» para el CAP.

## T022-2 — productor/verificador y adapter de jobs/cache

Implementado el orquestador de una página: autorización → cache hit verificado o descarga acotada/hash → revalidación → probe aislado inyectado → receta de timestamps → generación inyectada → comprobación de manifiesto/hash/RIFF/geometría → decodificación completa inyectada → revalidación → publicación create-only/readback → revalidación final. La identidad, fuentes y documento originales no se mutan. El runtime recibe copias de metadata/identidad/receta; la mutación del buffer se detecta.

La verificación propia de RIFF solo admite el subconjunto WebP estático simple VP8/VP8L, rechaza extensión/animación/metadatos, longitud/padding/trailing bytes inválidos y exige dimensiones exactas. **La inspección de header no demuestra decodificación**: el port `inspectSprite` debe decodificar íntegramente dentro del ejecutor contenido. `sourceTimestampsMs` se coteja con el plan V1; esta prueba de metadata tampoco demuestra que el contenido visual corresponda al frame real. Eso depende de la implementación concreta del productor/inspector del núcleo y su evidencia posterior.

Adapter request/cancel autorizado y handler de un claim existente: llave por tenant+componente+asset+identidad; colaboradores autorizados comparten job del componente. Heartbeat renueva el lease mediante el port existente y aborta ante cancelación/pérdida/incertidumbre. Fallo de ACK de completion conserva UNCONFIRMED sin convertirlo en fallo ni reintentar. Interrupción local no cancela automáticamente un job durable compartido. No hay scheduler, claim local, cola o retry engine nuevos.

Cache V1: TTL acotado de índice, identidad/tenant/objectKey exactos, SHA y bytes comprobados en cada lectura, miss explícito para expiración. Renovación del índice por CAS sobre el mismo blob inmutable; no upsert/borrado de originales ni eliminación compensatoria de objetos compartidos. `storeForClaim` tiene que cercar escrituras contra lease/cancelación actuales: **el código local no aporta transacciones DB ni reemplaza el fence durable**.

Presupuestos locales propuestos: fuente hasta 256 MiB y 33,177,600 píxeles; sprite hasta 8 MiB y 64 tiles; deadline de operación 120 s; TTL de índice hasta 24 h. Son límites de admisión, no cuotas OS medidas ni aprobación de capacidad. El buffering/copia/hash puede consumir más memoria que el tamaño del archivo; el host debe definir concurrencia, streaming/materialización y cuotas reales antes de habilitarlo. Binarios/codecs/probe/timestamps efectivos y generación real dentro de contención siguen pendientes del núcleo.

## T022-3 — reader autorizado y UI aislada

Reader reautoriza actor/tenant/componente/asset actual antes de consultar cache y antes de devolver bytes, rechaza SHA/duración/metadata obsoletos y no devuelve locators ni URLs de origen. Requiere una fuente inmutable comprobada por el adapter de autoridad; una fila de checksum sin control de la versión física no basta. La entrega HTTP/autorización de sesión/Storage concretas están pendientes del núcleo.

Loader cliente inyectado, asignación por prioridad del planificador con dos lecturas simultáneas, hasta nueve páginas/512 tiles, 72 MiB de bytes comprimidos y 36 MiB de buffers decodificados estimados. Coteja manifiesto/identidad/hash antes de crear blob URLs, descarta resultados tardíos y libera recursos en fallo/cancelación/dispose. El transporte suministrado por el núcleo debe limitar bytes **durante** la descarga: una validación posterior de Uint8Array no limita una asignación previa del transport. No hay caché persistente de grants en el cliente.

Hook keyed por acceso/input/loader, oculta resultados de una petición anterior y limpia abort/resources al cambiar viewport, playhead o acceso. El host debe renovar `accessKey` con actor/tenant/componente/asset/epoch de permiso y proporcionar un loader estable. Componente decorativo con clipping/celdas exactos y estados loading/error/missing; no tiene handlers de edición ni imports del documento/editor/render. Montaje real del hook, navegación, revoke en browser y wiring compartido quedan pendientes de integración/QA.

## T022-4 — entrega al responsable del núcleo

| Requisito | Entrega local | Pendiente de implementación del núcleo | QA pendiente |
| --- | --- | --- | --- |
| Identidad y planificación | Reutilización de los tres archivos V1 sin modificaciones | Wiring de consumidores | Viewport/zoom/playhead en sesión real |
| Productor/verificador | Orquestador, receta, SHA/header/manifiesto/readback y ports | Probe/generador/decodificador contenido reales, binaries fijados, contención OS | Corpus real/malicioso, VFR/rotación/seek/EOF/tiempos, calidad visual |
| Jobs/cancelación | Adapter de solicitud/cancelación y un claim/heartbeat/ACK | Catálogo/driver de production_jobs, leases/fences/commit/backpressure/reconciliación reales | Locks/CAS/crash/cancel races/multiworker |
| Caché | Binding, integridad, TTL/miss/renovación/readback | Índice durable y Storage privado inmutable con CAS/retención | Alteración de objetos/permisos/ACK incierto reales |
| Acceso tenant | Guards independientes y revalidación por lectura | Autoridad autenticada/ownership/asset link, transporte privado | RLS/session/revocación/cross-tenant reales |
| UI | Loader/hook/strip aislados | Loader HTTP y wiring timeline/biblioteca por el núcleo | React/browser/navegación/recursos/accesibilidad |
| Originales/documento/render | No imports ni mutaciones; copias/guards verificadas | Comprobar invariantes en checkout de integración | Regresiones CAP-023/026/027 |
| Proxies | No generación ni selección universal | Medir assets/scrub y resolver DEC-102 solo si hay necesidad demostrada | Benchmarks/calidad/timing si se justifica un proxy |

Integración propuesta, sin rutas nuevas en este paquete:

1. Host privado implementa `ThumbnailAuthority`, `ContainedThumbnailRuntime`, `ThumbnailStore` y `ThumbnailProductionJobsPort`. No aceptar estas capacidades ni actor/tenant desde una petición. Resolver metadata/paths/buckets server-side contra registro y objeto exactos; abortar transport y procesos realmente, sin egress/credenciales dentro del decoder.
2. Request/cancel invocan `requestThumbnailJob`/`cancelThumbnailJob`; el driver común adapta `createOrReuseProductionJob` con el tipo propuesto. El worker existente adquiere un claim fenced y llama `processClaimedThumbnailJob`; `storeForClaim` y `complete` validan lease actual/cancel/source grants. No basta conectar el claim genérico PENDING→RUNNING.
3. Reader invoca `readAuthorizedThumbnail`; HTTP es privado/no-store y vuelve a validar sesión. El loader frontend transforma la entrega bounded a `{manifest, bytes}`; un miss no implica job automático, lo coordina el host autorizado.
4. El núcleo conecta `<ThumbnailViewportStrip input={planInput} load={authorizedLoader} accessKey={currentAccessEpoch} />`, sin sustituir fuentes de render. Revisar y ejecutar pruebas de ambos frentes en el checkout de integración.

Métricas previstas (sin resultados medidos aquí): cache hit/miss/invalid por perfil/LOD, tiempos de adquisición/probe/generación/verificación/primer thumbnail p50/p95, bytes y recursos del viewport, cancelaciones/lease lost/ACK inciertos/cola por tenant. DEC-102 requiere comparar scrub frío/caliente y resolution/bitrate/codec sobre corpus autorizado y mismo hardware/browser; ≤100 ms caliente/≤300 ms frío son presupuestos objetivo del roadmap, no benchmarks obtenidos. No inferir necesidad de proxy de tiempos de tests sintéticos.

### Archivos afectados por este paquete

Todos los archivos de código/test nuevos están bajo `apps/web/src/domains/production/media-derivatives/`:

- `thumbnail-runtime.contract.ts`: contratos locales/ports/presupuestos/deadline.
- `thumbnail-verifier.server.ts`: lectura bounded, SHA, RIFF estático, geometría/receta/objectKey/inspector.
- `thumbnail-producer.server.ts`: orquestación de generación/cache/publicación.
- `thumbnail-reader.server.ts`: autorización/revalidación y lectura privada verificada.
- `thumbnail-jobs.adapter.server.ts`: request/cancel y handler de un claim existente.
- `thumbnail-viewport.client.ts`: consumo acotado/recursos/cancelación/integridad del viewport.
- `useThumbnailViewport.ts`, `ThumbnailViewportStrip.tsx`: hook y vistas React aisladas.
- `tsconfig.unit.json`: compilación local sin modificar configs/scripts/packages comunes.
- Tests: `__tests__/thumbnail-fixtures.ts`, `thumbnail-verifier.test.ts`, `thumbnail-producer-reader.test.ts`, `thumbnail-jobs.test.ts`, `thumbnail-viewport.test.tsx`.
- Nota exclusiva: este archivo. Contratos/planificador/tests anteriores permanecen sin cambios.

Durante el trabajo aparecieron cambios paralelos CAP-025 en composition-agent y su nota exclusiva. No se modificaron/revirtieron ni se incorporan como entrega CAP-022. CAP-027 y el seguimiento general no se editaron.

### Pruebas ejecutadas y límites de evidencia

```powershell
node node_modules/typescript/bin/tsc -p apps/web/src/domains/production/media-derivatives/tsconfig.unit.json
node --test apps/web/.tmp/media-derivatives-tests/__tests__/*.test.js
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
```

Build aislado: aprobado. Selección final: **50/50** tests (incluye nueve existentes del planificador), cero fallos/skips. Cubre acceso cruzado, bindings actor/asset/componente, corrupción igual tamaño, MIME/RIFF/timestamps/dimensiones, stream/viewport/budgets, metadata obsoleta, revocación pre-entrega/publicación, cancelación y resultados tardíos, concurrencia create-only, renovación de índice, idempotencia de requests, lease perdido, heartbeat incierto y ACK perdido/malformado; React se renderiza a markup estático. Verificación de whitespace de los quince archivos nuevos aprobada con lectura PowerShell; `git diff --exit-code` confirma sin cambios los tres archivos de base de thumbnails. La comprobación inicial `git diff --no-index --check NUL` devolvió exit 1 sin diagnóstico y no se contabiliza como gate aprobado.

TypeScript web global: **no aprobado**, cuatro TS2345 `Buffer<ArrayBufferLike>` versus `Buffer<ArrayBuffer>` en `composition-text-contract.test.ts:181` y `composition-text-paint-mask-capture.test.ts:59,111,133`. Están fuera del alcance, en áreas reservadas; no se corrigieron ni se declara build general verde. No hay errores reportados en media-derivatives en esa ejecución.

Hashes SHA-256 reales sobre buffers y guards locales sí se ejecutaron. Autoridad/Storage/jobs/probe/generación/full decode/resources URL son ports simulados; la fixture RIFF es un header sintético, **no una imagen comprimida válida ni evidencia de aislamiento**. SSR React no monta effects ni acredita lifecycle/browser. Sin DB/Storage/session/HTTP/worker/codec/contención reales, sin mediciones productivas ni render, QA formal, migraciones, flags o despliegue. No se publica porcentaje: no hay rúbrica auditada de implementación CAP-022.
