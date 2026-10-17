# Arquitectura, operaciones, seguridad y roadmap del editor multimedia

> Artefacto 3. Síntesis técnica sobre el commit `702e7d34000fe0957c2ba8d37f1f9137def58150`.

Seguimiento operativo de las siete capacidades prioritarias: [hoja de seguimiento](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_DELIVERY_TRACKER.md).

Trabajo con un segundo desarrollador: [traspaso, paquetes y reservas de integración](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_PARALLEL_DEVELOPMENT_HANDOFF.md). Las asignaciones son propuestas; no alteran el alcance original ni habilitan QA, migraciones o rollout.

Actualización de implementación 2026-10-01: CAP-027 dispone de contrato opt-in v4 para texto/captions nativos, con expectativas por checkpoint congeladas desde documento, validación independiente en productor/lector, captura obligatoria, comparador local PNG y rechazo de PASS incompleto en job/SQL preparado. Políticas opcionales separadas cubren opacidad motion (v1) y ventanas/opacidad parental de transición (v2), con flags estrictos e identidad separada para reutilización; estados HIDDEN siguen incluidos y medidos. No activa rollout ni reinterpreta contratos previos. Esto no cierra §6: aún faltan geometría/oclusiones de transiciones y fades, motion fuera de canvas, texto de decks HTML, identidad efectiva entorno/versiones/fonts/color y audit corpus/checkpoints/diagnóstico. Evidencia técnica y restricciones de QA/migración en la hoja de seguimiento; CAP-027 permanece Parcial.

Actualización adicional: la política opt-in `NATIVE_TRANSITION_APPEARANCE_GSAP_V3` agrega opacidad efectiva y overlays de canvas completo verificablemente opacos. Permite referencias planas justificadas por el contrato sin relajar umbrales locales; captura/testigo cotejan el plan congelado y acotan trabajo de ancestros/overlays. No cubre todavía máscaras, transformaciones fuera de canvas ni oclusiones generales. La flag de apariencia v3 continúa desactivada y no cambia los contratos históricos; detalle y pendientes vigentes en la hoja de seguimiento.

Actualización geométrica: `NATIVE_TRANSFORM_CLIP_GEOMETRY_GSAP_V4` congela poses y soporte convexo nativo y exige contraste con estructura/matrices/recortes DOM antes de fijarlos en evidencia privada. Gate local admite ausencia en una región medida con soporte vacío y blur cero sin relajar umbrales. Flag `COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4` permanece desactivado; versiones anteriores no se reinterpretan. Aún faltan ausencia fuera del canvas, máscaras/intersecciones completas, expansión de blur y oclusiones generales, además de los pendientes de decks/entorno/corpus de §6. Estado: Parcial, no cierre de QA.

Actualización de ausencia fuera del canvas: la política geométrica v4 permite `CANVAS_ABSENCE_PROBE` solo con soporte vacío sin blur y pose DOM verificada. Mide todo el frame sin shifts y sin píxeles fuera de delta RGB 4, reutilizando un escaneo entre candidatos; marcador/dimensiones/prueba quedan vinculados a evidencia privada y contrato. Sigue pendiente la ausencia parcial por glifo, blur/oclusiones y los demás requisitos de §6. No rollout ni QA real; CAP-027 permanece Parcial.

Actualización tipográfica: snapshot/productor/lector/materializador/captura validan identidad de archivos y cobertura documental. Preview carga explícitamente las FontFace y vincula eventos Chromium con archivos locales para detectar glyph fallback; conserva evidencia privada hash-pinned. La política opt-in `DECLARED_CUSTOM_NATIVE_FONT_USAGE_V1` congela manifest/bindings independientes en v4 y exige evidencia contra ellos en paquete/lector/comparador, sin permitir omisión conjunta. Reutilización distingue presencia/ausencia exacta de política. El evaluador conserva INCOMPLETE con bindings custom requeridos hasta implementar evidencia/gate de renderer; no extrapola preview a render. Faltan renderer, fonts de sistema y entorno/color efectivos de §6. CAP-027 sigue Parcial; QA real y rollout permanecen aplazados.

## 1. Decisión arquitectónica

Conservar y endurecer este flujo:

```text
UI / shortcuts / templates / automations / agents
                         │
                         ▼
              Editor Operation Gateway
       schema · auth · preconditions · policy
                         │
                         ▼
              Pure Document Evaluator
       apply · validate · inverse · semantic diff
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
   Session store   Append/OCC       Preview adapter
   undo/journal    + audit log      live/recompile
                                          │
                                          ▼
                              Snapshot + HyperFrames render
```

No se recomienda reescribir el editor ni convertir HyperFrames Studio en fuente de verdad. El cambio clave es formalizar el gateway compartido y completar command stack, side effects y conformidad preview/render.

## 2. Contrato recomendado de operación

Toda operación interna debe incluir:

```ts
type EditorCommand<TPayload> = {
  operationId: string; // UUID, idempotencia de sesión
  type: string; // allow-list versionada
  schemaVersion: number;
  documentId: string;
  baseDocumentHash: string;
  actor: {
    userId: string;
    organizationId: string;
    origin: "USER" | "AGENT" | "AUTOMATION";
  };
  payload: TPayload;
  expectedEffects: {
    temporalRanges: Array<{ start: number; end: number }>;
    visualTargets: string[];
  };
  correlationId: string;
  createdAt: string;
};
```

El evaluator devuelve documento candidato, inversa, diff semántico, estrategia de preview y eventos. La persistencia revalida autorización, tenant, hash base y referencias a assets. La inversa solo revierte documento; uploads, procesamiento, render y publicación usan jobs durables, claves de idempotencia, cancelación y compensaciones explícitas.

## 3. Matriz D — arquitectura de operaciones

