# Fuente de verdad: documento, medios y render de composiciones HyperFrames

Estado: **vigente; correccion P0 implementada, migracion de integridad pendiente de despliegue**  
Ultima revision tecnica: 2026-09-04  
Responsables: Production Engineering, Platform y QA  
Alcance: editor nativo, documento versionado, previews, snapshots ZIP, entrega de medios y HyperFrames Cloud.

## 1. Regla de mantenimiento

Este archivo es la fuente de verdad operativa del flujo de composicion y render
HyperFrames de Courseforge. Todo cambio que afecte documento, assets, preview,
snapshot, ZIP, variables, envio a HeyGen, polling, importacion o SFX debe:

1. actualizar primero el contrato o decision correspondiente en este archivo;
2. enlazar migracion, servicio y prueba que constituyen la evidencia;
3. agregar una entrada al historial de cambios;
4. ejecutar `npm run test:hyperframes --workspace=apps/web` y las pruebas E2E
   proporcionales;
5. seguir `docs/compliance/protocolo-actualizacion-heygen-hyperframes.md` si
   cambia HyperFrames, HeyGen, credenciales, webhooks o el artefacto enviado.

El codigo y las migraciones prevalecen si este documento queda desactualizado;
esa discrepancia es un defecto documental y debe corregirse en el mismo cambio.

## 2. Resumen del incidente SFX

### Sintoma

Al agregar un efecto de transicion, el enlace entre asset y borrador se crea,
pero `PUT /api/production/hyperframes/drafts/:draftId/document` responde `500`.
La solicitud contiene precondiciones validas y coincidentes en `If-Match` y
`X-Composition-Version`; por ello no corresponde al flujo esperado de conflicto
`409`, precondicion `428` ni validacion `400`.

### Causa raiz con alta confianza

`assertAddedAssetsBelongToDraft` consulta desde la tabla de enlace hacia
`sound_effect_assets`, una relacion muchos-a-uno, y trata la relacion embebida
como arreglo:

```ts
row.sound_effect_assets?.some((asset) => asset.status === "READY")
```

PostgREST devuelve el extremo "to-one" como objeto o `null`, no como arreglo.
Por ello, cuando existe el enlace, `.some` no es una funcion y se produce una
excepcion inesperada. La ruta la normaliza como `500` generico. El mismo patron
esta duplicado en la resolucion de assets del preview, por lo que corregir solo
el guardado dejaria una segunda falla inmediata.

Evidencia primaria:

