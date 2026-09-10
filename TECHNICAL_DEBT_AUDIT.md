# Auditoría integral de deuda técnica y mantenibilidad

**Sistema:** Courseforge / SofLIA Engine  
**Fecha de corte:** 2026-09-09
**Alcance:** `apps/web`, `apps/api`, `apps/web/netlify/functions`, `supabase`, configuración raíz, pruebas y documentación.  
**Naturaleza:** diagnóstico estático inicial, seguido por olas de remediación autorizadas. Las evidencias de los hallazgos describen el estado observado antes de esa remediación; la tabla de estado vigente indica qué cambió.
**Marco de evaluación:** `docs/prompt_maestro.md`, adaptado a una auditoría diagnóstica sin implementación.

## Cómo interpretar este informe

- **Hecho comprobado:** observado directamente en código, configuración o salida reproducible de una herramienta.
- **Indicio:** patrón verificable cuyo efecto final depende del despliegue o de datos no disponibles.
- **Hipótesis:** riesgo razonable que requiere una prueba de runtime, configuración remota o inspección del esquema aplicado.
- **Probabilidad:** probabilidad de que el hallazgo cause un fallo o incidente en condiciones normales de uso, no probabilidad de que el código exista.
- **Esfuerzo:** **S** (hasta 2 días), **M** (3-10 días), **L** (2-6 semanas), **XL** (más de 6 semanas).

### Método y verificaciones ejecutadas

- Inventario de 1.288 archivos excluyendo `node_modules`, `.next` y `dist`; 859 archivos TypeScript/TSX y 155 SQL.
- Type-check estricto: `npx tsc -p apps/web/tsconfig.json --noEmit` — **aprobado**.
- Build: `npm run build` — **aprobado con acceso a red**; sin red falla al descargar tres familias de Google Fonts.
- Lint: `npm run lint` — **falló** porque ejecuta `next lint`, no soportado por Next.js 16.
- Se ejecutaron los 16 scripts `test:*` declarados en `apps/web/package.json` — **todos aprobaron**.
- Auditoría de dependencias: `npm audit --json` — **0 vulnerabilidades conocidas** en el lockfile actual.
- Detección de ciclos con Madge sobre 808 archivos — **3 ciclos**.
- Detección de clones con jscpd sobre 678 archivos — **70 clones, 1.536 líneas duplicadas (1,14%)**.
- `npm outdated` confirmó actualizaciones pendientes; se diferencia actualización rutinaria de vulnerabilidad conocida.
- No se encontró configuración de CI bajo `.github/`.

### Aplicación de `prompt_maestro.md`

El segundo pase evaluó explícitamente corrección, seguridad, legibilidad, mantenibilidad, modularidad, escalabilidad, rendimiento, testabilidad, observabilidad y documentación. Además de revisar el comportamiento nominal, se razonó sobre degradación a **10×, 100× y 1.000×** en volumen de cursos, materiales, jobs y archivos. El umbral de 100.000 usuarios concurrentes se usa como prueba de diseño, no como afirmación de capacidad actual: sin telemetría, plan de carga ni configuración remota no es posible certificar ese nivel.

Para evitar falsos positivos, una compatibilidad `legacy`, un fallback o una abstracción solo se marca como deuda cuando existe evidencia adicional de coste, riesgo o contradicción. Las decisiones cuyo contexto no está disponible se mantienen como **indicio** o **hipótesis** y se envían a investigación adicional.

### Limitaciones

No se inspeccionó el estado real de Supabase/Netlify/Cloud Run/SofLIA ni sus variables, secretos, políticas ya aplicadas o logs. No se hicieron ataques activos contra endpoints. No se pudo ejecutar `deno test` porque Deno no está instalado. No existe instrumentación de cobertura para calcular porcentaje de líneas/ramas. Los hallazgos de despliegue se califican como indicio o hipótesis cuando corresponde.

## Estado de remediación (2026-09-08)

Esta sección prevalece sobre la redacción histórica de cada hallazgo. **Implementado** significa que el cambio existe y pasó verificación local; cuando depende de una migración, aún requiere aplicarla y validarla en cada ambiente. **Mitigado** significa que se redujo materialmente el riesgo, pero no se cumplieron todos los criterios de aceptación originales.

| Hallazgo | Estado vigente | Evidencia de remediación / trabajo restante |
|---|---|---|
| TD-01 | **Implementado; despliegue pendiente** | Todos los handlers privilegiados inventariados verifican un envelope HMAC con expiración antes de crear clientes privilegiados; los nonces se consumen una sola vez mediante RPC y los jobs principales validan tenant. Requiere configurar el mismo `BACKGROUND_FUNCTION_SECRET` (mínimo 32 caracteres) en web y Netlify, y aplicar `20260908122000_create_background_request_nonces.sql` antes de desplegar las funciones. |
| TD-02 | **Implementado; despliegue pendiente** | `/api/lia` exige identidad y tenant, valida tamaños/formato y consume un rate limit atómico por usuario+organización. Requiere aplicar `20260908120000_create_api_rate_limits.sql`. |
| TD-03 | **Mitigado** | La importación exige HTTPS, rechaza redes privadas/reservadas y redirects, limita tiempo y streaming a 150 MB, y valida MIME. Persiste el riesgo residual de DNS rebinding entre resolución y conexión; la defensa completa requiere control de egress/resolver. |
| TD-04 | **Mitigado** | Los dos sinks de `body_html` se sanitizan mediante una allowlist DOMPurify. Falta centralizar sanitización server-side al persistir contenido y retirar gradualmente excepciones CSP. |
| TD-05 | **Implementado; despliegue pendiente** | La migración `20260908121000_harden_legacy_storage_policies.sql` revoca las políticas públicas/transversales heredadas. Debe aplicarse y verificarse contra las políticas efectivas del proyecto remoto. |
| TD-06 | **Parcial** | `db:migrations:check`, incluido en `verify`, congela exactamente las cuatro colisiones y tres dumps históricos conocidos y bloquea cualquier duplicado/SQL no versionado nuevo. Resolver el historial aún requiere inventario y reconciliación de `schema_migrations` por ambiente antes de renombrar o crear baseline. |
| TD-07 | **Mitigado** | Ya no existen reemplazos completos de `material_components.assets` en el código de aplicación: rutas, acciones, workers y servicios usan el RPC atómico. Una prueba estática bloquea regresiones. Los append sobre un mismo array todavía requieren un RPC especializado o control optimista para evitar conflictos sobre la misma clave. |
| TD-08 | **Mitigado** | Se retiró `ignoreBuildErrors`, se restauró ESLint 9, se añadieron `typecheck`, `verify` y CI. El baseline conserva advertencias y CI todavía no recrea DB/RLS ni ejecuta toda la matriz funcional histórica. |
| TD-09 | **Mitigado** | El registro valida el contrato y solo crea cuentas cuando Courseforge y la autoridad SofLIA apuntan al mismo proyecto Supabase; si divergen, instruye solicitar invitación en vez de crear una identidad inutilizable. Falta definir/sincronizar un onboarding multi-proyecto si el producto lo necesita. |
| TD-10, TD-14 | **Pendiente** | Son cambios estructurales que requieren fases separadas y, en varios casos, confirmar contexto operativo. |
| TD-12 | **Mitigado** | Se rompieron los tres ciclos comprobados y `madge` no detecta ciclos en 826 archivos. Permanece la inversión de capas en otros flujos y debe resolverse al extraer casos de uso fuera de handlers/rutas. |
| TD-15 | **Parcial** | La sesión vuelve a propagar correctamente el sentinel de render dinámico y el build dejó de producir los falsos errores de autenticación. Siguen pendientes logging estructurado, correlación, métricas y reducción sistemática de PII/ruido. |
| TD-20 | **Parcial** | README ya identifica Express como legado y usa comandos existentes; `docs:audit` sigue disponible como evidencia. Falta reconciliar documentos arquitectónicos históricos y decidir retención/anonimización de los CSV versionados. |
| TD-21 | **Implementado** | La investigación de consumidores confirmó que el buscador de materiales truncado pertenecía a una biblioteca retirada: ningún código productivo lo importaba y la biblioteca vigente está limitada deliberadamente a SFX. Se eliminó el módulo huérfano completo, su catálogo y sus pruebas aisladas en vez de crear nueva infraestructura SQL sin consumidor. |
| TD-11 | **Parcial avanzado** | El parser limita ZIPs adversariales y la transformación pesada ya se reserva con compare-and-set, se ejecuta en una Netlify Background Function firmada y se observa mediante polling tenant-aware. El request dejó de esperar IA, extracción y creación del curso. Siguen pendientes mover el parsing del upload, añadir lease/heartbeat/reintentos recuperables y garantizar rollback o reanudación de escrituras parciales. |
| TD-16 | **Implementado** | La configuración service-role ahora falla de forma explícita y ya no degrada silenciosamente a anon. Los jobs de generación/validación intervenidos tampoco dependen de la vigencia del JWT del usuario. |
| TD-17 | **Parcial** | El guardado de draft usa `upsert` y la publicación ya no devuelve éxito si falla el estado local posterior. Falta outbox/reconciliación automática de extremo a extremo. |
| TD-13 | **Mitigado** | Los ocho tests antes huérfanos están enlazados a `verify`; al activarlos se detectó y corrigió la compatibilidad de readiness para clips legados. Falta cobertura instrumentada, RLS local y E2E. |
| TD-18 | **Mitigado** | Se eliminaron rangos `latest` de Supabase en web y se añadió Dependabot semanal agrupado. La consolidación completa de manifests y versiones transversales sigue pendiente. |
| TD-19 | **Implementado en repositorio** | Express ya no monta `/api/v1/auth` y el servicio mock no puede emitir tokens aunque alguien lo vuelva a invocar. Falta verificar/desactivar cualquier despliegue antiguo que no se actualice con este código. |
| TD-22 | **Parcial** | Lia, publicación, draft e importación externa tienen contratos Zod y respuestas internas más seguras. Falta normalizar el resto de rutas. |
| TD-23 | **Parcial** | Orígenes de Server Actions exactos y headers globales añadidos; CSP está en `Report-Only` para observar incompatibilidades antes de enforcement. |
| TD-24 | **Mitigado** | OneDrive, Google Drive, Artlist y los callbacks OAuth de Google/Microsoft usan deadlines centralizados; las tres importaciones cloud/media rechazan descargas mayores a 150 MB durante metadata o streaming. El encadenamiento de materiales también tiene timeout y propaga fallos. Siguen pendientes retries idempotentes, backpressure, cuotas y telemetría uniforme en el inventario restante. |
| TD-25 | **Mitigado** | Las fronteras UI de assets, Artlist y Google Picker ya no usan `any`; el schema de `MaterialAssets` cubre el contrato vigente. El control plane valida sus reglas puras, tipa la persistencia conforme a `BD.sql` y valida el JSONB de assets antes de Remotion. Sus 47 puntos `any` iniciales quedaron en cero. Permanece como mejora estructural generar los tipos Supabase automáticamente. |