| OP-ID  | Operación                 | Contrato actual  | Contrato recomendado                                                  | Determinista  | Reversible                   | Atómica         | Agent-safe                  | Render         | Compatibilidad/migración                  |
| ------ | ------------------------- | ---------------- | --------------------------------------------------------------------- | ------------- | ---------------------------- | --------------- | --------------------------- | -------------- | ----------------------------------------- |
| OP-001 | `clip.move`               | Existe           | Añadir affected range e idempotency metadata                          | Sí            | Sí                           | Sí              | Sí, con límites             | Recompila      | Compatible                                |
| OP-002 | `clip.trim`               | Existe           | Conservar handles y relaciones linkadas explícitas                    | Sí            | Sí                           | Sí              | Propuesta                   | Recompila      | Compatible                                |
| OP-003 | `clip.split`              | Existe           | Declarar IDs reservados y transferencia de relaciones                 | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | Compatible                                |
| OP-004 | `timeline.ripple-delete`  | Ausente          | Rango, pistas afectadas, linked policy y gap policy                   | Sí            | Sí                           | Sí              | Confirmación                | Sí             | Aditiva                                   |
| OP-005 | `timeline.insert`         | Implícita en add | Modo insert, scope de ripple y preflight de canvas                    | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | Deprecar semántica implícita gradualmente |
| OP-006 | `timeline.overwrite`      | Ausente          | Rango explícito y estrategia para relaciones cortadas                 | Sí            | Sí                           | Sí              | Confirmación                | Sí             | Aditiva                                   |
| OP-007 | `clip.duplicate`          | Ausente          | IDs nuevos, assets referenciados, offset cuantizado                   | Sí            | Sí                           | Sí              | Sí                          | Sí             | Aditiva                                   |
| OP-008 | `selection.align`         | Ausente          | Target, eje y anchor determinista                                     | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | Aditiva                                   |
| OP-009 | `selection.distribute`    | Ausente          | Orden, eje, spacing y límites                                         | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | Aditiva                                   |
| OP-010 | `group.*`                 | Existe           | Mantener USER-only para creación destructiva; diff completo           | Sí            | Sí                           | Sí              | Lectura; propuesta limitada | Recompila      | Compatible                                |
| OP-011 | `clip.layout`             | Existe           | Separar patch visual efímero del command persistido                   | Sí            | Sí                           | Sí              | Sí, acotado                 | Live DOM       | Compatible                                |
| OP-012 | `clip.crop`/`media-fit`   | Existe           | Invariantes por tipo y source aspect                                  | Sí            | Sí                           | Sí              | Sí                          | Live DOM       | Compatible                                |
| OP-013 | `track.update`            | Existe           | Campo individual o patch estricto con permisos                        | Sí            | Sí                           | Sí              | Propuesta                   | Recompila      | Compatible                                |
| OP-014 | `audio-mix.update`        | Existe           | Añadir reason/preset y loudness target separado                       | Sí            | Sí                           | Sí              | Sí                          | Sí             | Compatible                                |
| OP-015 | `audio.normalize-request` | Ausente          | Job sobre asset derivado; nunca mutar binario fuente                  | Sí por perfil | Compensable                  | No DB/proveedor | Confirmación                | Sí             | Nueva tabla/job                           |
| OP-016 | `clip.text-content`       | Existe           | Locale/dir y límites Unicode explícitos                               | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | Compatible                                |
| OP-017 | `clip.caption-cues`       | Existe           | Patch por cue y batch import diferenciado                             | Sí            | Sí                           | Sí              | Sí con diff                 | Sí             | Compatible                                |
| OP-018 | `animation.*`             | Existe           | Unificar metadata de ranges/inversas                                  | Sí            | Sí                           | Sí              | Sí, allow-list              | Sí             | Compatible                                |
| OP-019 | `transition.*`            | Existe           | Mantener preflight de handles y costo                                 | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | Compatible                                |
| OP-020 | `asset.replace-reference` | Ausente          | Asset destino interno, compatibilidad, checksum y fallback            | Sí            | Sí doc / no binario          | Sí doc          | Confirmación                | Sí             | Aditiva                                   |
| OP-021 | `html.setText`            | Ausente          | `elementId`, string, locale; sin HTML                                 | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | Requiere HTML schema V1                   |
| OP-022 | `html.setAttribute`       | Ausente          | Atributo declarado + valor schema; bloquear `on*`, `style`, URL libre | Sí            | Sí                           | Sí              | Propuesta                   | Live/recompila | HTML schema V1                            |
| OP-023 | `html.setStyleToken`      | Ausente          | Token ID y valor enumerado/rango                                      | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | HTML schema V1                            |
| OP-024 | `html.setImage`           | Ausente          | Asset ID organizacional, slot y fit                                   | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | HTML schema V1                            |
| OP-025 | `html.setVisibility`      | Ausente          | Elemento expuesto y booleano                                          | Sí            | Sí                           | Sí              | Sí                          | Live/recompila | HTML schema V1                            |
| OP-026 | `html.reorderElement`     | Ausente          | Solo slots repetibles declarados, índices acotados                    | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | HTML schema V1                            |
| OP-027 | `html.updateChartData`    | Ausente          | Dataset tipado, límites de filas/series/labels                        | Sí            | Sí                           | Sí              | Propuesta                   | Sí             | HTML schema V1                            |
| OP-028 | `html.resetOverride`      | Ausente          | Elemento + propiedad o all                                            | Sí            | Sí                           | Sí              | Sí                          | Sí             | HTML schema V1                            |
| OP-029 | `document.restore`        | Existe           | Conservar como nueva versión y requerir confirmación                  | Sí            | Compensable con otro restore | Sí              | Prohibida directa           | Sí             | Compatible                                |
| OP-030 | `render.request`          | Job existente    | Hash snapshot + profile + idempotency + budget                        | Sí entrada    | No; cancelable               | No externa      | Confirmación                | Dispara render | Compatible                                |
| OP-031 | `publication.submit`      | Fuera del núcleo | Snapshot publicado inmutable + outbox                                 | Sí entrada    | Compensable según proveedor  | No externa      | Prohibida directa           | Usa final      | Integrar por evento, no patch             |

### Ficha operacional común

- Precondiciones: hash base, versión de schema, rol/ownership, track desbloqueado, assets READY del mismo tenant.
- Validaciones: schema estricto, límites de batch, temporalidad cuantizada, no overlap ilegal, invariantes de motion/transiciones y presupuesto.
- Inversa: generada desde el estado previo y validada reproduciendo el hash base en simulación.
- Persistencia: append OCC con `operationId` único por documento; una repetición devuelve el resultado previo.
- Auditoría: tipo, actor, origin, hash before/after, affected IDs/ranges, risk, correlation ID; nunca texto sensible, URLs firmadas ni prompt completo.
- Fallo parcial: ninguna operación puramente documental persiste a medias. Jobs externos usan outbox/inbox y estados terminales; una compensación nunca se presenta como rollback ACID.

### Política de agentes

- Seguras sin confirmación adicional dentro de una propuesta ya aprobada: texto, estilos/tokens allow-listed, layout acotado, caption cues, presets, visibilidad no destructiva reversible.
- Requieren propuesta y confirmación: remove/ripple/overwrite, replace asset, cambios amplios, ocultar contenido, audio processing, restore, snapshots y render pagado.
- Prohibidas: upload desde URL arbitraria, borrado binario, secretos, publicación, cambio de permisos/RLS, JavaScript/CSS/HTML arbitrario y acceso cross-tenant.

## 4. HTML/CSS editable

### Evaluación de modelos

| Criterio                      | A: DOM arbitrario inspeccionable    | B: HTML instrumentado          | C: componentes declarativos    |
| ----------------------------- | ----------------------------------- | ------------------------------ | ------------------------------ |
| Flexibilidad                  | Muy alta                            | Alta                           | Media/alta                     |
| Seguridad                     | Baja; sanitizer no define semántica | Media; allow-list por manifest | Alta; schema cerrado           |
| Selector estable              | Baja sin instrumentación            | Alta con `data-editable-id`    | Muy alta por component/slot ID |
| Undo/diff/agentes             | Frágil                              | Bueno                          | Excelente                      |
| Preview/render                | Riesgo de drift                     | Controlable                    | Determinista                   |
| Migración de decks existentes | Directa pero insegura               | Factible por instrumentador    | Requiere template/adaptador    |
| Mantenibilidad                | Baja                                | Media                          | Alta                           |
| Recomendación                 | Solo importación/diagnóstico        | Puente para legado             | Modelo canónico                |

### Decisión

Usar **C como fuente canónica** y **B como adaptador de decks existentes**. A no es un formato editable: puede servir para descubrir candidatos, sanitizar y generar un manifest que luego debe revisarse o transformarse.

```text
HtmlCompositionAsset V1
├── immutableSource { storageObjectId, sha256, sanitizerVersion }
├── template { templateId, version, rendererVersion }
├── editableManifest[]
│   ├── elementId estable
│   ├── kind: text | image | token | chart | repeated-slot
│   ├── property schemas y límites
│   └── label, locale, accessibility contract
├── overrides { elementId -> validated properties }
├── designTokenSet { id, version }
├── externalResources[] congelados por asset ID/hash
└── protocolVersion
```