- `apps/web/src/domains/production/composition-editor/composition-document.service.ts`
- `apps/web/src/domains/production/composition-editor/composition-preview-assets.service.ts`
- [Supabase: joins y cardinalidad de relaciones](https://supabase.com/docs/guides/database/joins-and-nesting)
- [PostgREST: many-to-one se representa como objeto](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html)

### Punto exacto del flujo

La falla sucede antes de aplicar el patch, persistir una nueva version, crear el
snapshot, construir el ZIP o llamar a HeyGen. El ZIP y HyperFrames Cloud no son
la causa de este `500`, aunque fueron auditados porque constituyen los pasos
posteriores del mismo caso de uso.

## 3. Flujo canonico de extremo a extremo

```text
Biblioteca SFX privada por organizacion
  -> POST /api/production/sound-effects (vincula asset READY al draft)
  -> PUT /hyperframes/drafts/:id/document (clip.add + control If-Match)
  -> documento courseforge-composition-v2 versionado por hash
  -> preview: valida enlaces, firma URLs cortas y compila HTML interactivo
  -> snapshot: resuelve identidades inmutables y compila HTML de render
  -> ZIP inmutable: HTML + GSAP + documento + manifiesto
  -> envio: firma medios, materializa src en una copia desechable del ZIP
  -> direct upload de HeyGen + POST /v3/hyperframes/renders
  -> webhook firmado y reconciliacion durable
  -> importacion reanudable del video final a Storage
```

Ninguna URL firmada forma parte del snapshot inmutable. Se genera justo antes
del envio y se incorpora solamente a la copia desechable que recibe HeyGen.

## 4. Contrato del documento editable

- Formato canonico: `courseforge-composition-v2`.
- Concurrencia: hash SHA-256 estable, enviado como ETag fuerte en `If-Match`.
- Persistencia: cada cambio agrega una version; no muta versiones anteriores.
- SFX: clip `kind: AUDIO`, pista `semanticRole: SFX` y fuente
  `SOUND_EFFECT_ASSET` con UUID del catalogo.
- El documento conserva identidad, timing, offset, duracion y volumen de la
  instancia; no conserva rutas de Storage ni URLs.
- Un mismo asset puede producir varias instancias con ids de clip distintos.
- Los intervalos superpuestos se empaquetan en lanes y reciben indices de track
  HyperFrames independientes.
- Un clip no puede exceder el canvas. Al insertar cerca del final, la UI recorta
  la instancia al tiempo restante; esta decision debe ser visible al usuario.
- SFX no activa ducking de musica por defecto. Voz/avatar siguen siendo los
  triggers y musica el destino.

## 5. Contrato de autorizacion y tenancy

Antes de admitir un UUID en el documento se deben comprobar por separado:

1. borrador activo y perteneciente a `organizationId`;
2. enlace borrador-SFX de esa organizacion;
3. asset SFX de esa organizacion y estado `READY`.

No se debe depender de la forma dinamica de una relacion embebida de PostgREST
para una decision de autorizacion. El helper compartido debe devolver un
`Set<string>` tipado de ids autorizados o un error de dominio seguro.

La base debe reforzar el mismo invariante con FKs compuestas que incluyan
`organization_id`; RLS por si sola no evita inconsistencias introducidas por
service role, SQL manual o un bug del backend.

## 6. Contrato del preview

- Resuelve solo assets vinculados al borrador y permitidos para la organizacion.
- Los SFX nuevos deben estar `READY`; los snapshots historicos pueden conservar
  assets archivados si su identidad inmutable ya fue congelada.
- Las URLs de preview tienen TTL corto y nunca se registran en logs o tablas.
- Preview y render se compilan desde el mismo documento y las mismas reglas de
  timing, lanes, offset y volumen.
- El navegador puede requerir gesto para desbloquear audio; esto es un estado de
  UX, no una falla del asset.
- Errores de enlace, firma o media deben producir codigo de dominio y
  `diagnosticId`, no un `500` opaco.

## 7. Contrato del snapshot y ZIP

El snapshot actual usa `REMOTE_VARIABLES`. Su ZIP contiene:

- `index.html`;
- `assets/gsap.min.js`;
- `composition-document.json`;
- `asset-manifest.json`.

Los binarios de video/audio no se copian al ZIP. El manifiesto fija por asset:
UUID, checksum, MIME, tamano, bucket y path. El ZIP se comprime con DEFLATE, se
hashea y se guarda en una ruta content-addressed.

Antes de congelarlo se debe validar:

- todos los UUID referenciados estan enlazados y resolubles;
- checksum SHA-256, MIME, tamano, bucket y path son validos;
- cada `<audio>` tiene `id`, `src` o binding resoluble, `data-start`,
  `data-duration`, `data-track-index` y `data-volume` finitos;
- entry point presente y archive menor de 200 MB;
- documento, manifiesto y revision declaran la misma version de binding.

Brecha vigente: revision, enlaces de assets y activacion se escriben en varias
operaciones sin una transaccion unica. Una falla intermedia puede dejar un ZIP
o revision huerfanos o una revision parcialmente enlazada.

## 8. Contrato de entrega a HeyGen/HyperFrames Cloud

Courseforge sigue el flujo oficial: comprimir, direct upload, crear render y
consultar el estado. La documentacion oficial fija un maximo de 200 MB para el
archivo, recomienda `--dry-run` para inspeccion y exige idempotencia para no
duplicar uploads o cobros. Referencias:

- [HyperFrames Cloud: flujo, limite e idempotencia](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/cloud.md)
- [CLI oficial: cloud render](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/cli.mdx)
- [Contrato oficial de variables y medios](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-core/references/variables-and-media.md)
- [Pipeline oficial de render y mezcla](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/producer.mdx)

HyperFrames extrae audio desde el `src` escrito en el HTML. Por eso
`materializeHyperframesRenderMedia` debe reemplazar cada binding `cf_asset_*`
por una URL HTTPS firmada antes del upload, conservar el binding declarativo y
rechazar cualquier audio sin `id` o `src`.

Las URLs firmadas son credenciales temporales: no deben aparecer en logs,
diagnosticos, manifiestos persistidos ni descargas de soporte. El hash y tamano
del ZIP preparado para HeyGen deben registrarse como metadatos no sensibles,
separados del hash del snapshot original.

Version verificada en Courseforge: `@hyperframes/studio` y
`@hyperframes/studio-server` 0.7.106. Upstream publico ya presenta versiones
posteriores con correcciones de audio. No actualizar sin ejecutar el protocolo
de cumplimiento, pruebas de contrato y comparacion de render.

## 9. Hallazgos y prioridad

| Prioridad | Hallazgo | Impacto | Estado |
| --- | --- | --- | --- |
| P0 | Cardinalidad PostgREST tratada como arreglo en guardado SFX | Bloqueaba insertar cualquier SFX y devolvia 500 | Corregido y cubierto |
| P0 | El mismo patron existia en assets de preview | El preview fallaba despues del guardado | Corregido y cubierto |
| P1 | La suite HyperFrames no tenia pruebas SFX | La regresion no era detectable | Cobertura inicial agregada; faltan snapshot E2E e ingestion |
| P1 | Errores inesperados antes del RPC carecian de diagnostico estructurado | Soporte solo veia un 500 generico | Corregido para PUT con etapa y diagnosticId |
| P1 | Snapshot y enlaces de revision no finalizan transaccionalmente | Revision parcial y reintentos ambiguos | Confirmado, pendiente |
| P1 | `organization_id` de tablas de enlace no esta reforzado por FK compuesta | Riesgo de inconsistencia multi-tenant con service role | Confirmado, pendiente |
| P1 | Tabla SFX de revision no persiste `source_storage_bucket` | Procedencia incompleta y bucket hardcodeado al renderizar | Migracion y codigo listos; pendiente despliegue |
| P2 | Comentario promete inmutabilidad READY, pero la BD permite UPDATE | Un binario historico puede cambiar sin nueva identidad | Trigger listo; pendiente despliegue |
| P2 | Bucket acepta mas codecs que el ingestion actual | Contrato operacional ambiguo; la UI solo valida WAV RIFF | Confirmado, pendiente |
| P2 | Parser WAV solo calcula duracion por byte rate | Inspeccion insuficiente para archivos hostiles/corruptos | Confirmado, pendiente |
| P2 | No se registra hash/tamano del ZIP materializado | Diagnostico incompleto de lo realmente enviado | Confirmado, pendiente |
| P2 | Dependencias 0.7.106 por detras del upstream auditado | Se omiten correcciones posteriores de audio | Requiere evaluacion |

## 10. Casos de uso obligatorios

| Caso | Resultado esperado |
| --- | --- |
| Agregar primer SFX READY | Enlace idempotente, version nueva y preview audible |
| Reutilizar el mismo SFX | Varias instancias, un asset en manifiesto, ids de clip unicos |
| Dos SFX simultaneos | Lanes/track-index distintos, ambos presentes en mezcla |
| Insertar junto al final | Recorte explicito o bloqueo comprensible; nunca duracion cero |
| Mover, recortar, dividir, borrar y deshacer | Documento valido y asset fuente inmutable |
| Recargar editor | Misma version, posiciones y mezcla |
| ETag obsoleto | `409` recuperable, sin perder la edicion local |
| Asset no enlazado/no READY/de otra empresa | Rechazo `4xx`, sin revelar existencia |
| URL de preview expirada | Renovacion controlada, sin mutar documento |
| Archivar asset ya usado | No disponible para inserciones nuevas; snapshot historico reproducible |
| Restaurar snapshot con SFX | Nueva version editable, identidad historica preservada |
| Crear snapshot y ZIP | Manifiesto completo, HTML valido, hash estable |
| Reintentar upload/render | Misma idempotency key, sin doble cobro ni doble job |
| Render lento mayor al TTL | Renovacion antes de submit o error recuperable antes del cobro |
| Webhook ausente/duplicado | Reconciliacion durable e idempotente |
| Cancelar en upload/render/importacion | Estado terminal coherente y sin publicacion parcial |

## 11. Plan de implementacion aprobado para experimentacion

### Fase 0 — Contencion y evidencia

- Invalidar la sesion cuyo token fue compartido durante el diagnostico.
- Capturar el stack local del 500 sin registrar cookies, JWT ni URLs firmadas.
- Añadir `diagnosticId` y etapa (`authorize`, `asset-link-validation`, `patch`,
  `append-rpc`) a fallas del PUT.

Salida: incidente reproducible y observable sin datos sensibles.

### Fase 1 — Correccion P0 compartida

- Crear un servicio/repositorio unico para validar ids de assets enlazados.
- Consultar enlaces y assets READY con contratos tipados separados; no usar
  `.some()` sobre relaciones embebidas.
- Reutilizarlo en guardado y preview.
- Mapear ausencia/no READY a `409` o `422`, y dependencia fallida a `503`.

Salida: insercion y preview SFX funcionales sin debilitar tenancy.

### Fase 2 — Cobertura de contrato SFX

- Unit tests de upload WAV, dedupe, tags, enlace y autorizacion.
- Tests de documento para `clip.add`, restore/reconcile, ETag y UUID arbitrario.
- Tests de preview para READY, archivado, otra organizacion y URL expirada.
- Tests de compilador para audio simple, repetido, solapado, recortado y oculto.
- Tests de snapshot/materializacion para manifiesto deduplicado y todos los
  atributos `<audio>` requeridos.
- Route integration test que reproduzca el PUT observado.

Salida: el fallo actual rompe una prueba antes del fix y pasa despues.

### Fase 3 — Integridad de datos e ingestion

- Migracion aditiva con FKs compuestas `(id, organization_id)` para draft,
  asset y revision.
- Persistir `source_storage_bucket` en enlaces SFX de revision.
- Hacer inmutable la identidad binaria de un asset READY; reemplazar crea otro
  asset/version.
- Alinear allowlist del bucket con la ingesta real. Mantener WAV en el piloto o
  agregar inspeccion/transcodificacion server-side antes de aceptar otros codecs.
- Validar RIFF completo, codec, canales, sample rate, bits, duracion y checksum.

Salida: invariantes multi-tenant y de reproducibilidad garantizados en BD.

### Fase 4 — Snapshot transaccional y diagnostico ZIP

- Mover alta de revision, enlaces y activacion a un RPC transaccional e
  idempotente; conservar el upload content-addressed fuera de la transaccion.
- Implementar reconciliacion/limpieza acotada de objetos huerfanos.
- Crear un inspector interno que, sin exponer URLs firmadas, reporte archivos,
  entry point, hashes, tamanos, bindings, audios y errores de contrato.
- Registrar hash/tamano del ZIP materializado y version exacta del renderer.

Salida: ninguna revision parcialmente activa y evidencia de lo enviado.

### Fase 5 — Certificacion HeyGen

- Ejecutar `hyperframes check` sobre una reproduccion local exportada del ZIP.
- Inspeccionar archive equivalente a `cloud render --dry-run --json`.
- Render de matriz: SFX solo; voz+SFX; musica+voz+SFX; SFX solapados; inicio,
  corte y final; 24/30/60 fps; retries y cancelacion.
- Comparar preview contra video final por tiempo, presencia y ganancia de audio.
- Evaluar upgrade 0.7.106 -> version objetivo en branch aislado, aplicando
  cumplimiento y pruebas de regresion antes de decidir.

Salida: evidencia E2E de Courseforge -> HeyGen -> importacion.

### Fase 6 — Rollout controlado

- Feature flag por organizacion y catalogo piloto.
- Telemetria agregada: exito/falla por etapa, latencias, previews fallidos,
  renders con SFX y discrepancias de manifiesto; nunca nombres o URLs firmadas.
- Activar primero en una organizacion interna y ampliar solo con cero P0/P1.

## 12. Definition of Done

- El PUT observado responde exitosamente o con error de dominio accionable.
- No queda ningun uso de la cardinalidad embebida incorrecta.
- Guardado, preview, snapshot, upload, render, webhook e importacion tienen
  cobertura automatica y una corrida E2E registrada.
- Cross-tenant, asset no READY y UUID arbitrario fallan cerrados.
- Preview y MP4 contienen los mismos SFX dentro de un frame de tolerancia.
- Reintentos no crean revision, provider asset, render ni cobro duplicado.
- ZIP persistido y ZIP enviado son auditables por hash/tamano sin secretos.
- README, CLAUDE y este archivo reflejan el flujo realmente desplegado.

## 13. Validacion ejecutada durante esta revision

- Inspeccion estatica de ruta PUT, servicio de documento, preview assets,
  compilador, snapshot, materializacion, submission, migracion y biblioteca.
- Contraste con documentacion oficial Supabase/PostgREST y HyperFrames.
- `npm run test:hyperframes --workspace=apps/web`: aprobado, incluyendo los
  nuevos casos SFX de autorizacion, guardado, preview y compilacion de audio.
- `npm run build --workspace=apps/web`: aprobado. La primera ejecucion no pudo
  descargar Google Fonts por la red restringida; la repeticion con acceso a red
  compilo y genero las rutas correctamente.
- `npx supabase db push --dry-run`: no ejecutado contra remoto porque este
  checkout no tiene un proyecto Supabase vinculado. La migracion sigue pendiente
  de validacion y aplicacion en el entorno destino.
- Validacion manual en el editor real sobre el borrador reportado: el reintento
  del PUT cambio de 17 a 18 clips, mostro la capa `SFX` con `Swoosh Simple` en
  `00:23-00:27` y termino en estado `Guardado`, sin reproducir el error 500.
- No se ejecuto render pagado ni se descargo el snapshot del borrador reportado.

## 14. Historial

- 2026-09-04: se verifico la correccion P0 de extremo a extremo en la UI con el
  mismo reintento que habia fallado; el clip SFX quedo persistido y visible en
  timeline y microeditor.
- 2026-09-04: se implemento la correccion P0 con consultas explicitas de
  enlaces y assets READY reutilizadas por guardado y preview. Se agregaron
  pruebas de autorizacion fail-closed, persistencia de clip SFX, URL privada y
  contrato HTML HyperFrames. El PUT ahora entrega `diagnosticId`, codigo y etapa
  en errores inesperados. Se agrego la migracion
  `20260905100000_harden_sound_effect_asset_integrity.sql` para FKs compuestas,
  bucket inmutable de revision y proteccion de la identidad binaria READY; debe
  aplicarse antes de desplegar el codigo que lee esa columna.
- 2026-09-04: documento creado; incidente SFX diagnosticado; auditoria completa
  de documento, preview, snapshot ZIP, entrega remota y provider; plan de seis
  fases definido. No se implementaron aun las correcciones.