### Verificación posterior a la remediación

- `npm run verify`: **aprobado** tras las ampliaciones de TD-11, TD-24 y TD-25; la suite de fronteras queda ampliada a 30 pruebas y hay 19 casos de cobertura enlazados.
- Detección de ciclos: `madge` procesó 842 archivos después de integrar `main` y reportó **0 dependencias circulares**.
- Guardia de migraciones: **aprobada** sobre los 124 SQL presentes en el checkout actual; no permite ampliar las colisiones históricas sin reconciliación explícita.
- Suites dirigidas: **aprobadas** en Auth Bridge, publicación, curación, schemas de generación, syllabus/plan, validación de duración y producción visual/HeyGen/Remotion. Cinco pruebas exclusivas del buscador de biblioteca retirado se eliminaron junto con ese código muerto.
- `npm run build`: **aprobado** con acceso de red para `next/font`.
- `npm run build:legacy-api` y `npm run lint:legacy-api`: **aprobados**.
- `npm audit --omit=dev --json`: **0 vulnerabilidades de producción**.
- `git diff --check`: sin errores de whitespace; los avisos LF/CRLF corresponden a la configuración del checkout.

## Resumen ejecutivo

El sistema tiene una base funcional y varias decisiones recientes de buena calidad —tipado estricto, validación Zod en partes del dominio de producción, jobs durables de HyperFrames, firmas HMAC para algunos callbacks y una suite unitaria apreciable—, pero su riesgo global de mantenibilidad es **alto**. La principal causa no es la duplicación global, que es relativamente baja, sino la coexistencia de dos generaciones arquitectónicas con controles distintos.

Los riesgos más urgentes son de límites de confianza:

1. Cinco Netlify Functions usan `service_role` y aceptan identificadores del body sin autenticar ni verificar firma. Una sexta función de render delega en un servicio privilegiado sin guardia local visible.
2. `/api/lia` puede invocar Gemini sin autenticar al usuario ni aplicar rate limit.
3. La importación externa acepta URLs arbitrarias, sigue redirecciones y carga el cuerpo completo en memoria, creando riesgo SSRF y agotamiento de recursos.
4. Existe una política SQL explícita que permite subir thumbnails al rol `public`, y las políticas de Storage para SCORM no están aisladas por organización.

Los riesgos estructurales más importantes son la escritura no atómica del JSON `material_components.assets` en numerosos flujos concurrentes, archivos de 1.500-4.000+ líneas, componentes React con decenas de estados, tres ciclos de dependencias, capas de dominio que importan rutas HTTP, y rutas legacy/tenant paralelas. La cobertura es robusta en producción visual, pero débil en autenticación, API, RLS, background jobs del pipeline y publicación. A escala, la biblioteca aplica filtros y paginación en memoria sobre conjuntos previamente truncados, y varias integraciones carecen de un presupuesto uniforme de timeout, retry y tamaño.

**Evaluación general:**

| Dimensión | Estado | Justificación resumida |
|---|---|---|
| Seguridad | Rojo | Superficie privilegiada sin autenticación uniforme, SSRF, HTML no sanitizado y Storage abierto. |
| Confiabilidad | Ámbar-rojo | Jobs modernos son durables, pero siguen existiendo jobs antiguos sin firma y escrituras read/merge/write. |
| Mantenibilidad | Ámbar-rojo | God objects, límites de capa invertidos y rutas duplicadas. |
| Tipado | Ámbar | `strict` pasa, pero hay `any` concentrado y el build omite errores de tipos. |
| Pruebas | Ámbar | 81 tests web, 16 suites aprobadas; poca cobertura de fronteras críticas y 8 tests no están enlazados a scripts. |
| Base de datos | Rojo | Versiones de migración duplicadas y políticas Storage inseguras; esquema real no verificado. |
| Observabilidad | Ámbar-rojo | 562 llamadas `console.*`; trazabilidad estructurada solo en subsistemas recientes. |
| Dependencias | Ámbar | Sin CVE detectadas, pero manifests duplicados, rangos `latest` y upgrades pendientes. |
| Documentación | Ámbar | README reconoce parte del legado, pero contiene comandos inválidos y documentos contradictorios. |

## Estado general por área

### Frontend

La organización por dominios es visible, pero algunos componentes absorben orquestación, estado remoto, polling, edición y presentación. `NativeCompositionPreview` contiene 43 `useState`, 22 `useEffect` y se extiende desde la línea 244 hasta aproximadamente la 2.572 antes de sus subcomponentes. La duplicación se concentra en layouts y páginas admin/architect/builder, especialmente entre rutas legacy y rutas con `[empresaSlug]`.

### Backend Next.js

Hay buenos helpers de autorización por artefacto/componente, pero su adopción no es uniforme. Algunas rutas usan Zod y autorización tenant-aware; otras hacen cast directo del JSON. El dominio importa rutas HTTP y rutas importan Server Actions ubicadas en UI, por lo que el transporte no es una capa periférica estable.

### Netlify Functions

Conviven jobs antiguos que confían en el body o un token de usuario con jobs nuevos firmados mediante HMAC. Esta inconsistencia es el mayor riesgo inmediato porque las funciones antiguas crean clientes privilegiados y pueden mutar estados o generar consumo de IA.

### API Express legado

Está documentada como legado, pero conserva Dockerfile y Cloud Build. Su única ruta de login usa credenciales mock fijas. No es deuda crítica si está totalmente retirada y no desplegada; sí sería una exposición grave si conserva un endpoint accesible.

### Base de datos y Storage

Las migraciones recientes muestran mejoras claras: RLS por organización, RPCs atómicos, leases, idempotencia y endurecimiento de webhooks. Sin embargo, el historial contiene versiones repetidas, dumps SQL dentro de `migrations/` y políticas antiguas de Storage que siguen abiertas porque no se encontró una migración posterior que las revoque.

### Integraciones externas

HyperFrames/HeyGen reciente tiene allowlists, firmas, límites de body, retries y reconciliación. En contraste, Lia, importación genérica, publicación SofLIA y algunos jobs educativos carecen de controles equivalentes o reconciliación completa.

## Hallazgos priorizados

### TD-01 — Netlify Functions privilegiadas sin autenticación ni firma

- **Categoría / clasificación:** Seguridad, autorización, background jobs — **hecho comprobado**.
- **Descripción:** `syllabus-generation-background`, `materials-generation-background`, `curation-background`, `validate-curation-background` y `validate-materials-background` solo verifican método/body y luego crean un cliente `service_role`. No validan sesión, token interno, firma HMAC ni encabezado de Netlify. `hyperframes-render-background` también acepta un `renderRequestId` sin guardia en el handler y llama a un servicio privilegiado.
- **Evidencia:** `apps/web/netlify/functions/syllabus-generation-background.ts:118-147`; `materials-generation-background.ts:308-343`; `curation-background.ts:13-41`; `validate-curation-background.ts:10-34`; `validate-materials-background.ts:73-100`; `hyperframes-render-background.ts:9-16`. El contraste seguro está en `slides-generation-background.ts:21-33`, que usa `verifyBackgroundPayload`.
- **Impacto técnico y de negocio:** una llamada externa con IDs conocidos o filtrados puede borrar fuentes automáticas, cambiar estados, regenerar contenido o consumir APIs pagadas saltándose RLS. Puede corromper cursos de otra organización.
- **Severidad / probabilidad / esfuerzo:** **Crítica / Alta / M**.
- **Dependencias o riesgos de solución:** rotación y distribución de un secreto; compatibilidad con invocaciones encadenadas y reintentos ya existentes; evitar romper scheduled functions.
- **Recomendación concreta:** adoptar un único envelope firmado con expiración, nonce/idempotency key, `organizationId` y tipo de job. Verificar firma antes de parsear IDs y volver a comprobar que la entidad pertenece a la organización firmada. No aceptar datos pedagógicos completos del caller cuando puedan cargarse desde DB.
- **Criterios de aceptación:** todas las funciones privilegiadas devuelven 401 ante ausencia/firma inválida; firma expirada o replay rechazados; pruebas de acceso cross-tenant; ningún cliente `service_role` se crea antes de autorizar; inventario automatizado impide añadir un handler privilegiado sin guardia.