El renderer reconstruye desde source/template + manifest + overrides. Nunca serializa mutaciones DOM como fuente canónica.

### Sandbox obligatorio

- `iframe sandbox="allow-scripts"` solo si el runtime necesita script determinista. No `allow-same-origin`, popups, forms, downloads, presentation, top-navigation ni storage access.
- Origen opaco: mensajes desde el frame llegan como `origin: "null"`; por tanto validar estrictamente `event.source === iframe.contentWindow`, `MessagePort` entregado durante handshake, nonce de sesión aleatorio, versión, secuencia monotónica, document hash y schema. Para enviar al frame puede requerirse `targetOrigin="*"`; el secreto está en source/channel/nonce, no en confiar en `null`.
- CSP del documento: `default-src 'none'`; `script-src` solo runtime hash/nonce empaquetado; `style-src` hash o CSS local; `img-src`/`media-src` solo `blob:` y origen interno autorizado; `font-src` local; `connect-src 'none'`; `frame-ancestors` explícito; `base-uri 'none'`; `form-action 'none'`; `navigate-to 'none'` donde esté soportado.
- Sanitizar HTML/SVG server-side y nuevamente antes del render. Eliminar scripts importados, event handlers, `foreignObject`, URLs externas, `javascript:`, `data:` no allow-listed, CSS `url()`, `@import`, position/size abusivos y animaciones/relojes no deterministas.
- Límite inicial: HTML 250 KiB, CSS 250 KiB, 1,500 nodos, profundidad 40, 200 editables, 50 overrides por command, chart 2,000 celdas. Rechazar por complejidad antes de abrir/renderizar.
- SSRF: render solo resuelve IDs internos ya materializados; nunca URL del manifest. DNS/redirects privados bloqueados en cualquier importador autorizado.
- Mensajes: máximo 64 KiB; rate limit 60/s; ACK por secuencia; rechazar replay, salto de versión, documento obsoleto y payload fuera de orden.

Matriz explícita del sandbox propuesto:

| Token                                                      | Política                                               | Motivo                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `allow-scripts`                                            | Permitido solo para runtime empaquetado y determinista | Selección, seek y render de templates instrumentados.             |
| `allow-same-origin`                                        | Prohibido                                              | Mantiene origen opaco y evita acceso a cookies/storage/DOM padre. |
| `allow-forms`                                              | Prohibido                                              | Un asset audiovisual no debe enviar formularios.                  |
| `allow-popups`, `allow-popups-to-escape-sandbox`           | Prohibidos                                             | Evita ventanas y escape de sandbox.                               |
| `allow-top-navigation*`                                    | Prohibido                                              | El contenido nunca navega la app.                                 |
| `allow-downloads`                                          | Prohibido                                              | Descargas pasan por operaciones autorizadas del host.             |
| `allow-modals`, `allow-pointer-lock`, `allow-presentation` | Prohibidos                                             | No son necesarios para edición y amplían superficie.              |
| `allow-storage-access-by-user-activation`                  | Prohibido                                              | No existe estado persistente dentro del asset.                    |

### Migración

1. Inventariar decks HTML y congelar hash/sanitizer version.
2. Instrumentar nodos elegibles con IDs estables derivados de template + path semántico, no `nth-child` solo.
3. Generar manifest en modo read-only y validar comparación visual.
4. Habilitar texto e imagen en plantillas piloto.
5. Convertir a componentes declarativos cuando una plantilla tenga uso repetido.
6. Mantener el source original como rollback; nunca sobrescribirlo.

## 5. Seguridad y multi-tenancy

| RISK-ID  | Riesgo                                             | Severidad                             | Control requerido                                                                                                                               |
| -------- | -------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-001 | Pérdida de cambios sin undo/autosave               | Alta                                  | Command journal, checkpoints, OCC/rebase, recovery UI.                                                                                          |
| RISK-002 | Preview distinto al render                         | Crítica                               | Contrato de conformidad y release gate.                                                                                                         |
| RISK-003 | HTML/SVG activo ejecuta XSS                        | Crítica                               | Sandbox sin same-origin, CSP, sanitizer, schema/manifest y no JS arbitrario.                                                                    |
| RISK-004 | Renderer descarga URL interna/privada              | Crítica                               | IDs internos, materialización, outbound HTTP policy y bloqueo SSRF/redirect.                                                                    |
| RISK-005 | Service-role cruza tenants                         | Crítica                               | Auth antes de service role, filtros `organization_id`, FK compuestas, RLS y tests negativos.                                                    |
| RISK-006 | Asset sustituido rompe reproducibilidad            | Alta                                  | Binario READY inmutable, checksum y snapshot materializado.                                                                                     |
| RISK-007 | Mensajes de iframe falsificados/replay             | Alta                                  | source/port/nonce/version/sequence/hash/size.                                                                                                   |
| RISK-008 | Agente oculta/elimina/publica                      | Alta                                  | Policy por operación, simulación, diff, risk y confirmación; prohibir publicación directa.                                                      |
| RISK-009 | Job externo duplicado/cobro doble                  | Alta                                  | Idempotency key, outbox, lease, cancelación y reconciliación.                                                                                   |
| RISK-010 | Archivo malicioso o zip bomb                       | Alta                                  | MIME mágico, tamaños, ratio/entries, path traversal, cuarentena/probe aislado.                                                                  |
| RISK-011 | Logs filtran PII/URLs/prompts                      | Media/Alta                            | Structured allow-list, IDs/hash, redaction y retención.                                                                                         |
| RISK-012 | DoS por composición compleja                       | Alta                                  | Presupuestos de nodos/clips/decoders, backpressure, abort y cuotas por tenant.                                                                  |
| RISK-013 | CSP actual demasiado amplia para HTML no confiable | Media hoy / crítica si se abre import | Mantener pipeline actual controlado; antes de HTML editable eliminar recursos `https:` genéricos, hashes/nonces y materializar assets internos. |

Toda tabla nueva debe incluir `organization_id`, RLS, índices tenant-first y relaciones compuestas que impidan enlazar IDs de otra organización incluso bajo service role. Signed URLs son transporte temporal, nunca identidad persistida.

## 6. Contrato medible de paridad

Cada ejecución de conformidad fija:

- `documentHash`, revision ID, renderer version, compiler version, asset IDs + SHA-256, font hashes, render profile, browser build y color profile.
- Fixtures: timing/split/trim, crop/fit/rotation/opacity, texto y fuentes, SRT/VTT/karaoke/RTL, gain/fades/ducking/crossfade, cada motion preset, cada transición, color neutro/extremos y deck HTML.
- Checkpoints: inicio, frame anterior y posterior a cada borde/corte/keyframe/cue, midpoint de efectos y último frame.
- Imagen: resolución idéntica; ignorar solo región/tolerancia documentada. Gate recomendado SDR: SSIM ≥ 0.995 y ≤ 0.1% píxeles con delta RGB > 8; texto/captions tienen máscara más estricta, sin desplazamiento > 1 px. Ajustar solo con corpus, no para “hacer pasar”.
- Tiempo: duración y eventos dentro de 1 frame; seek hacia delante y atrás produce el mismo hash perceptual por checkpoint.
- Audio: inicio/fin dentro de 1 frame; sync A/V ≤ 20 ms; true peak ≤ -1 dBTP; loudness educativo objetivo provisional -16 LUFS ±1 LU para voz+programa estéreo, configurable por publicación; diferencia preview/final de envelope RMS ≤ 0.5 dB en ventanas canónicas.
- Fuentes/codecs/color: fuente ausente bloquea; no fallback silencioso. Convertir/etiquetar SDR Rec.709. Fixtures separan diferencias de decoder de diferencias del evaluator.
- Diagnóstico por etapas: document normalize → evaluator → preview adapter → render adapter → asset/font decode → encoder. El reporte conserva hashes, no URLs firmadas.
- Release bloqueada ante mismatch estructural, texto/caption incorrecto, evento >1 frame, audio faltante/clipping, tenant violation o degradación por encima del presupuesto.

Incremento local posterior de CAP-027: el comparador mide la deriva de cada captura respecto del checkpoint esperado además de la diferencia entre preview y render; así dos targets desplazados al mismo frame no pasan por coincidencia. El reporte conserva máximos observados de error de píxeles, deriva temporal y PSNR mínimo, y rechaza muestras inválidas o duplicadas. El gate local en Edge pasó 25/25 checkpoints con 0 diferencias y 0 frames de deriva. Un gate adicional puede decodificar un MP4 local ya exportado, comparar sus checkpoints con el preview y verificar el SHA-256 del archivo contra un recibo local. El smoke sintético cubre éxito, diferencia visual y recibo inválido. El endpoint de evidencia, autorizado por rol y empresa, comprueba la cadena persistida solicitud → job → revisión → asset y solo acepta un checksum marcado como verificado desde Storage. Ninguno de estos gates verifica por sí solo el MP4 remoto real ni el audio.

El importador reanudable valida estrictamente cada `Content-Range` y lee como máximo los bytes esperados por petición. Un verificador Node posterior a la importación ya puede leer el objeto completo de Storage en streaming y registrar su SHA-256 mediante una RPC transaccional e idempotente. Se ejecuta manualmente con `npm run verify:hyperframes-final-video -w apps/api -- <organization-id> <render-request-id>` en un entorno con `SUPABASE_SERVICE_ROLE_KEY`; no se ha probado contra Storage/BD reales ni se ha desplegado como job automático. La marca de integridad no aprueba por sí misma el video y no garantiza que el objeto permanezca inmutable tras la lectura.

Para detectar sobrescrituras posteriores sin mutar el estado, `npm run check:hyperframes-final-video -w apps/api -- <organization-id> <render-request-id>` reabre el mismo objeto de Storage, calcula su SHA-256 en streaming y lo compara con el checksum previamente verificado. Además coteja el hash documental del contrato con la revisión congelada y el input del job. Devuelve error `VIDEO_INTEGRITY_OVERWRITTEN` ante una diferencia aunque el tamaño no cambie. Con `--receipt-output <ruta-nueva.json>` emite, solo después de `MATCH`, el recibo `{documentHash, videoSha256}` que acepta el comparador del MP4; no sobrescribe archivos existentes. El MP4 local debe ser exactamente el objeto cotejado, pues el comparador exige el mismo SHA-256. Debe correrse inmediatamente antes de usar la evidencia para QA; por ahora no se ejecuta automáticamente ni revoca por sí mismo el estado persistido. El archivo de recibo sigue siendo editable y no equivale a una firma criptográfica.

## 7. Rendimiento y escalabilidad

No existen benchmarks actuales del editor; estos son **presupuestos objetivo** para medir:

| Métrica                       | Objetivo inicial                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Operación pura p95            | ≤ 16 ms para 150 clips; ≤ 50 ms hasta el límite soportado                          |
| ACK visual live patch p95     | ≤ 50 ms (alineado con rollout existente)                                           |
| Scrub a primer frame p95      | ≤ 100 ms con proxy/cache caliente; ≤ 300 ms frío                                   |
| Main-thread long tasks        | Ninguna > 50 ms durante drag/scrub sostenido                                       |
| Autosave debounce             | 750–1,500 ms de inactividad; flush en blur/navegación segura                       |
| Save roundtrip p95            | ≤ 800 ms como objetivo existente; no bloquea preview                               |
| Documento JSON                | warning 2 MiB, hard limit 5 MiB; externalizar datos pesados                        |
| Clips/tracks UX certificada   | 150/12 inicialmente; schema 500/32 como hard limit, no promesa UX                  |
| Decoders de video simultáneos | 4 objetivo; pausar/liberar fuera de viewport/playhead                              |
| Waveform                      | chunks/cache content-addressed; LOD por zoom, nunca samples completos al DOM       |
| Thumbnails                    | sprite/LOD; cancelación y prioridad cerca del playhead                             |
| Memoria                       | warning 1 GiB estimado de frames/buffers; liberar `VideoFrame` explícitamente      |
| Render                        | cola por organización, backpressure, dedupe por snapshot+profile, cancel/reconcile |

Proxies se generan solo si probe supera umbrales medidos (resolución/bitrate/codec/latencia); no duplicar todos los assets por defecto. Preview reducido puede bajar resolución, thumbnails y efectos costosos, pero nunca cambiar timing o semántica.

## 8. Roadmap incremental

### Fase 0 — Correctitud del núcleo (`L`)

- Objetivo: poder editar sin pérdida ni divergencia silenciosa.
- Capacidades: corregir suite global/Chrome smoke; command gateway; undo/redo general; autosave journal; parity harness; cerrar color flag; métricas/SLO.
- Datos: tabla/evento idempotente de commands o journal cliente + checkpoints; no reescribir historial.
- Módulos: patch service/types, session store, save queue, preview protocol, snapshot/render diagnostics, pruebas.
- Riesgos: migración de inversas, tamaño de logs, falsos positivos visuales.
- Tests/aceptación: toda op reversible reproduce hash base; crash recovery; conflictos OCC; fixtures preview/render; suite completa verde; cross-tenant fail-closed.
- Métricas: lost edits = 0; conflict recovery success; parity pass rate; p95 ACK/save.
- Rollout: flag por organización → interna → 5% → 25% → 100%; rollback oculta command journal pero conserva lectura.

#### Implementación inicial — 26 de septiembre de 2026