### TD-02 — Lia expone consumo de Gemini sin sesión ni rate limit

- **Categoría / clasificación:** Seguridad, costes, disponibilidad — **hecho comprobado**.
- **Descripción:** `/api/lia` crea un cliente Supabase, pero nunca llama a `getAuthenticatedUser` ni exige tenant válido antes de invocar Gemini. Además registra los primeros ocho caracteres de las claves configuradas.
- **Evidencia:** `apps/web/src/app/api/lia/route.ts:28-45` y llamada externa en `:77-78`; logging de prefijos en `:47-55`; no se encontró middleware/rate limiter y `proxy.ts:44-47` excluye todas las rutas `/api`.
- **Impacto técnico y de negocio:** abuso anónimo, incremento de factura, agotamiento de cuota y denegación de servicio para usuarios legítimos; exposición parcial innecesaria de secretos en logs.
- **Severidad / probabilidad / esfuerzo:** **Crítica / Alta / S-M**.
- **Dependencias o riesgos de solución:** definir cuota por usuario/organización y comportamiento para sesiones GoTrue vs Auth Bridge; evitar bloquear tráfico legítimo detrás de proxies.
- **Recomendación concreta:** exigir identidad y tenant autorizados, validar body con Zod, limitar tamaño de screenshot/prompt, aplicar rate limit por usuario+org+IP y budget diario, eliminar prefijos de claves de logs.
- **Criterios de aceptación:** anónimo recibe 401; usuario sin org recibe 403; límites devuelven 429; pruebas de cuota concurrente; logs no contienen fragmentos de claves; métricas de tokens/coste por organización.

### TD-03 — Importación externa permite SSRF y buffers sin límite efectivo

- **Categoría / clasificación:** Seguridad y rendimiento — **hecho comprobado**.
- **Descripción:** un usuario con acceso a un componente puede suministrar `videoUrl`/`videoId` HTTP arbitrario. El servidor hace `fetch`, sigue redirecciones por defecto, no bloquea IPs privadas y usa `arrayBuffer()`. El límite de 150 MB depende de `Content-Length`; un origen chunked o deshonesto lo evita. El contenido se almacena como MP4 sin validar magic bytes/MIME.
- **Evidencia:** `apps/web/src/app/api/production/import-external/route.ts:19-53`, fetch arbitrario `:112-133`, almacenamiento forzado `:135-145`. Compárese con la allowlist y `redirect: "error"` de `supabase/functions/import-hyperframes-video/index.ts:19-26,179-225`.
- **Impacto técnico y de negocio:** acceso a metadata endpoints/red interna, exfiltración indirecta, consumo de memoria serverless, timeouts, archivos corruptos y costes de egress/storage.
- **Severidad / probabilidad / esfuerzo:** **Alta / Media-alta / M**.
- **Dependencias o riesgos de solución:** CDNs con hosts variables o URLs firmadas; resolución DNS debe repetirse tras redirección para prevenir rebinding.
- **Recomendación concreta:** permitir solo HTTPS y proveedores/hosts aprobados; resolver y rechazar redes privadas/reservadas; desactivar redirects o revalidarlos; streaming con contador duro, timeout y abort; verificar MIME y firma del archivo.
- **Criterios de aceptación:** localhost, RFC1918, link-local, redirects a red privada y respuestas sin longitud que exceden el límite son rechazados; memoria máxima acotada; pruebas SSRF y de payload chunked.

### TD-04 — HTML generado se renderiza sin sanitización

- **Categoría / clasificación:** Seguridad frontend, XSS almacenado — **hecho comprobado con impacto condicionado al contenido persistido**.
- **Descripción:** los campos `body_html` de lecturas y ejercicios se insertan con `dangerouslySetInnerHTML`. La generación por IA solicita HTML, pero no se encontró sanitización en la ruta general de materiales. El sanitizador existente solo aparece en transformación SCORM.
- **Evidencia:** `apps/web/src/domains/materials/components/ComponentContentRenderer.tsx:308-330` y `:497-506`; prompts en `apps/web/src/shared/config/prompts/materials-generation.prompts.ts:366,451,581`; sanitización limitada a SCORM en `scorm-transformation.service.ts:226-237`.
- **Impacto técnico y de negocio:** un contenido manipulado por prompt injection, edición manual o dato legado puede ejecutar handlers HTML en la sesión de un revisor y realizar acciones con sus credenciales.
- **Severidad / probabilidad / esfuerzo:** **Alta / Media / S-M**.
- **Dependencias o riesgos de solución:** preservar el subconjunto visual necesario; sanitización debe ocurrir al escribir y como defensa al renderizar.
- **Recomendación concreta:** definir allowlist única de tags/atributos/protocolos, eliminar eventos/estilos peligrosos y sanitizar server-side; añadir CSP sin `unsafe-inline` cuando sea viable.
- **Criterios de aceptación:** fixtures con `onerror`, `javascript:`, SVG activo, iframe y estilos peligrosos no ejecutan ni persisten; contenido legítimo conserva formato; pruebas de regresión en ambos viewers.

### TD-05 — Políticas de Storage permiten abuso público y acceso SCORM transversal

- **Categoría / clasificación:** Seguridad de datos, multi-tenancy — **hecho comprobado en migraciones; estado remoto por verificar**.
- **Descripción:** una migración reemplaza la subida autenticada de thumbnails por `FOR INSERT TO public` sin prefijo de usuario/organización. SCORM permite a cualquier rol `authenticated` subir y leer cualquier objeto del bucket sin validar ruta. La RLS de tablas SCORM fue endurecida después, pero no se encontró revocación equivalente en Storage.
- **Evidencia:** `supabase/migrations/20260318000000_fix_thumbnails_rls.sql:1-9`; `20260211_create_scorm_tables.sql:109-124`; endurecimiento solo de tablas en `20260621120000_add_org_to_scorm_imports.sql:10-42`.
- **Impacto técnico y de negocio:** spam y costes de almacenamiento, objetos huérfanos que el anónimo no puede borrar, exposición de paquetes SCORM entre tenants y posible filtración de propiedad intelectual.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta / M**.
- **Dependencias o riesgos de solución:** Auth Bridge no siempre produce una sesión GoTrue válida; probablemente requiere URLs firmadas server-side en lugar de RLS basada solo en `auth.uid()`.
- **Recomendación concreta:** retirar INSERT público; emitir signed upload URLs tras autorización server-side; imponer rutas `organizations/{org}/...`; políticas SELECT/UPDATE/DELETE que validen membership activa.
- **Criterios de aceptación:** anon no puede escribir; un tenant no puede listar/leer/escribir rutas de otro; límites MIME/tamaño y lifecycle de objetos huérfanos; pruebas SQL automatizadas.

### TD-06 — Historial de migraciones no tiene versiones únicas

- **Categoría / clasificación:** Base de datos, reproducibilidad — **hecho comprobado**.
- **Descripción:** múltiples archivos comparten el mismo prefijo de versión, incluyendo siete `20240117_*`, dos `20260721120000_*`, dos `20260825120000_*` y dos `20260826120000_*`. Además `BD.sql`, `BD_target.sql` y `BDSoflia.sql` están dentro de `migrations/` aunque parecen dumps/baselines.
- **Evidencia:** nombres bajo `supabase/migrations/`; por ejemplo `20260826120000_create_production_automation_runs.sql` y `20260826120000_patch_material_component_assets.sql`. Los dumps contienen 1.193-1.987 líneas.
- **Impacto técnico y de negocio:** orden ambiguo, colisiones en la tabla de historial, entornos nuevos no reproducibles y riesgo de aplicar un dump sobre migraciones incrementales.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta en un bootstrap nuevo / M-L**.
- **Dependencias o riesgos de solución:** renombrar migraciones ya aplicadas exige reconciliar `supabase_migrations.schema_migrations` en todos los entornos; no debe hacerse sin inventario remoto.
- **Recomendación concreta:** comparar hashes/versiones aplicadas por ambiente, congelar el historial, convertir dumps en documentación/fixtures fuera de `migrations`, y crear una baseline limpia para instalaciones nuevas.
- **Criterios de aceptación:** versiones únicas; `supabase db reset` desde cero y upgrade desde cada ambiente soportado producen el mismo schema; checksum documentado; CI ejecuta reset y tests RLS.

### TD-07 — Actualizaciones no atómicas de `material_components.assets`

- **Categoría / clasificación:** Concurrencia, integridad de datos — **hecho comprobado**.
- **Descripción:** existe el RPC `patch_material_component_assets` creado específicamente para evitar pérdidas concurrentes, pero al menos 15 flujos siguen leyendo el JSON completo, mezclándolo en memoria y escribiéndolo con `.update({ assets: ... })`.
- **Evidencia:** motivación del RPC en `supabase/migrations/20260826120000_patch_material_component_assets.sql:1-30`; usos correctos en `production.actions.ts:820,870`; escrituras completas en `production/import-external/route.ts:160-185`, `google-drive/import/route.ts:101-213`, `slides/animated-deck/prepare/route.ts:373-405`, `open-design/export/route.ts:501-503` y `hyperframes-video-import.service.ts:144`.
- **Impacto técnico y de negocio:** dos cargas/generaciones simultáneas pueden sobrescribir assets hermanos, perder URLs finales o revertir estados; el fallo es intermitente y costoso de reconstruir.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta / M-L**.
- **Dependencias o riesgos de solución:** algunos cambios eliminan claves y requieren semántica explícita; operaciones compuestas pueden necesitar RPCs transaccionales específicos, no solo merge superficial.
- **Recomendación concreta:** prohibir escrituras completas fuera de un repositorio único; migrar patches simples al RPC y usar compare-and-swap/version column para reemplazos complejos.
- **Criterios de aceptación:** búsqueda estática no encuentra `.update({ assets:` fuera del repositorio permitido; pruebas concurrentes preservan campos independientes; conflictos complejos devuelven 409/reintento en lugar de perder datos.