- `undo/redo`: command stack de sesión con checkpoints documentales, límite de 50 comandos/20 MiB y commit del cursor únicamente después de confirmar el append OCC. Cubre patches del editor, restore de historial/snapshot, presets, propuestas del agente, preensamble, branding y sincronización histórica que alteren el documento.
- Recuperación automática: journal local versionado con TTL de 24 horas, schema estricto, máximo 2 MiB y hashes `base`/`target`. Reejecuta solo cuando el servidor conserva exactamente el hash base; reconoce un cambio ya confirmado y presenta conflicto sin sobrescribir cuando hay divergencia.
- Conformidad: cada snapshot nuevo incorpora `conformance-contract.json` y el mismo contrato en su manifest persistido: documento, assets+SHA-256, canvas/FPS/perfil, hasta 48 checkpoints deterministas y umbrales visuales/temporales.
- Gate reproducible: `npm run qa:composition-conformance --workspace=apps/web -- --contract <json> --preview-dir <dir> --render-dir <dir> --preview-metadata <json> --render-metadata <json> --output <json>` compara resolución, MAE, PSNR, porcentaje de píxeles fuera de tolerancia, identidad documental y deriva temporal; devuelve código distinto de cero para `FAIL` o `INCOMPLETE`.
- MP4 ya exportado: `npm run qa:composition-exported-video --workspace=apps/web -- --contract <json> --preview-dir <dir> --preview-metadata <json> --render-receipt <json> --video <mp4> --output <json>`. Para un video importado se puede generar ese recibo primero con `npm run check:hyperframes-final-video -w apps/api -- <organization-id> <render-request-id> --receipt-output <ruta-nueva.json>`. La herramienta verifica hash del archivo, hash documental, duración/resolución/FPS, número de frames, timestamps crecientes y deriva temporal; después compara checkpoints visuales. Si el contrato v2 requiere audio, falta de pista o pico de muestras ≤ −60 dBFS hacen fallar el reporte. El contrato v1 conserva `EXPECTATION_UNKNOWN`.
- Los snapshots siguen emitiendo v1 por defecto. Tras desplegar lectores compatibles, `COMPOSITION_CONFORMANCE_AUDIO_V2=true` habilita v2 tanto en la búsqueda de revisión reutilizable como en el manifest. Para rollback, quitar la flag detiene nuevos v2; los ya persistidos siguen necesitando lectores compatibles.
- El **reporte** del comparador ahora es versión 2 (`EXPORTED_VIDEO_VISUAL_AND_AUDIO_MEASUREMENTS`), independiente de la versión del contrato congelado. Si el MP4 contiene audio, mide la primera pista `0:a:0` con FFmpeg `loudnorm` y lee exclusivamente `input_*`: LUFS integrados, LRA, threshold y true peak del archivo final. La salida procesada va al muxer `null`; no reescribe el MP4. Esta pasada se suma a las lecturas de señal y video existentes, con límite de diez minutos y salida de 512 KiB.
- Sin política devuelve `MEASURED_POLICY_NOT_SET`; añadir `--audio-policy course-v1` aplica explícitamente el baseline provisional −16 LUFS ±1 LU y true peak máximo −1 dBTP. El reporte conserva ID y límites de la política. Silencio/medición incompleta, incumplimiento de política o fallo del analizador invalidan el resultado aunque la comparación visual pase; ausencia de pista sigue evaluándose con el contrato. Argumentos desconocidos/duplicados y políticas inválidas se rechazan.
- Un `PASS` se limita al alcance declarado y a la política elegida: no comprueba contenido ni sincronía de audio ni autentica el recibo local. Falta ejecutar FFmpeg con MP4 reales y automatizar el control en producción. La lectura de mediciones, políticas y resultado combinado se prueba con `npm run test:composition-exported-audio -w apps/web`; no habilita por sí misma CAP-017/027 ni su rollout.
- Captura automática: `npm run qa:composition-conformance:ci` compila una fixture congelada, captura 21 checkpoints de preview y del `renderSeek` real de HyperFrames en Chromium a resolución nativa, verifica identidad documental/temporal/pixel y publica reporte más frames como evidencia de CI.
- Límite deliberado: uploads, procesamiento, render y publicación no entran al undo documental porque son efectos externos; conservan sus mecanismos de cancelación/compensación. El gate usa una fixture canónica local; ampliar el corpus y la matriz de navegadores queda como endurecimiento previo a GA.

### Fase 1 — Fundamentos de edición (`L`)

- Capacidades: duplicate, copy/paste interno seguro, ripple delete, insert, align/distribute, guías/safe areas, shortcuts/command palette, selección canvas múltiple.
- Dependencias: Fase 0 e inversas completas.
- Datos: comandos aditivos; preferencias de UI separadas del documento salvo resultado editorial.
- Riesgos: ripple rompe links/captions/transiciones.
- Aceptación: batches atómicos, locks, groups, linked audio, captions y transiciones cubiertos; teclado completo y foco visible.
- Métricas: acciones por tarea, undo rate, tiempo de ensamblaje.
- Rollout/rollback: operación por operación con flag; lector permanece compatible.

#### Implementación incremental — 26 de septiembre de 2026

- Duplicación/inserción: `clip.duplicate` clona de forma no destructiva el clip y sus animaciones, crea identidades nuevas para clip, nodo visual, animaciones y escenas, conserva grupos completos y abre espacio desplazando clips posteriores sin solapamientos silenciosos.
- Acciones masivas: la selección permite duplicar, eliminar o eliminar con ripple. Los planes se ejecutan como batches atómicos de máximo 100 operaciones y fallan cerrados ante pistas bloqueadas, grupos parciales, vínculos avatar-voz incompletos, escenas ambiguas o clips supervivientes que atraviesen el intervalo retirado.
- UI/teclado: inspector de selección con acciones explícitas; `Ctrl/Cmd+D` duplica, `Delete/Backspace` elimina y `Shift+Delete/Backspace` elimina cerrando huecos. `Alt+←/→` ejecuta slide, roll de entrada o roll de salida según el modo seleccionado y respeta el paso de 1–300 frames. Todas las acciones reutilizan OCC, journal de recuperación y undo/redo general.
- Paleta de comandos: `Ctrl/Cmd+K` y el botón de toolbar abren un diálogo accesible y buscable por etiqueta, descripción, categoría, palabras clave o atajo. Las acciones muestran disponibilidad y estado activo según el contexto, y despachan los mismos handlers de historial, selección, vista y paneles; no contienen una segunda ruta de mutación. El catálogo también cubre alineación al canvas, distribución y las seis variantes de roll/slide usando el paso de frames configurado; los servicios de dominio conservan la validación definitiva de grupos, locks, handles, vecinos y transiciones.
- Adaptador de comandos: un builder puro separado del controlador traduce documento, selección, locks, guardado e historial a ítems declarativos; un dispatcher exhaustivo resuelve el ID únicamente después de la acción del usuario. El contrato exige paridad uno-a-uno con el registro y permite probar disponibilidad, razones de bloqueo y argumentos de despacho sin montar React, leer refs durante render ni duplicar lógica editorial.
- Gate UI de la paleta: `npm run qa:composition-command-palette` empaqueta un harness aislado con el componente React real y lo opera mediante CDP en Edge/Chromium. Valida `Ctrl/Cmd+K`, Escape, búsqueda, bloqueo contextual, focus trap, restauración de foco y despacho; reutiliza el launcher QA existente, no agrega dependencias y se ejecuta en CI con Chrome.
- Copiar/pegar interno: `Ctrl/Cmd+C` conserva únicamente hasta 100 IDs de clip en memoria de sesión, aislados por composición y con TTL de 30 minutos; no toca el portapapeles del sistema, storage ni contenido multimedia. `Ctrl/Cmd+V` pega el bloque en el playhead, recrea identidades, animaciones y grupos completos, abre un hueco frame-aligned en las pistas afectadas y falla cerrado ante clips/transiciones atravesados, locks, vínculos incompletos o fuentes obsoletas.
- Preferencias locales: modo de inserción, paso de frames y operación de `Alt+←/→` se conservan en un contrato versionado de máximo 2 KiB separado del documento. Payloads corruptos, sobredimensionados o de versiones futuras vuelven a defaults; fallos de storage no bloquean la edición. No se guardan IDs, contenido, PII ni estado renderizable.
- Layout multipieza: el inspector alinea por izquierda, centro, derecha, arriba, medio o abajo contra el canvas o los límites de la selección. La distribución horizontal/vertical conserva los dos extremos y calcula espacios iguales entre cajas. Los planes son puros, atómicos y limitados a 100 operaciones; ignoran audio y rechazan locks, selecciones obsoletas y grupos visuales parciales.
- Guías seguras: el monitor puede superponer safe areas de acción (90%), título (80%) y centro. Viven fuera del iframe y del documento, con `pointer-events: none`, por lo que no modifican hashes, undo/redo, preview compilado ni render final.
- Selección desde canvas: el protocolo preview soporta hasta 100 `hfIds` validados y conserva un único elemento primario para controles directos. Ctrl/Cmd/Shift + clic agrega o retira elementos; arrastrar sobre espacio vacío crea un marquee por intersección y puede extender la selección con modificadores. Timeline, outlines e inspector se sincronizan sin persistir selección en el documento ni inferir movimientos multipieza.
- Guías magnéticas: mover y redimensionar prioriza bordes y centros del canvas y de elementos visibles con un umbral constante de 7 px de pantalla; si no encuentra candidato, usa la rejilla de 16 px como fallback. Resize proporcional elige un solo eje dominante para evitar deformación. Las líneas de snap son efímeras, no interceptan eventos y se retiran antes de confirmar el `clip.layout`.
- Inserción general: la biblioteca ofrece `APPEND`, `INSERT` y `OVERWRITE`. Insert abre un hueco frame-aligned y desplaza el contenido posterior; Overwrite conserva los handles no cubiertos, divide medios cuando el reemplazo cae en el centro y mantiene intacto el archivo fuente.
- Transiciones durante overwrite: el plan conserva transiciones externas cuando el borde original sobrevive —incluido el traspaso al fragmento derecho de una división— y elimina de forma explícita solo las conectadas a un corte que cambia o a un clip retirado.
- Edición precisa: roll ajusta el corte izquierdo o derecho y slide desplaza la selección conservando los límites exteriores. El paso es configurable entre 1 y 300 frames y también se activa con `Alt+arrastrar` sobre el bloque o sus tiradores. Durante el gesto, el timeline proyecta en todas las pistas el mismo plan de dominio que se persistirá, con outline fantasma y rechazo visual si el batch completo no es válido. Ambos verifican handles de fuente, duración mínima, adyacencia, locks y validez final de transiciones.
- Coordinación multipista: una selección se expande transitivamente a su grupo lógico y a pares avatar-voz. Si todos los miembros comparten inicio/duración y tienen vecinos compatibles, roll/slide generan un solo batch atómico; cualquier carril inválido cancela la edición completa. Los movimientos coordinados usan trims explícitos para evitar que el autosincronizado de `clip.move` aplique dos veces el delta.
- Overwrite coordinado: si el intervalo cubre completamente un grupo o una escena avatar-voz, el plan expande la eliminación a todas sus pistas y la confirmación informa los clips adicionales. Un overwrite parcial sigue rechazado para no romper vínculos o membresías; el archivo fuente permanece intacto.
- Límite deliberado: el sistema rechaza —en lugar de adivinar— overwrite parcial sobre grupos, pares avatar-voz o animaciones; Insert que atraviese un clip/transición; roll/slide sobre grupos desalineados, vínculos ambiguos o vecinos que no preserven completa su topología. Estos casos requieren realinear, ampliar el intervalo o separar primero los elementos afectados.