### TD-08 — Controles de calidad no bloquean regresiones

- **Categoría / clasificación:** Configuración, CI/CD — **hecho comprobado**.
- **Descripción:** el build declara `typescript.ignoreBuildErrors: true`; el lint ejecuta `next lint` y falla; no hay script `test` agregador ni CI visible. Aunque el type-check manual pasa hoy, un futuro error puede desplegarse.
- **Evidencia:** `apps/web/next.config.ts:6-8`; `apps/web/package.json` script `lint`; `package.json` carece de script `test`; salida reproducible de `npm run lint`: “Invalid project directory ... apps/web/lint”; no existe `.github/`.
- **Impacto técnico y de negocio:** regresiones de tipos, estilo, seguridad o pruebas omitidas llegan a producción dependiendo de disciplina manual.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta / S-M**.
- **Dependencias o riesgos de solución:** habilitar ESLint inicialmente puede revelar deuda considerable; debe adoptarse con baseline y reglas graduales.
- **Recomendación concreta:** ESLint 9 flat config, scripts `typecheck`, `lint`, `test`, `verify`; retirar `ignoreBuildErrors`; CI con install reproducible, migración limpia, typecheck, lint, tests y build.
- **Criterios de aceptación:** `npm run verify` falla ante error de tipo/lint/test; build no omite tipos; branch protection exige el job; ningún comando documentado es inválido.

### TD-09 — Registro local y login Auth Bridge no comparten identidad

- **Categoría / clasificación:** Arquitectura de autenticación, experiencia de usuario — **hecho comprobado; fallo final depende de si ambas URLs Supabase apuntan al mismo proyecto**.
- **Descripción:** `/api/auth/sign-up` crea un usuario en el Supabase de Courseforge, mientras `completeAuthBridgeLogin` busca al usuario y autentica la contraseña en el Supabase de SofLIA. El tenant resolver exige `bridgeUser`; una sesión GoTrue local por sí sola no aporta organizaciones.
- **Evidencia:** `apps/web/src/app/api/auth/sign-up/route.ts:18-36`; `apps/web/src/app/login/auth-bridge.ts:190-225`; `tenant-context.ts:161-185`; la UI expone registro en `apps/web/src/app/register/page.tsx:39-52`.
- **Impacto técnico y de negocio:** usuarios pueden completar registro y no poder iniciar sesión o quedar sin tenant; soporte manual, abandono y estados de identidad divergentes.
- **Severidad / probabilidad / esfuerzo:** **Alta / Media-alta / M-L**.
- **Dependencias o riesgos de solución:** decisión de producto sobre sistema de identidad canónico, invitaciones y sincronización con SofLIA.
- **Recomendación concreta:** elegir una autoridad de identidad; si SofLIA es canónica, registrar/invitar allí y sincronizar de forma transaccional. Si se admite GoTrue local, implementar membership/tenant completo para ese camino.
- **Criterios de aceptación:** test E2E registro→confirmación→login→tenant; una identidad y membership canónicos; recuperación ante fallo parcial; mensajes no prometen registro cuando solo existe invitación.

### TD-10 — God objects y componentes con demasiadas responsabilidades

- **Categoría / clasificación:** Complejidad, cohesión — **hecho comprobado**.
- **Descripción:** varios archivos combinan almacenamiento, seguridad, scheduling, proveedores, UI, polling y normalización. Esto eleva superficie de cambio y dificulta pruebas aisladas.
- **Evidencia:** `desktop-worker-control-plane.ts` supera 4.267 líneas y contiene 277 decisiones detectadas; `NativeCompositionPreview.tsx` tiene ~2.997 líneas, 43 `useState` y 22 `useEffect`; `HeygenStudioClient.tsx` ~2.477 líneas; `ProductionStructuredAssetSections.tsx` ~2.435; `heygen-scenes.service.ts` ~2.417; `production.actions.ts` ~1.646.
- **Impacto técnico y de negocio:** regresiones colaterales, conflictos de merge, onboarding lento, revisiones difíciles y alta dependencia de conocimiento tácito.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta / L-XL**.
- **Dependencias o riesgos de solución:** refactor masivo sin characterization tests sería más riesgoso que la deuda; dividir por tamaño sin límites de dominio solo desplaza complejidad.
- **Recomendación concreta:** extraer verticalmente: autenticación/control plane, claim/lease, build, preview, telemetry; en UI, store/controladores por workflow y componentes puros. Empezar por seams cubiertos por tests.
- **Criterios de aceptación:** ningún nuevo archivo excede el umbral acordado; responsabilidades y dependencias explícitas; submódulos con tests de contrato; reducción medible de estados/efectos por componente sin alterar comportamiento.

### TD-11 — Importación SCORM síncrona y vulnerable a agotamiento de recursos

- **Categoría / clasificación:** Rendimiento, disponibilidad, archivos no confiables — **hecho comprobado**.
- **Descripción:** el endpoint acepta por extensión `.zip`, lee todo el archivo en memoria, lo sube y lo vuelve a parsear síncronamente. No hay límite de bytes, número de entradas, tamaño descomprimido, profundidad del manifest ni ratio de compresión.
- **Evidencia:** `apps/web/src/app/api/admin/scorm/upload/route.ts:24-43,70-107`; `scorm-parser.service.ts:46-61`. Los comentarios `:70-72` reconocen que es una solución MVP síncrona.
- **Impacto técnico y de negocio:** zip bombs, OOM/timeouts serverless, solicitudes bloqueadas y registros/objetos parcialmente creados.
- **Severidad / probabilidad / esfuerzo:** **Alta / Media-alta / M-L**.
- **Dependencias o riesgos de solución:** extracción segura en entorno aislado; compatibilidad con paquetes SCORM grandes reales.
- **Recomendación concreta:** signed upload directo con límite; job asíncrono con antivirus/zip budget; validar central directory antes de extraer; límites de entradas, bytes expandidos, paths y XML.
- **Criterios de aceptación:** zip bomb/path traversal/manifest gigante rechazados; request web solo encola; estados y cleanup idempotentes; métricas de tamaño/tiempo; pruebas con fixtures adversariales.

**Avance de remediación (2026-09-09):** `POST /api/admin/scorm/process` ya no ejecuta la transformación. Valida UUID, identidad, rol revisor y tenant; reserva `SCORM_TRANSFORMING/TRANSFORM_QUEUED` con compare-and-set, despacha un envelope HMAC y responde `202`. `scorm-transformation-background.ts` verifica firma/replay y el servicio reclama una sola vez `TRANSFORM_QUEUED→TRANSFORM_RUNNING`. La UI consulta `GET /api/admin/scorm/process` hasta `COMPLETED` o `FAILED`. Las escrituras antes ignoradas de lecciones, componentes, syllabus y estado final ahora fallan explícitamente; el artefacto se enlaza al import al crearse, y un fallo persiste un mensaje sanitizado. También se exige rol revisor en upload y se elimina el objeto Storage si falla la creación del registro. Tres pruebas cubren UUID/estados/claim y una guardia estática impide regresar la transformación al request o exponer el handler sin firma.

**Riesgo residual comprobado:** según `supabase/migrations/BD.sql:287-311`, `scorm_imports` no tiene lease, heartbeat, intento ni `updated_at`. La reserva actual evita doble ejecución concurrente normal, pero una terminación abrupta puede dejar `SCORM_TRANSFORMING` atascado; si ya existe `artifact_id`, reintentar automáticamente podría duplicar materiales. El parsing inicial continúa dentro de upload para conservar la revisión inmediata del manifest. TD-11 no se considera cerrado hasta diseñar una migración reversible de lease/idempotencia y una estrategia transaccional o resumible para las proyecciones.

### TD-12 — Ciclos de dependencias e inversión de capas

- **Categoría / clasificación:** Arquitectura, acoplamiento — **hecho comprobado**.
- **Descripción:** Madge detectó tres ciclos. Además servicios de dominio importan handlers HTTP y Netlify Functions importan rutas Next.js, haciendo que transporte y negocio se dependan mutuamente.
- **Evidencia:** ciclo `materials-generation-background.ts` ↔ `shared/materials-generation-runtime.ts` por import estático en `materials-generation-background.ts:13-25` y dinámico en `materials-generation-runtime.ts:120`; ciclos alrededor de `composition-document.types.ts:9`, `composition-motion-scheduling.service.ts:9-15` y `composition-timeline-snap.service.ts:1`. Inversión adicional en `production-automation-dispatcher.service.ts:283-309` y `slides-generation-background.ts:6-8`.
- **Impacto técnico y de negocio:** orden de inicialización frágil, bundles más amplios, tests difíciles y riesgo de que refactors aparentemente locales rompan runtime serverless.
- **Severidad / probabilidad / esfuerzo:** **Media-alta / Media / M-L**.
- **Dependencias o riesgos de solución:** separar tipos/schemas puede afectar muchas importaciones; preservar contratos de jobs.
- **Recomendación concreta:** mover casos de uso a módulos application puros; handlers y Server Actions solo adaptan Request/Response. Extraer tipos sin imports runtime y pasar callbacks para auto-invocación en tests.
- **Criterios de aceptación:** Madge reporta cero ciclos; `domains/**` no importa `app/**`; Netlify no importa handlers de ruta; casos de uso se prueban sin construir `Request` artificial.

### TD-13 — Pruebas desbalanceadas y ocho tests fuera de cualquier script

- **Categoría / clasificación:** Calidad de pruebas — **hecho comprobado**.
- **Descripción:** hay 81 archivos de test web: 61 pertenecen a producción, mientras auth tiene uno, publicación uno, plan uno y no hay tests de rutas API/RLS para los límites críticos. Ocho archivos no son referenciados por ningún script `test:*`. No hay cobertura ni E2E activo.
- **Evidencia:** scripts en `apps/web/package.json`; omitidos: `slide-generation.test.ts`, `hyperframes-render-submission.service.test.ts`, `production-automation-readiness.service.test.ts`, `composition-branding-placement.service.test.ts`, `composition-duration-recalculation.service.test.ts`, `composition-timeline-trim.service.test.ts`, `composition-production-intro.service.test.ts` y `composition-preview-playhead.service.test.ts`. Ejecutar manualmente `hyperframes-render-submission` falla por alias `@/lib/errors`, confirmando que no está integrado al runner.
- **Impacto técnico y de negocio:** falsa confianza por suite verde; vulnerabilidades de autorización, concurrencia, pipeline y publicación carecen de red de seguridad.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta / M-L**.
- **Dependencias o riesgos de solución:** tests DB requieren Supabase local/Docker; E2E necesita fixtures deterministas y stubs de proveedores.
- **Recomendación concreta:** runner único que descubra tests, soporte aliases y cobertura; priorizar pruebas negativas de auth/tenant, RLS, firmas/replay, concurrencia JSON, SCORM y publicación idempotente.
- **Criterios de aceptación:** todo `*.test.*` es descubierto automáticamente; cobertura por dominio con umbrales de ramas críticas; CI ejecuta tests API+SQL+E2E mínimos; mutation/negative tests para autorización.

### TD-14 — Duplicación concentrada en rutas por rol y proveedor

- **Categoría / clasificación:** Duplicación, frontend/backend — **hecho comprobado**.
- **Descripción:** la duplicación total es baja, pero jscpd halló 70 clones. Las áreas sensibles son layouts admin/architect/builder, páginas `new`, rutas tenant/legacy y lógica casi idéntica de Google Drive/cloud storage.
- **Evidencia:** clones entre `[empresaSlug]/admin/layout.tsx:10-46`, `[empresaSlug]/builder/layout.tsx:9-45` y layouts legacy; `admin/artifacts/new/page.tsx` vs `builder/artifacts/new/page.tsx`; bloque de 80 líneas en `cloud-storage/import/route.ts:176-255` vs `google-drive/import/route.ts:136-216`. Existen 27 pares de páginas legacy/tenant con implementaciones distintas.
- **Impacto técnico y de negocio:** correcciones de seguridad o navegación aplicadas solo a una variante; comportamiento divergente por rol/URL.
- **Severidad / probabilidad / esfuerzo:** **Media / Alta / M-L**.
- **Dependencias o riesgos de solución:** las diferencias de permisos son reales y no deben ocultarse en componentes excesivamente configurables.
- **Recomendación concreta:** layouts compartidos con políticas de rol explícitas, páginas tenant como única implementación y redirects legacy delgados; un caso de uso común para importar activos.
- **Criterios de aceptación:** una sola implementación por flujo; tests parametrizados por rol/tenant; reducción de clones en estas carpetas; retirar rutas legacy tras telemetría de uso.

### TD-15 — Observabilidad fragmentada y logs sensibles/ruidosos

- **Categoría / clasificación:** Observabilidad y operación — **hecho comprobado**.
- **Descripción:** se contaron 452 llamadas `console.*` en `apps/web/src` y 106 en Netlify Functions. No se encontró Sentry/OpenTelemetry/Pino/Winston. `pipeline_events` se usa principalmente desde `production.actions.ts`; los Edge Functions recientes sí generan JSON estructurado, pero no es el patrón general. El build genera decenas de “Auth verification error” porque `getAuthBridgeUser` captura también el sentinel de render dinámico.
- **Evidencia:** `apps/web/src/utils/auth/session.ts:57-105`; logs de email en `artifact-action-auth.ts:38-60`; fragmentos de API key en `api/lia/route.ts:47-55`; logging estructurado positivo en `supabase/functions/_shared/http.ts:21-29`; usos de `pipeline_events` en `production.actions.ts:1176-1205`.
- **Impacto técnico y de negocio:** incidentes difíciles de correlacionar, PII/secret fragments en logs, alertas ruidosas y diagnóstico manual de jobs atascados.
- **Severidad / probabilidad / esfuerzo:** **Media-alta / Alta / M-L**.
- **Dependencias o riesgos de solución:** política de retención y datos personales; propagación de correlation IDs a proveedores y background jobs.
- **Recomendación concreta:** logger estructurado con redacción, `requestId/jobId/artifactId/orgId`, niveles por ambiente, métricas y alertas de estados terminales/atascados; re-lanzar errores framework como `DynamicServerError`.
- **Criterios de aceptación:** cero claves/prefijos/emails en logs normales; trazabilidad extremo a extremo; dashboards de latencia/error/coste; build sin errores de auth espurios; runbook por pipeline.

### TD-16 — El helper “service role” degrada silenciosamente a anon

- **Categoría / clasificación:** Configuración y fail-fast — **hecho comprobado**.
- **Descripción:** tanto el helper web como el de Netlify retornan `NEXT_PUBLIC_SUPABASE_ANON_KEY` si falta `SUPABASE_SERVICE_ROLE_KEY`, aunque los callers creen tener privilegios administrativos.
- **Evidencia:** `apps/web/src/lib/server/env.ts:72-82`; `apps/web/netlify/functions/shared/bootstrap.ts:30-35,89-90`.
- **Impacto técnico y de negocio:** fallos tardíos y parciales por RLS, jobs que quedan en estados intermedios y diagnósticos engañosos; una mala configuración de producción no falla al arrancar.
- **Severidad / probabilidad / esfuerzo:** **Media-alta / Media / S**.
- **Dependencias o riesgos de solución:** algunos entornos locales pueden depender del fallback.
- **Recomendación concreta:** `getSupabaseServiceRoleKey` debe requerir la clave; crear helper anon con nombre separado; validar variables por proceso al cold start.
- **Criterios de aceptación:** job privilegiado no arranca sin service role; mensaje de configuración claro; tests de env; ningún helper administrativo acepta anon.

### TD-17 — Publicación externa puede quedar desincronizada del estado local

- **Categoría / clasificación:** Integraciones, consistencia — **hecho comprobado**.
- **Descripción:** la publicación hace upsert en SofLIA y luego actualiza `publication_requests` local. Si la segunda operación falla, solo registra el error y responde éxito. No se encontró reconciliador de este estado.
- **Evidencia:** `apps/web/src/app/api/publish/route.ts:95-122` (commit externo), `:124-137` (fallo local tolerado), `:142-146` (éxito al caller).
- **Impacto técnico y de negocio:** UI en READY aunque SofLIA ya recibió el curso, reintentos/confusión operativa y auditoría incompleta. El slug reduce duplicados, pero no resuelve estado ni errores posteriores de procesamiento.
- **Severidad / probabilidad / esfuerzo:** **Media / Media / M**.
- **Dependencias o riesgos de solución:** no hay transacción distribuida; depende de contrato/idempotencia y estado consultable de SofLIA.
- **Recomendación concreta:** patrón outbox local: persistir intento/idempotency key, worker deposita, actualiza SENT, reconciliador repara; responder estado “aceptado con sincronización pendiente” si falla el update local.
- **Criterios de aceptación:** fallo entre ambos writes se recupera automáticamente; reintentos son idempotentes; historial de intentos y respuesta; alerta por desincronización.

### TD-18 — Dependencias y ownership de manifests inconsistentes

- **Categoría / clasificación:** Dependencias y reproducibilidad — **hecho comprobado**.
- **Descripción:** raíz y `apps/web` declaran muchas dependencias runtime duplicadas; web usa `latest` para Supabase. Conviven Zod 3/4 y dotenv 16/17. `npm outdated` muestra upgrades dentro de rango y cambios mayores pendientes; no son vulnerabilidades por sí mismos.
- **Evidencia:** `package.json` raíz y `apps/web/package.json`; `apps/web/package.json` declara `@supabase/ssr` y `@supabase/supabase-js` como `latest`; lockfile tiene entradas repetidas. `npm audit`: 0; `npm outdated`: Next 16.1.3→16.3.4, Supabase SSR 0.8.0→0.12.6, SDKs y otros.
- **Impacto técnico y de negocio:** ownership confuso, resolución/hoisting distinta por instalación y upgrades accidentales al regenerar lockfile; contratos distintos entre API y web.
- **Severidad / probabilidad / esfuerzo:** **Media / Media / M**.
- **Dependencias o riesgos de solución:** upgrades mayores de SDKs IA/Express/Zod requieren pruebas contractuales; Remotion debe mantenerse alineado entre paquetes.
- **Recomendación concreta:** dependencias runtime en el workspace que las usa, versiones exactas o rangos controlados, Renovate/Dependabot en lotes compatibles y política de una versión por librería transversal.
- **Criterios de aceptación:** sin `latest`; duplicados justificados o eliminados; install reproducible; bot de upgrades con CI; contrato de versiones Remotion/Supabase documentado.

### TD-19 — API Express legado contiene autenticación mock en un artefacto desplegable