### Fase 2 — Producción eficiente (`L`)

- Capacidades: waveform LOD, metros, clipping/loudness, normalización backend, media bin/search, replace/relink, thumbnails y proxies condicionados, brand presets/caption workflows.
- Dependencias: asset metadata/checksum y worker queues.
- Datos: derivados content-addressed y job states; nunca blobs en documento.
- Riesgos: costo de storage/CPU, derivados obsoletos, audio degradado.
- Aceptación: loudness/peak medidos; waveform estable por zoom; replace conserva timing/layout; jobs idempotentes/cancelables.
- Métricas: cache hit, tiempo de waveform/proxy, LUFS failures, replace success.

#### Incremento 2.1 — Evidencia de audio y waveform derivada

- La normalización de voz se verifica sobre el archivo AAC final con una segunda pasada `loudnorm`; el resultado versionado conserva LUFS integrados, LRA, true peak, objetivo y tolerancia. Silencio digital se representa con mediciones `null` y QA fallida, nunca como `Infinity` serializado ni como éxito ambiguo.
- El baseline provisional de DEC-103 queda automatizado en `-16 LUFS ±1 LU` y true peak máximo `-1 dBTP`. El perfil sigue solicitando `-1.5 dBTP` a FFmpeg para dejar margen antes del umbral de aceptación.
- El worker extrae PCM mono acotado a 400 Hz y construye una pirámide min/max determinista. Cada nivel agrega el anterior, preservando extremos al cambiar de zoom; el consumidor limita el dibujo a dos buckets por píxel.
- El JSON waveform se guarda como derivado content-addressed bajo `audio-analysis/{sha256}/waveform-v1.json`. El asset y el job conservan solo un manifiesto con checksum, versión, duración, niveles y ruta; el documento de composición no recibe blobs.
- Límites operativos: PCM temporal de hasta 64 MiB, derivado JSON de hasta 8 MiB, 65 536 buckets en el nivel base y 32 niveles aceptados por el lector. Rutas y mediciones no confiables se validan antes de llegar a UI.
- QA automatizada: contratos worker/web, parser de salida FFmpeg, política LUFS/peak, silencio, preservación de picos, secuencia LOD y selección por viewport. El smoke contra un binario FFmpeg real queda pendiente en este entorno local porque el ejecutable no está disponible; debe correr en la imagen del worker antes del rollout.

#### Incremento 2.2 — Consumo en el editor

- Los `PROCESSED_AUDIO` aparecen en la biblioteca con LUFS, true peak y estado de conformidad; quedan disponibles para inserción explícita y no se colocan como una segunda voz al reconciliar automáticamente el borrador.
- Un endpoint autorizado por usuario, tenant, componente y tipo de asset descarga el derivado, verifica SHA-256 y manifiesto, y entrega solo un nivel de detalle acotado. La UI consulta únicamente los audios usados en la composición, con tres lecturas simultáneas como máximo.
- El timeline dibuja el intervalo real del archivo según `sourceOffsetSeconds` y duración del clip. Al reducir zoom agrega extremos en vez de muestrear un solo punto; la cola que exceda la duración medida permanece vacía. Una lectura fallida muestra aviso y mantiene las operaciones de edición disponibles.
- La cola de audio solicita el lease máximo de 3600 s permitido por la RPC actual y acota cada proceso de FFmpeg a siete minutos. Este margen cubre las pasadas adicionales de análisis; el mecanismo de renovación de lease sigue siendo una mejora operativa para clips excepcionalmente largos.
- El gate de CI ejecuta un smoke en Chromium sobre el componente React real: comprueba render inicial, pico preservado tras trim y cambio de resolución al variar el ancho. El flujo completo de procesamiento con FFmpeg y la escucha humana continúan pendientes para la imagen del worker y QA de producto.

Diagnóstico editorial de CAP-017: el inspector de clips audibles muestra LUFS y true peak del archivo fuente, objetivos del análisis, volumen efectivo guardado de clip/pista y pico estimado mediante ganancia logarítmica. Distingue silencio, fuente sin análisis, mute y exceso del objetivo de pico. Atenuar una fuente que falló su análisis no la declara conforme. El panel consume los metadatos existentes del asset sin nuevas descargas ni mutaciones; no es un metro en vivo ni mide la mezcla o el intervalo recortado. Esas mediciones continúan pendientes.

#### Incremento 2.2b — Metros de mezcla durante reproducción (experimental)

- `NEXT_PUBLIC_COMPOSITION_AUDIO_METERS=true` habilita compilación y UI de metros; permanece apagada por defecto y requiere reconstruir el frontend. Solo el preview interactivo añade `crossorigin="anonymous"` a sus audios. Antes de habilitarlo, los buckets y URLs de medios deben permitir CORS desde el iframe de origen opaco; cambiar este atributo puede hacer fallar fuentes que antes solo permitían reproducción.
- Un AudioContext conecta hasta 32 fuentes del preview a una mezcla estéreo. Dos analizadores independientes leen L/R después del volumen efectivo y las automatizaciones de los elementos multimedia; no se estima la señal desde el waveform de 400 Hz ni se promedian canales opuestos.
- Muestra pico de muestras y RMS en dBFS, con ventanas de 2048 muestras cada 100 ms y clipping a amplitud absoluta ≥1 retenido por dos segundos. El botón «Limpiar clipping» reinicia la retención. Hay intervalos no observados entre ventanas; no es un gate exhaustivo de clipping ni una medición de LUFS o true peak.
- La conexión se establece después de que el AudioContext esté ejecutándose. Si el navegador exige un gesto, se reutiliza el botón de activación dentro del iframe. CORS incompatible, exceso de fuentes, navegador sin soporte y fallos del analizador muestran indisponibilidad, no silencio medido. Una inicialización parcial nunca publica una mezcla completa.
- Pausa y buffering cancelan la lectura periódica; un contador invalida una activación pendiente al pausar. Cada medio se conecta una sola vez por navegación. `pagehide` desconecta nodos, cancela el temporizador y cierra el contexto. No modifica el documento, undo/redo ni el HTML de exportación.
- Validación disponible con `npm run test:composition-audio-meters -w apps/web`: cálculo, runtime emitido con APIs controladas, estados, cancelación, cleanup y compilación preview/render. CAP-017 tiene la implementación completada dentro del alcance acordado, incluida la medición de loudness de la mezcla exportada; queda pendiente QA en navegador y worker reales, CORS, autoplay, calibración y escucha. La integración automática de la verificación del video final y la comparación temporal de audio siguen como implementación pendiente de CAP-027. Este cierre de implementación no habilita el rollout.

#### Incremento 2.3 — Media bin y reemplazo conservador

- La biblioteca de medios permite búsqueda local por nombre/origen/tamaño y filtro por video, imagen o audio. Es una vista sobre los assets ya vinculados al borrador; si la biblioteca crece mucho, la siguiente evolución será paginación/búsqueda de servidor.
- `clip.replace-source` cambia únicamente la referencia de un clip multimedia: conserva id, track, posición, duración, trim, layout, crop, animaciones y transiciones, y genera una versión normal para undo/redo. Preview requiere recarga completa para evitar mostrar el medio previo.
- Se rechazan tipos distintos, fuente idéntica, pista bloqueada, intro y vínculos avatar-voz que exigirían sincronización coordinada. Video/audio nuevos deben cubrir el intervalo `sourceOffset + duration`; controles de audio existentes requieren audio confirmado. El asset fuente antiguo no se elimina.
- El servidor comprueba el vínculo `draft + organization` y obtiene MIME, duración y dimensiones del registro de Producción scoped al tenant; no confía en los metadatos enviados por el navegador. El reemplazo de fuentes externas no registradas y la re-vinculación de archivos perdidos quedan fuera de este incremento.
- QA: pruebas del dominio y de persistencia para preservación, incompatibilidad, handles, locks, autorización por vínculo y normalización de metadatos; falta smoke visual manual de preview/render con assets reales.
- El gate de CI ahora ejecuta un smoke de navegador sobre la biblioteca React real: búsqueda, filtro, disponibilidad de reemplazo, conservación de timing/layout, estrategia de recarga, selección del clip tras cambiar su asset y undo/redo. La fixture aplica el patch en memoria; no sustituye una prueba E2E autenticada de API + render final con medios reales.
- El corpus de conformidad preview/render ahora incluye una imagen SVG determinista agregada a un clip, reemplazada por otro asset y recortada a cuatro segundos. Compara 25 checkpoints, incluidos inicio y final exacto del clip, y exige que la imagen reemplazada sea visiblemente distinta del estado previo tanto en preview como en render. Este caso detectó que el preview ocultaba el clip 0.0001 s después de su fin mientras `renderSeek` usaba intervalo semiabierto; se corrigió el cierre en el frame exacto. La captura local en Edge quedó `PASS` (25/25, cero diferencias fuera del contrato, visibilidad confirmada).
- No se ejecutó una mutación autenticada contra Supabase: el entorno contiene credenciales generales pero no un tenant/usuario de QA aislado. Esa validación requiere datos de prueba explícitos y no debe improvisarse sobre borradores potencialmente productivos.

Endurecimiento posterior de CAP-023: el guardado de `clip.replace-source` vuelve a validar del registro scoped al tenant el checksum, tamaño, MIME/extensión, bucket, ruta, dimensiones y estado del reemplazo con los límites de entrega HyperFrames; la ausencia o incompatibilidad rechaza el append versionado. Pasan la prueba de persistencia y el smoke local de biblioteca en Edge. Esta validación de metadatos no prueba que el objeto físico aún exista en Storage; relink y E2E autenticado siguen pendientes.

Relink local posterior: se usa el mismo comando `clip.replace-source` para conservar las ediciones del clip aun cuando su fuente anterior no esté disponible. El servidor consulta `Storage.info` del candidato, confirma existencia y tamaño antes de guardar; un 404 se rechaza como medio ausente y un fallo transitorio como 503 reintentable. La biblioteca muestra «Revincular» si la fuente seleccionada falta en el catálogo o falla en el preview. Siguen pendientes el E2E autenticado con pérdida real de fuente y la comprobación de render remoto; la consulta previa no elimina una posible eliminación posterior del objeto.

### Fase 3 — Edición avanzada justificada (`M/L` por bloque)

- Capacidades: curvas/easing acotado, paths simples, freeze y rate limitado, masks básicas, chroma/background si producto valida demanda, subcomposiciones declarativas.
- Fuera: tracker general, estabilización avanzada, compositor nodal, 3D y plugins arbitrarios.
- Dependencias: evaluator/parity y presupuestos GPU.
- Aceptación: seek-safe, determinismo, fallback y métricas GPU/memoria.
- Rollout: experimental por capability; rollback conserva datos pero compila lectura segura.

Primer incremento experimental: paths simples de posición (X/Y) mediante hasta ocho poses explícitas en animaciones no repetibles. `NEXT_PUBLIC_COMPOSITION_SIMPLE_PATHS=true` habilita la inserción y eliminación de puntos interiores en UI y API; el valor por defecto es desactivado. Al apagarlo se impiden nuevas ediciones de estructura del path, pero los puntos ya guardados siguen siendo válidos y se compilan en preview/render. La comprobación estructural de paridad no sustituye la captura visual ni el MP4 real pendientes antes de producción.

Segundo incremento experimental: cada punto interior admite un tiempo de paso ajustable, separado al menos un 2 % de las poses vecinas. Se combina con el catálogo cerrado de easing por tramo ya existente; no permite curvas Bézier arbitrarias ni cambia las poses extremas. La misma flag controla esta edición temporal, y el rollback conserva lectura y render de los valores persistidos.