- **Categoría / clasificación:** Código legado y seguridad — **hecho comprobado en repo; exposición es hipótesis**.
- **Descripción:** `/api/v1/auth/login` acepta `demo@test.com`/`123456` y devuelve `mock-jwt-token`. El README lo llama legado, pero existen Dockerfile y Cloud Build que producen imagen `prod`.
- **Evidencia:** `apps/api/src/features/auth/auth.service.ts:3-10`; route en `auth.routes.ts:4-8`; imagen prod en `apps/api/cloudbuild.yaml:7-20`; runtime en `apps/api/Dockerfile:16-26`.
- **Impacto técnico y de negocio:** si está desplegado o vuelve a desplegarse, ofrece una autenticación falsa y una expectativa de token no verificable; también confunde a desarrolladores y scanners.
- **Severidad / probabilidad / esfuerzo:** **Alta si está expuesto, baja si retirado / Desconocida / S**.
- **Dependencias o riesgos de solución:** confirmar consumidores históricos antes de retirar imagen/route.
- **Recomendación concreta:** verificar DNS, Cloud Run y tráfico; si no tiene consumidores, desmantelar despliegue y eliminar el mock. Si debe conservarse, responder 410 o proteger detrás de feature flag no habilitable en producción.
- **Criterios de aceptación:** inventario demuestra endpoint no expuesto o está eliminado; ninguna imagen prod contiene credenciales mock; documentación y scripts ya no sugieren usarlo como backend activo.

### TD-20 — Documentación y datos históricos mezclan fuentes de verdad

- **Categoría / clasificación:** Documentación, higiene de repositorio — **hecho comprobado; sensibilidad de datos es indicio**.
- **Descripción:** README incluye comandos inexistentes para `apps/api` (`test:remotion`) y reconoce que lint está roto; documentos describen modelos y arquitectura contradictorios; AGENTS menciona `packages/shared` y `packages/ui`, pero `packages/` no existe. Hay 14 CSV versionados bajo `supabase/data`, incluidos archivos “copia” y duplicados, con cientos de UUIDs y 100 URLs.
- **Evidencia:** `README.md:95-102,503-510`; `docs/ClaudeEng.md:28-30,94`; `docs/ARQUITECTURA-COMPLETA.md:1114-1119`; árbol real sin `packages/`; `supabase/data/instructional_plans_rows - copia.csv` y `slides_rows (1)/(2).csv`.
- **Impacto técnico y de negocio:** onboarding incorrecto, ejecución de comandos inválidos, decisiones basadas en modelos retirados y posible conservación innecesaria de snapshots reales.
- **Severidad / probabilidad / esfuerzo:** **Media / Alta / S-M**.
- **Dependencias o riesgos de solución:** determinar si CSV/dumps son fixtures, evidencia regulatoria o datos reales antes de mover/eliminar.
- **Recomendación concreta:** documentación versionada por estado (actual/ADR/histórico), comandos ejecutables en CI, inventario de datos con clasificación y sanitización, fixtures sintéticos en ubicación dedicada.
- **Criterios de aceptación:** todos los comandos documentados pasan; una única arquitectura actual; documentos históricos rotulados; ningún dato real/identificador innecesario versionado; fixtures con procedencia y schema.

### TD-21 — La biblioteca pagina después de cargar y truncar el universo de datos

- **Categoría / clasificación:** Base de datos, rendimiento, escalabilidad — **hecho comprobado; efecto a escala es indicio**.
- **Descripción:** la búsqueda de biblioteca ejecuta cuatro consultas secuenciales (artefactos → materiales → lecciones → componentes), limita cada una a 1.000 filas, materializa y normaliza los resultados en memoria, aplica búsqueda/filtros y recién entonces hace `slice` para paginar. Cuando cualquiera de los niveles supera 1.000 filas, el `total` deja de representar el universo real y páginas válidas desaparecen silenciosamente. Las listas de IDs enviadas mediante `.in(...)` también crecen con el tenant.
- **Evidencia:** constantes y límites en `apps/web/src/domains/library/library-search.service.ts:15-18`; consultas encadenadas en `:74-157`; ejecución secuencial en `:201-219`; filtrado, orden y paginación en memoria en `:230-253`.
- **Impacto técnico y de negocio:** resultados incompletos para clientes grandes, latencia y memoria proporcionales al historial del tenant, mayor transferencia desde PostgREST y percepción de pérdida de contenido. A 10× crece linealmente; a 100× empieza a truncar; a 1.000× el enfoque no conserva exactitud ni coste estable.
- **Severidad / probabilidad / esfuerzo:** **Alta / Alta con tenants grandes / M**.
- **Dependencias o riesgos de solución:** definir qué representa un ítem cuando un componente produce varios assets; índices para filtros JSONB; compatibilidad del orden y conteo con la UI actual.
- **Recomendación concreta:** mover joins, filtros, orden, conteo y paginación a SQL/RPC o vista tenant-aware. Preferir cursor estable `(generated_at,id)` para navegación profunda, seleccionar solo campos requeridos y medir el plan con datos representativos. Mantener el límite de `pageSize`, no un límite oculto sobre el universo.
- **Criterios de aceptación:** más de 1.000 componentes siguen siendo localizables; `total` coincide con DB; una página requiere O(pageSize), no O(total); plan de consulta usa índices; pruebas cubren fronteras 999/1.000/1.001, filtros combinados y aislamiento tenant.

### TD-22 — Contratos API y manejo de errores no están normalizados

- **Categoría / clasificación:** API, validación, manejo de errores — **hecho comprobado**.
- **Descripción:** conviven rutas con schemas Zod y errores tipados con rutas que hacen cast directo del JSON a interfaces TypeScript, validan solo presencia y devuelven mensajes internos de excepciones. `save-draft` acepta un objeto `PublicationDraftData` sin validación runtime y expone `getErrorMessage(error)` como 500; `publish` acepta un cast, importa una Server Action desde UI y devuelve el mensaje del proveedor/DB. Otros endpoints modernos sí distinguen 400/401/403/409/413/415/429/502, demostrando que existe un patrón mejor pero no uniforme.
- **Evidencia:** `apps/web/src/app/api/save-draft/route.ts:13-24,47-95`; `apps/web/src/app/api/publish/route.ts:4,15-29,118-121,147-156`; contraste de validación y códigos en `apps/web/src/app/api/production/assembly-branding/route.ts:9-12,23-66,70-85`.
- **Impacto técnico y de negocio:** payloads mal formados pueden llegar a persistencia; los clientes no pueden clasificar fallos de forma estable; mensajes de DB/proveedor pueden filtrar implementación; los cambios de contrato tienen mayor radio de impacto y son difíciles de probar.
- **Severidad / probabilidad / esfuerzo:** **Media / Alta / M**.
- **Dependencias o riesgos de solución:** inventariar consumidores actuales; preservar mensajes de UX; versionar cambios incompatibles; alinear errores de proveedores sin ocultar diagnósticos en logs.
- **Recomendación concreta:** crear un borde API compartido con schemas de entrada/salida, un envelope de error `{code,message,retryable,requestId,details?}`, mapeo central de errores y límites de body. Los casos de uso no deben depender de `NextResponse` ni de Server Actions.
- **Criterios de aceptación:** toda ruta pública tiene schema runtime y contrato documentado/probado; datos inválidos nunca producen 500; errores internos no salen al cliente; 401/403/404/409/413/429/5xx son consistentes; tests de contrato detectan breaking changes.

### TD-23 — Política web global incompleta y origen comodín para Server Actions

- **Categoría / clasificación:** Seguridad web, configuración — **hecho comprobado en repo; explotabilidad es indicio**.
- **Descripción:** la configuración global solo añade `Cross-Origin-Opener-Policy`. No define CSP, HSTS, `X-Content-Type-Options`, política de referrer ni permisos. Además permite Server Actions desde `*.netlify.app`, lo que amplía el conjunto de orígenes confiables a dominios de preview o sitios bajo ese sufijo. Esto puede ser intencional para previews, pero no está acotado por entorno ni documentado.
- **Evidencia:** `apps/web/next.config.ts:11-15` (`allowedOrigins`) y `:17-30` (única cabecera global). El riesgo de XSS que incrementa el valor de CSP está documentado en TD-04.
- **Impacto técnico y de negocio:** menor defensa en profundidad frente a XSS, framing/MIME confusion y exfiltración; previews comprometidos o mal administrados amplían la frontera de confianza. HSTS podría estar configurado en Netlify, pero no es verificable desde Git.
- **Severidad / probabilidad / esfuerzo:** **Media / Media / S-M**.
- **Dependencias o riesgos de solución:** una CSP estricta debe contemplar Google, Supabase, Gamma, HeyGen, HyperFrames, blobs/workers y estilos actuales; HSTS requiere confirmar HTTPS en todos los subdominios; los previews necesitan una estrategia explícita.
- **Recomendación concreta:** separar orígenes por entorno y enumerar previews autorizados; establecer cabeceras en una política central comprobable; desplegar CSP primero en `Report-Only`, eliminar inline/eval por inventario y promoverla gradualmente.
- **Criterios de aceptación:** producción no acepta un comodín de proveedor de hosting; headers efectivos se prueban desde el deployment; CSP no presenta violaciones necesarias durante flujos E2E; pruebas negativas cubren origen no autorizado y framing.

### TD-24 — Integraciones externas sin presupuesto uniforme de timeout, retry y backpressure