Tercer incremento experimental: `NEXT_PUBLIC_COMPOSITION_VIDEO_RATES=true` habilita 0.5×, 1.5× y 2× para B-roll independiente sin audio, duración de fuente conocida y sin transiciones. La duración del clip no cambia; el validador exige que la ventana consumida por la velocidad permanezca dentro del asset. Preview usa el mismo mapeo de tiempo de fuente y HyperFrames recibe `data-playback-rate`; al apagar la flag, los documentos persistidos siguen siendo legibles/renderizables y puede restablecerse 1×. Split, trim y remove-range requieren restablecer 1× para evitar offsets de fuente incorrectos.

Cuarto incremento experimental: `NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE=true` permite conservar **solo el último frame** de un B-roll silencioso durante una cola de hasta 3 segundos cuando el clip ya excede la ventana restante de la fuente. El documento registra la duración de esa cola y valida que coincida con la fuente y el offset; preview pausa en la cola y render recibe un video no-loop con duración explícita, comportamiento de tail-hold soportado por el runtime instalado. No hay freeze en un frame arbitrario, ni combinación con velocidad, escenas o transiciones. La flag desactivada impide nuevas congelaciones pero permite leer/renderizar el documento y volver al loop. Para cambiar duración, fuente, split, trim o remove-range primero se desactiva freeze.

Gate automatizado de freeze: `npm run qa:composition-video-freeze` genera un MP4 sintético local (rojo → verde), captura tres tiempos en preview y render y mide todos los píxeles de cada par; además compara el último frame de la fuente con la cola congelada. Captura los 75 frames del target render, los codifica en otro MP4 local y verifica mediante decodificación la duración de 3 segundos y los colores antes y durante la cola. El contrato general de conformidad añade checkpoints justo antes del fin de la fuente, en la frontera, en la mitad de la cola y en el último frame de esta, preservándolos al acotar el total de muestras. La ejecución local pasó con error absoluto medio 0 y proporción de píxeles distintos 0 en los tres tiempos; el MP4 local decodificado mantuvo rojo → verde → verde. **Esta codificación de capturas es QA local, no el job de exportación remota del editor.** Siguen pendientes ese job con assets reales y el QA autenticado para producción.

Contrato de entrega remota del freeze: una prueba de integración compila el clip congelado con `data-var-src`, prepara el ZIP de subida con una URL HTTPS temporal y comprueba que el video mantiene `data-duration`, `data-source-offset`, `data-media-start` y la ausencia de `loop` y audio separado. También verifica que el documento y el snapshot originales no guardan la URL firmada y que, con la flag apagada, el documento persistido sigue pudiendo prepararse para render. Esto cubre la frontera previa a la subida, sin contactar HeyGen ni sustituir la validación del job remoto.

### Fase 4 — HTML editable (`XL`)

- Capacidades: asset V1, instrumentador legado, manifest/overrides/tokens, sandbox protocol, inspector visual, operaciones OP-021..028 y migración piloto.
- Dependencias: Fase 0, security review, sanitizer/render isolation.
- Datos: tablas/assets de template+version+hash; overrides en documento o subdocumento versionado según tamaño.
- Riesgos: XSS/SSRF, CSS escape, selector drift, diferencias de fuentes/layout.
- Aceptación: corpus malicioso bloqueado; source inmutable; undo exacto; misma salida preview/render; CSP/sandbox testados.
- Métricas: import success, rejected unsafe assets, override latency, parity pass.
- Rollout: templates propios → decks instrumentados seleccionados → organizaciones piloto. Kill switch de edición; render de datos existentes sigue funcionando.

### Fase 5 — AI-ready (`M` después del núcleo)

- Capacidades: catálogo completo, read tools con presupuestos, planning multi-step, simulación, semantic diff, evaluaciones, permisos y confirmaciones.
- Dependencias: operaciones humanas maduras y telemetría.
- Datos: propuesta TTL, hash base, policy/version/model, no prompts sensibles completos.
- Aceptación: agente no puede saltar gateway; 100% propuestas reproducibles; fallos seguros; evals de no-op, overlap, lock y tenant.
- Métricas: proposal acceptance, undo after apply, policy rejections, task success.

## 9. Registro de decisiones pendientes

| DEC-ID  | Pregunta                    | Opciones                                | Evidencia                     | Falta                            | Responsable        | Revisión                   | Impacto de postergar                      |
| ------- | --------------------------- | --------------------------------------- | ----------------------------- | -------------------------------- | ------------------ | -------------------------- | ----------------------------------------- |
| DEC-101 | Store/journal de sesión     | Zustand extendido / store nuevo         | Zustand y save queue actuales | Spike de recovery/undo           | Frontend Principal | Antes de Fase 0            | Bloquea undo/autosave                     |
| DEC-102 | Umbral de proxies           | Nunca / heurístico / siempre            | Preflight y WebCodecs         | Telemetría de assets/scrub       | Media Platform     | Tras benchmark             | Puede desperdiciar storage o mantener lag |
| DEC-103 | Loudness target             | -16 LUFS / perfil por canal             | Flujo educativo de voz        | Requisitos SofLIA/distribución   | Audio + Product    | Fase 2                     | Mezcla inconsistente                      |
| DEC-104 | Persistencia HTML overrides | Documento / subdocumento                | JSONB versionado actual       | Tamaño real de templates         | Architecture       | Prototipo Fase 4           | Migración posterior costosa               |
| DEC-105 | Compatibilidad browser      | Chromium-only / matriz amplia           | Chrome/Edge local             | Safari/Firefox codec/runtime lab | QA + Product       | Antes de GA                | Expectativas incorrectas                  |
| DEC-106 | Colaboración simultánea     | OCC / soft locks / CRDT                 | OCC actual                    | Frecuencia real de conflictos    | Product            | Cuando conflictos > umbral | No bloquea roadmap actual                 |
| DEC-107 | Runtime color upstream      | esperar publicación / vendor controlado | 0.7.106 insuficiente          | Release upstream y compliance    | Platform           | Antes de quitar flag       | Bloquea color GA                          |
| DEC-108 | WebGPU                      | no usar / prototipo aislado             | WebGL cubre MVP               | Perfilado de efecto concreto     | Graphics           | Solo ante cuello medido    | Ninguno ahora                             |

## 10. Construir, investigar, no construir

### Construir ahora

- Corregir gates de pruebas y certificar preview incremental.
- Undo/redo general, autosave recuperable y rebase OCC.
- Contrato automatizado de paridad preview/render.
- Ripple/insert, duplicate y acciones masivas seguras.
- Waveform, metros/loudness y media replacement no destructivo.

### Investigar o prototipar

- HTML instrumentado + componentes declarativos y sandbox.
- Proxies/thumbnails con WebCodecs/Mediabunny y fallback backend.
- Curvas de keyframes acotadas, freeze/rate y subcomposiciones.
- Chroma/background removal solo con casos educativos medidos.
- Safari/Firefox y límites reales de memoria/decoders.

### No construir por ahora

- Colaboración CRDT/OT en tiempo real.
- Tracking, estabilización avanzada, compositor nodal, multicam y 3D.
- WebGPU como requisito base.
- Reverse avanzado, plugins arbitrarios y edición libre de JS/CSS/`innerHTML`.
- Sustituir el documento Courseforge por filesystem/estado interno de HyperFrames Studio.