- **Categoría / clasificación:** Integraciones, confiabilidad, rendimiento — **hecho comprobado parcial; impacto sistémico es indicio**.
- **Descripción:** el inventario actual contiene llamadas directas a `fetch` en 42 archivos y defensas reconocibles de cancelación/deadline en 32; no es equivalencia uno-a-uno, pero confirma que la adopción aún no es universal. La primera mitigación cubrió OneDrive y el encadenamiento de materiales. La ampliación actual centraliza deadlines de 15 s para APIs y 60 s para descargas en OneDrive, Google Drive, Artlist y OAuth; Google Drive/Artlist ya no materializan respuestas ilimitadas y rechazan archivos mayores a 150 MB. No se añadieron retries a mutaciones como creación de carpetas porque carecen de idempotency key.
- **Evidencia:** política común `apps/web/src/lib/server/outbound-http.ts:1-24`; Google Drive `apps/web/src/domains/production/providers/google-drive.service.ts:30-73,138-184,224-323,361-421`; Artlist `apps/web/src/domains/production/providers/artlist.service.ts:1-20,155-163,220-258,295-317`; OneDrive `apps/web/src/domains/production/cloud-storage/microsoft-graph.service.ts:25-38,264-284`; OAuth Google/Microsoft `apps/web/src/app/api/auth/google/callback/route.ts:5-72` y `apps/web/src/app/api/auth/microsoft/callback/route.ts:3-70`; regresión `apps/web/src/lib/server/__tests__/outbound-http.test.ts` y `apps/web/src/lib/server/__tests__/privileged-background-inventory.test.ts`.
- **Impacto técnico y de negocio:** workers o requests pueden quedar ocupados hasta el timeout de infraestructura, acumular memoria y amplificar fallos de proveedores; a 100×/1.000× aumenta el riesgo de agotamiento de concurrencia, tormentas de reintentos y costes sin control.
- **Severidad / probabilidad / esfuerzo:** **Alta / Media-Alta / M-L**.
- **Dependencias o riesgos de solución:** definir semántica idempotente antes de reintentar mutaciones; respetar límites y `Retry-After` de cada proveedor; evitar timeouts más cortos que operaciones válidas; compatibilidad de streaming con Storage.
- **Recomendación concreta:** un cliente por proveedor con deadline total, timeout por fase, retry con jitter solo para operaciones seguras/idempotentes, circuit breaker, límites de concurrencia, streaming y cuotas tenant. Propagar cancelación y correlation ID a jobs y subllamadas.
- **Criterios de aceptación:** toda salida de red tiene deadline explícito; tests simulan 429, 5xx, conexión colgada y respuesta grande; no se reintentan mutaciones sin idempotency key; concurrencia máxima y memoria quedan acotadas; métricas muestran latencia, retry y error por proveedor. **Avance verificable:** deadline colgado/cancelación del caller, límites de descarga y guardia estática están cubiertos; 429/5xx, retry, concurrencia y métricas siguen pendientes.

### TD-25 — El tipado se erosiona en los dos núcleos de mayor complejidad

- **Categoría / clasificación:** Tipado, mantenibilidad, corrección — **hecho comprobado**.
- **Descripción:** aunque `strict` pasa, se detectaron 194 usos del patrón `: any`, `as any`, `<any>` o `Record<string, any>` en web/functions. La concentración no es accidental: el control plane de workers usa `any` para jobs, workers, previews y builds; el estado de assets usa casts repetidos y hasta fuerza estados de producción. Esto elimina precisamente las garantías que deberían proteger máquinas de estado y payloads persistidos.
- **Evidencia:** contrato de persistencia derivado de la referencia actual `apps/web/src/lib/server/desktop-worker-db.types.ts`; consumo tipado y normalización de filas en `apps/web/src/lib/server/desktop-worker-control-plane.ts`; reglas puras en `apps/web/src/lib/server/desktop-worker-job-contracts.ts`; pruebas en `apps/web/src/lib/server/__tests__/desktop-worker-job-contracts.test.ts`; contrato de assets en `apps/web/src/domains/materials/validators/assets.validators.ts` y `apps/web/src/domains/materials/types/materials.types.ts`. La definición verificada de tablas fue `supabase/migrations/BD.sql:349-402,475-516,530-574,656-715,739-781,783-835` y se usó solo como lectura.
- **Impacto técnico y de negocio:** renombrar un campo o añadir un estado puede compilar y fallar en runtime; aumenta la probabilidad de transiciones imposibles, assets incompatibles y errores tardíos en renders costosos. El type-check verde ofrece una confianza superior a la garantía real.
- **Severidad / probabilidad / esfuerzo:** **Media-Alta / Alta / L**.
- **Dependencias o riesgos de solución:** schemas DB generados, compatibilidad con JSONB legacy, contratos de Google Picker y proveedores, y secuencia con la descomposición de TD-10.
- **Recomendación concreta:** definir tipos discriminados para jobs/assets/estados, generar tipos Supabase, validar JSONB en fronteras con Zod y sustituir `any` por `unknown` + narrowers. Priorizar campos que controlan estado, autorización, coste y persistencia; no perseguir un objetivo cosmético de cero casts.
- **Criterios de aceptación:** ningún `any` en contratos de job/assets críticos salvo excepción documentada; schemas runtime y tipos comparten fuente; tests de estados inválidos; presupuesto decreciente de `any` en CI; cambios de campos críticos rompen compilación o validación antes de persistir.

**Avance de remediación (2026-09-09):** se eliminaron los `any` de `useProductionAssetState`, `ProductionAssetHeader`, la UI estructurada de assets y los contratos de Artlist/Google Picker. `MaterialAssets` y su schema ahora coinciden en eliminaciones explícitas mediante `null`, fuente `hyperframes_cloud`, contrato de duración, DoD y metadata de preparación de slides. Siete casos verifican discriminación de payloads externos, IDs del Picker, estados imposibles, campos vigentes y borrado nullable.

En el segundo bloque, las reglas puras de jobs se extrajeron a `apps/web/src/lib/server/desktop-worker-job-contracts.ts`: asignación obsoleta, autorización tenant/provider/worker, contrato de duración, composition ID, props y resolución del bundle ya reciben `unknown` y estrechan el dato antes de usarlo. Cuatro pruebas cubren heartbeats ausentes o inválidos, estados y ownership, snapshots malformados, HTTPS, hashes deterministas y duración. Los usos de `any` del control plane bajaron de 47 puntos documentados al inicio de este bloque a 29; siguen concentrados en filas Supabase de workers, builds, previews, telemetría y callbacks de finalización.

En el tercer bloque, `production_jobs`, `remotion_template_builds`, `remotion_template_previews`, `render_workers`, `render_worker_job_runs` y sus proyecciones relacionadas recibieron contratos explícitos basados en `BD.sql`. La normalización del límite Supabase descarta valores no-fila antes de mapearlos, y una quinta prueba cubre esa defensa. Los 29 `any` restantes de persistencia y callbacks se eliminaron. El tipado también comprobó un defecto real: `startTemplateBuild` no seleccionaba `remotion_template_versions.entry_point`, aunque el bundler lo consumía; la proyección ya lo incluye, evitando sustituir entrypoints personalizados por `src/index.tsx`. Quedan dos `any` locales asociados a assets de ensamblado, fuera de este subbloque, y aún no existe una fuente generada que detecte drift entre Postgres y TypeScript automáticamente.

En el cuarto bloque se eliminaron esos dos últimos `any`. El JSONB de `material_components.assets` ahora atraviesa `materialAssetsSchema` antes de llegar al normalizador Remotion; documentos incompatibles fallan con `MATERIAL_ASSETS_INVALID_FOR_DESKTOP_RENDER` sin incluir el payload en el error. Una prueba cubre documentos válidos, estados imposibles y valores que no son objetos, y la guardia estática incluye ya todo `desktop-worker-control-plane.ts`. Con ello, el control plane pasó de 47 puntos `any` a cero sin modificar `BD.sql`. El riesgo residual de TD-25 es el drift manual entre los contratos TypeScript de persistencia y el esquema PostgreSQL, no una frontera crítica actualmente sin tipar.

## Mejoras rápidas de bajo riesgo

1. Corregir `lint`, añadir `typecheck` y un `verify` agregador; después retirar `ignoreBuildErrors` una vez que CI esté activo.
2. Eliminar logging de fragmentos de claves y emails; añadir redacción básica al logger.
3. Hacer obligatorio `SUPABASE_SERVICE_ROLE_KEY` en helpers administrativos.
4. Proteger inmediatamente `/api/lia` y las cinco funciones privilegiadas con auth/firma antes de refactors mayores.
5. Conectar los ocho tests huérfanos al runner; resolver alias para `hyperframes-render-submission.service.test.ts`.
6. Añadir límite de request y timeout a SCORM e importación externa como mitigación provisional.
7. Marcar o retirar `/api/test` y `/api/test-publish` de producción; el segundo está autenticado, pero expone payloads completos y no debería ser una API estable.
8. Añadir check estático que impida `.update({ assets:` fuera del repositorio aprobado.
9. Añadir cabeceras de seguridad faltantes mediante política central; actualmente la configuración global solo define COOP.
10. Añadir timeout explícito a Microsoft Graph y al encadenamiento de jobs de materiales; limitar descargas antes de materializar buffers.
11. Validar `save-draft`/`publish` con Zod y dejar de devolver mensajes internos como respuesta 500.

## Problemas estructurales

Los quick wins no sustituyen cuatro líneas de trabajo estructural:

1. **Unificar límites de confianza.** Toda entrada HTTP/background debe recorrer identidad → tenant → permiso → validación → idempotencia antes de usar service role o llamar proveedores.
2. **Separar transporte de casos de uso.** Rutas, Server Actions, Netlify Functions y Edge Functions deben ser adaptadores delgados sobre servicios application compartidos; no deben importarse entre sí.
3. **Definir una autoridad de estado de producción.** Assets, jobs, renders, publicación y estados del pipeline requieren repositorios transaccionales, versionado optimista y reconciliación.
4. **Estabilizar el esquema.** Una baseline reproducible y tests RLS son prerequisito para evolucionar multi-tenancy con seguridad.
5. **Diseñar para crecimiento medible.** Paginación y filtros deben ejecutarse en DB; toda I/O externa necesita deadlines, cuotas, backpressure y métricas antes de afirmar capacidad de 100.000 concurrentes.

## Matriz de prioridad

| ID | Hallazgo | Impacto | Riesgo/probabilidad | Esfuerzo | Prioridad |
|---|---|---:|---:|---:|---:|
| TD-01 | Background jobs privilegiados sin firma | 5 | 5 | 2 | P0 |
| TD-02 | Lia anónima y sin límites | 5 | 5 | 1-2 | P0 |
| TD-03 | SSRF/importación sin límite efectivo | 5 | 4 | 2 | P0 |
| TD-05 | Storage público/cross-tenant | 5 | 4 | 2 | P0 |
| TD-04 | HTML no sanitizado | 5 | 3 | 1-2 | P1 |
| TD-06 | Migraciones con versiones duplicadas | 5 | 4 | 3 | P1 |
| TD-07 | Pérdida concurrente de assets | 5 | 4 | 3 | P1 |
| TD-08 | Quality gates rotos | 4 | 5 | 1-2 | P1 |
| TD-09 | Registro/login divergentes | 4 | 4 | 3 | P1 |
| TD-11 | SCORM síncrono/no acotado | 4 | 4 | 3 | P1 |
| TD-13 | Cobertura crítica insuficiente | 4 | 5 | 3 | P1 |
| TD-19 | Auth mock desplegable | 5* | ? | 1 | P1 tras verificar exposición |
| TD-21 | Biblioteca trunca antes de paginar | 4 | 4 | 2 | P1 |
| TD-24 | I/O externa sin resiliencia uniforme | 4 | 4 | 3 | P1 |
| TD-10 | God objects | 4 | 5 | 4 | P2 |
| TD-12 | Ciclos e inversión de capas | 3 | 3 | 3 | P2 |
| TD-15 | Observabilidad fragmentada | 4 | 4 | 3 | P2 |
| TD-16 | Fallback service-role→anon | 3 | 3 | 1 | P2 |
| TD-17 | Publicación desincronizable | 4 | 3 | 2 | P2 |
| TD-14 | Duplicación por rutas/roles | 3 | 4 | 3 | P2 |
| TD-22 | Contratos API inconsistentes | 3 | 4 | 2 | P2 |
| TD-23 | Headers/orígenes globales débiles | 3 | 3 | 1-2 | P2 |
| TD-25 | `any` en estados/jobs críticos | 4 | 4 | 3 | P2 |
| TD-18 | Dependencias inconsistentes | 3 | 3 | 2 | P3 |
| TD-20 | Documentación/datos históricos | 2-4 | 4 | 1-2 | P3 |

Escala: 1 bajo, 5 máximo. El asterisco depende de que la API legado esté accesible.

## Plan de remediación

### Corto plazo: 0-30 días

- Cerrar TD-01, TD-02, TD-03 y TD-05 con mitigaciones desplegables y pruebas negativas.
- Verificar exposición real de `apps/api`; deshabilitar auth mock de inmediato si existe despliegue.
- Sanitizar `body_html` y añadir CSP inicial.
- Reparar quality gates y ejecutar `verify` en CI.
- Hacer fail-fast de variables privilegiadas.
- Poner límites provisionales a SCORM; registrar métricas de tamaño y tiempo.
- Añadir pruebas de autorización de funciones/rutas y RLS Storage.
- Corregir contratos de `save-draft`/`publish`, restringir `allowedOrigins` por entorno y desplegar headers en modo verificable.

### Mediano plazo: 1-3 meses

- Auditar y reconciliar historial de migraciones; bootstrap limpio en CI.
- Migrar todas las escrituras de `assets` a repositorios atómicos/versionados.
- Implementar outbox/reconciliación de publicación.
- Resolver autoridad de identidad y cerrar flujo registro→tenant.
- Introducir logging estructurado, correlation IDs y alertas.
- Extraer casos de uso para eliminar importaciones route↔domain y los tres ciclos.
- Convertir SCORM a pipeline asíncrono seguro.
- Sustituir la búsqueda de biblioteca por consulta paginada en DB y crear índices desde planes medidos.
- Estandarizar clientes de integración con deadlines, retry idempotente, límites de tamaño/concurrencia y métricas.

### Largo plazo: 3-9 meses

- Descomponer control plane, HeyGen studio y composition editor mediante bounded contexts y stores/controladores explícitos.
- Retirar rutas legacy después de medir tráfico y completar redirects.
- Establecer contratos de integración simulables para Gemini, SofLIA, HeyGen, HyperFrames y Storage.
- Añadir SLOs de generación/publicación, pruebas E2E de los seis pasos y pruebas de recuperación ante fallos.
- Consolidar documentación viva, ADRs y política de dependencias/datos.
- Completar tipos discriminados y schemas runtime para jobs/assets mientras se descomponen los god objects.
- Ejecutar pruebas de carga 10×/100×/1.000× y capacity planning; no fijar una cifra de concurrencia sin SLOs y evidencia.

## Aspectos que requieren investigación adicional

1. Confirmar qué Netlify Functions son públicamente accesibles y si Netlify añade una protección no visible en repo.
2. Exportar políticas RLS/Storage reales y compararlas con las 155 migraciones; no asumir que producción coincide con Git.
3. Ejecutar `supabase db reset`, `db lint` y tests SQL en un entorno aislado para medir el efecto de versiones duplicadas y dumps.
4. Confirmar si Courseforge y SofLIA usan proyectos Supabase distintos; esto determina el impacto exacto de TD-09.
5. Revisar DNS/Cloud Run/Artifact Registry y logs para saber si `apps/api` está desplegada o recibe tráfico.
6. Clasificar `supabase/data/*.csv`, `reportes/`, `items/` y `custom-bundles/`: fixture, evidencia, dato real o artefacto generado.
7. Medir concurrencia real sobre `material_components.assets` y buscar pérdidas históricas mediante `updated_at`, jobs y eventos.
8. Hacer threat model del contenido generado: fuentes curadas, prompts, edición manual, HTML de slides y render headless.
9. Medir tiempos, memoria y costes de SCORM/importaciones/IA con cargas representativas.
10. Ejecutar Deno tests y pruebas locales de Edge Functions cuando el runtime esté disponible.
11. Obtener `EXPLAIN (ANALYZE, BUFFERS)` de biblioteca, dashboards y claims de workers con cardinalidades reales; las migraciones contienen 140 índices, pero su suficiencia no puede inferirse por conteo.
12. Inventariar timeouts/retries/idempotency keys por llamada externa y límites efectivos de Netlify/Cloud Run/Supabase.
13. Verificar cabeceras, CORS y Server Actions en los deployments reales, incluidos previews; CDN/Netlify puede añadir controles ausentes del repo.
14. Definir SLOs, volumen objetivo y mezcla de tráfico antes de certificar escalabilidad a 100.000 usuarios concurrentes.

## Áreas revisadas sin problemas relevantes encontrados

- **Lockfile:** `npm audit` no reportó vulnerabilidades conocidas al 2026-09-08. Esto no sustituye revisión de configuración ni amenazas de aplicación.
- **TypeScript:** `strict`, `noUnusedLocals` y `noUnusedParameters` están habilitados y el type-check manual pasó.
- **Build:** con red disponible, Next.js compiló y generó las 93 páginas/rutas previstas; no se observó error de compilación.
- **Suites declaradas:** los 16 scripts `test:*` ejecutados aprobaron.
- **Webhooks/Edge recientes:** `heygen-hyperframes-webhook` limita body, valida timestamp y HMAC; reconciliación/importación usan una clave de worker con comparación temporalmente constante (`supabase/functions/_shared/http.ts:14-38`).
- **Descarga HyperFrames reciente:** usa allowlist HTTPS, bloquea redirects, limita tamaño y descarga por rangos.
- **Video metadata:** restringe hosts a YouTube/Vimeo (`apps/web/src/app/api/video-metadata/route.ts:4-29`).
- **Autorización de producción moderna:** numerosas rutas HyperFrames/HeyGen aplican helper tenant-aware y validación Zod; no se observó un bypass general en ese subconjunto.
- **Idempotencia reciente:** slides, jobs de producción y renders HyperFrames incluyen claves de idempotencia/leases y mecanismos de recuperación.
- **Secretos locales:** `.env` está ignorado y no aparece versionado.
- **Duplicación global:** 1,14% no indica código espagueti generalizado; el problema está localizado y se documentó sin convertir toda similitud en deuda.

## Conclusión

Courseforge no necesita una reescritura. Necesita primero cerrar límites de confianza y asegurar la reproducibilidad del esquema; después, consolidar los casos de uso que hoy están repartidos entre rutas, actions y jobs. La estrategia de menor riesgo es proteger y caracterizar antes de extraer. Las piezas recientes de HyperFrames/HeyGen ya muestran el patrón objetivo —firmas, allowlists, leases, idempotencia, logging estructurado y tests— y pueden servir como referencia interna, sin asumir que todas sus decisiones aplican automáticamente al pipeline educativo.
