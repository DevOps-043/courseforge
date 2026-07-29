# Plan de implementacion: modulo Talking Head con HeyGen

Fecha: 2026-07-29

## Fuente de verdad

Este plan debe ejecutarse usando `prompt_maestro.md` como fuente de verdad. Por lo tanto, cualquier implementacion debe priorizar, en este orden:

1. Correctitud funcional.
2. Seguridad.
3. Legibilidad.
4. Mantenibilidad.
5. Modularidad.
6. Escalabilidad.
7. Performance.
8. Testabilidad.
9. Observabilidad.
10. Documentacion clara.

Esto implica que el modulo HeyGen no debe implementarse como una suma de handlers con logica incrustada. La integracion debe estar separada en contratos, validaciones, cliente de proveedor, servicios de caso de uso, acceso a datos, rutas delgadas, UI presentacional y pruebas.

## Objetivo

Implementar un modulo operativo para generar, revisar, iterar y aprobar videos tipo talking head usando HeyGen, aprovechando los avatares existentes de la cuenta y conectandolo con el flujo actual de assets de Courseforge.

El resultado principal debe ser que un componente `VIDEO_THEORETICAL`, `VIDEO_DEMO` o `VIDEO_GUIDE` pueda generar un video de avatar desde su guion, guardar el resultado en Supabase Storage, registrar trazabilidad en `production_jobs` / `production_assets`, y promover una version aprobada a `material_components.assets.avatar_video` para que Remotion lo use en el ensamblado final.

## Alcance del MVP

Incluido:

- Sincronizar avatares privados y voces de la cuenta HeyGen.
- Definir un avatar/voz default por organizacion.
- Generar talking head desde el script del componente.
- Importar el MP4 final a `production-assets`.
- Registrar cada intento como job auditable.
- Mostrar iteraciones por componente.
- Aprobar una iteracion y usarla como `assets.avatar_video`.
- Mantener upload local, Drive import e import por video ID/URL como fallback.

No incluido en MVP:

- Realtime avatar para Lia.
- Video Agent como generador completo de cursos.
- Traduccion multilingue.
- Creacion de nuevos avatares desde Courseforge.
- Subtitulos como requisito bloqueante del talking head.

## Decision de arquitectura

Crear una integracion HeyGen dentro del dominio de produccion:

```txt
apps/web/src/domains/production/providers/heygen/
  heygen.client.ts
  heygen.repository.ts
  heygen-catalog.service.ts
  heygen-video.service.ts
  heygen-import.service.ts
  heygen-script-builder.ts
  heygen.validators.ts
  heygen.types.ts
```

La UI puede arrancar integrada en Produccion Visual, especificamente en `AvatarVideoSection`, y despues crecer a un laboratorio propio:

```txt
/admin/heygen
/admin/artifacts/[id] -> Produccion Visual -> Avatar Video
```

Esta decision evita crear un pipeline paralelo. HeyGen queda como proveedor gobernado de assets, no como sustituto de la arquitectura instruccional.

## Guardrails no negociables

### Separacion de responsabilidades

- API routes: autentican, validan payload, llaman caso de uso y devuelven respuesta consistente.
- Services: contienen reglas de negocio y orquestacion.
- Repository: encapsula queries Supabase, upserts y actualizaciones.
- Client: encapsula llamadas HTTP a HeyGen y normaliza errores externos.
- Validators: definen contratos Zod de request/response y payloads externos.
- UI: no contiene logica de negocio ni secretos; solo estado visual y acciones.

### Seguridad

- `HEYGEN_API_KEY` nunca se expone al cliente.
- Descargar archivos externos debe proteger contra SSRF: solo URLs HTTPS esperadas de HeyGen/CDN validada, timeout, limite de tamano, content-type permitido y sin seguir redirecciones inseguras.
- Webhooks deben verificar firma/secreto antes de leer o mutar estado.
- Todas las operaciones deben validar ownership por `organization_id`.
- Los logs no deben incluir API keys, URLs sensibles presignadas completas si no es necesario, payloads con PII ni stack traces al usuario.

### Idempotencia y consistencia

- Crear video debe usar idempotency key basada en `componentId`, `scriptHash`, `avatarId`, `voiceId`, `engine`, `resolution`, `aspectRatio` y background.
- Webhook/polling no deben duplicar assets si HeyGen reintenta o si el usuario refresca.
- La promocion de una iteracion debe ser atomica: aprobar asset, actualizar `material_components.assets.avatar_video`, marcar stale el ensamblado previo y registrar evento.
- Cuando Supabase no permita transaccion multi-step desde el cliente actual, el servicio debe ser idempotente y recuperable por reintentos.

### Escalabilidad y operacion

- Listados de iteraciones deben paginar.
- No cargar videos completos en UI, solo preview/thumbnail y reproduccion bajo demanda.
- Jobs largos deben ser asincronos: `WAITING_PROVIDER` + webhook/polling.
- Evitar N+1 queries al cargar iteraciones por componente.
- Registrar correlation IDs por job para debugging.

### Testabilidad

- El cliente HeyGen debe poder mockearse.
- El script builder debe ser testeable como funcion pura.
- El import service debe tener pruebas de validacion de tamano, MIME, reintentos e idempotencia.
- La UI debe probar flujos de estado: sin avatar, generando, completado, fallido, promovido.

## Fase 0 - Preparacion y decisiones de producto

Duracion estimada: 1 dia.

### Pasos

1. Confirmar `HEYGEN_API_KEY` disponible en ambientes local/staging.
2. Confirmar que la cuenta tiene al menos un avatar privado usable por API.
3. Confirmar el tipo del avatar existente:
   - Digital Twin.
   - Photo Avatar.
   - Studio Avatar.
4. Definir defaults iniciales:
   - Resolucion: `1080p`.
   - Aspect ratio: `16:9`.
   - Engine preferido: `avatar_v` si el avatar lo soporta; fallback `avatar_iv`.
   - Output: `mp4`.
   - Background: color institucional o transparente solo si el avatar soporta matting.
5. Decidir fuente de voz para MVP:
   - Opcion recomendada: voz HeyGen asociada al avatar para primer MVP.
   - Opcion posterior: audio externo/lipsync si quieren conservar voces de ElevenLabs u otro proveedor.

### Entregable

Matriz de configuracion:

```txt
organization_id
heygen_avatar_look_id
heygen_voice_id
engine_default
resolution_default
aspect_ratio_default
background_default
```

### DoD

- Llave HeyGen validada server-side.
- Avatar privado identificado.
- Voz default identificada.
- Defaults aprobados.

## Fase 1 - Datos y catalogo HeyGen

Duracion estimada: 3-5 dias.

### Paso 1. Crear migracion de catalogo

Agregar tablas:

- `heygen_workspace_connections`
- `heygen_avatar_presets`
- `heygen_voice_presets`

Campos minimos:

```txt
organization_id
heygen_avatar_look_id
heygen_avatar_group_id
heygen_voice_id
name
avatar_type
supported_api_engines
preview_image_url
preview_video_url
status
is_default
metadata
synced_at
```

Indices recomendados:

```sql
create unique index heygen_avatar_presets_org_look_uidx
  on heygen_avatar_presets (organization_id, heygen_avatar_look_id);

create unique index heygen_voice_presets_org_voice_uidx
  on heygen_voice_presets (organization_id, heygen_voice_id);

create index heygen_avatar_presets_org_default_idx
  on heygen_avatar_presets (organization_id, is_default)
  where is_default = true;
```

Justificacion:

- Upsert seguro por organizacion y avatar/voice externo.
- Lectura rapida del preset default.
- Evita duplicados durante sync o reintentos.

### Paso 2. Registrar provider y job types

Extender:

- `apps/web/src/domains/production/types/production.types.ts`
- `apps/web/src/domains/production/providers/production-provider-registry.ts`

Nuevos valores:

```ts
PRODUCTION_PROVIDERS.HEYGEN = "heygen";
PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO = "HEYGEN_AVATAR_VIDEO";
PRODUCTION_ASSET_TYPES.AVATAR_VIDEO = "AVATAR_VIDEO";
```

### Paso 3. Crear cliente server-side

Archivo:

```txt
apps/web/src/domains/production/providers/heygen/heygen.client.ts
```

Responsabilidades:

- Leer `HEYGEN_API_KEY`.
- Construir requests a `https://api.heygen.com`.
- Normalizar errores.
- Manejar `Retry-After` si aparece.
- Aplicar timeout explicito.
- Redactar API keys en logs.
- Exponer metodos:
  - `listAvatarLooks`.
  - `listVoices`.
  - `createVideo`.
  - `getVideo`.
  - `uploadAsset`, aunque puede quedar para fase posterior.

### Paso 4. Crear repository

Archivo:

```txt
apps/web/src/domains/production/providers/heygen/heygen.repository.ts
```

Responsabilidades:

- Upsert de presets de avatar/voice.
- Lectura de defaults por organizacion.
- Lectura paginada de iteraciones por componente.
- Actualizacion de jobs HeyGen.
- Insercion idempotente de `production_assets`.

El repository no debe llamar HeyGen ni construir reglas de negocio.

### Paso 5. Sincronizar catalogo

Endpoint:

```txt
POST /api/production/heygen/sync
```

Flujo:

1. Autenticar admin.
2. Resolver `organization_id`.
3. Llamar `GET /v3/avatars/looks?ownership=private`.
4. Llamar `GET /v3/voices?type=private`.
5. Upsert en tablas de presets.
6. Marcar default si solo existe un avatar/voz.

### Paso 6. UI minima de catalogo

Primera version puede ser una seccion dentro de settings/admin:

- Estado de conexion.
- Boton "Sincronizar HeyGen".
- Lista de avatares privados.
- Lista de voces privadas.
- Accion "Usar como default".

### DoD

- Admin puede sincronizar cuenta HeyGen.
- El avatar existente aparece en Courseforge.
- Se guarda `heygen_avatar_look_id`.
- Se guarda o infiere `default_voice_id`.
- Se conoce si el avatar soporta `avatar_v`.

## Fase 2 - Generacion talking head desde componente

Duracion estimada: 5-8 dias.

### Paso 1. Construir script del componente

Crear helper:

```txt
apps/web/src/domains/production/providers/heygen/heygen-script-builder.ts
```

Entrada:

- `material_components.content`.
- Tipo de componente.
- `VideoScript.sections`.

Salida:

```ts
{
  title: string;
  scriptText: string;
  durationEstimateSeconds: number;
  sectionCount: number;
  scriptHash: string;
}
```

Reglas:

- Concatenar `narration_text` en orden.
- Omitir texto vacio.
- Mantener pausas legibles entre secciones.
- Validar longitud minima.
- Usar hash para idempotencia.

### Paso 2. Crear API/action de generacion

Endpoint:

```txt
POST /api/production/heygen/videos
```

Payload:

```json
{
  "componentId": "uuid",
  "avatarPresetId": "uuid",
  "voicePresetId": "uuid",
  "engine": "avatar_v",
  "resolution": "1080p",
  "aspectRatio": "16:9",
  "background": {
    "type": "color",
    "value": "#FFFFFF"
  },
  "autoPromote": false
}
```

Validacion:

- `componentId`, `avatarPresetId`, `voicePresetId` deben ser UUID validos.
- `engine` solo acepta valores soportados por el avatar seleccionado.
- `resolution` solo acepta valores permitidos.
- `aspectRatio` solo acepta `16:9` o `9:16`.
- `background` debe cumplir contrato estricto.
- `autoPromote` debe ser false por defecto.

Flujo backend:

1. Autenticar admin.
2. Autorizar componente con `getAuthorizedMaterialComponentAdmin`.
3. Resolver contexto con `resolveProductionComponentContext`.
4. Construir script.
5. Crear o reutilizar `production_job` con idempotency key:
   - component id.
   - script hash.
   - avatar id.
   - voice id.
   - engine/resolution/aspect ratio.
6. Llamar `POST /v3/videos`.
7. Guardar `provider_job_id = video_id`.
8. Marcar job `WAITING_PROVIDER`.
9. Devolver `jobId`, `providerJobId`, estado y estimacion de costo.

Codigos de respuesta:

- `200`: job reutilizado o creado correctamente.
- `400`: payload invalido.
- `401`: usuario no autenticado.
- `403`: usuario sin permisos sobre organizacion/componente.
- `409`: avatar/voice no disponible o engine no soportado.
- `429`: limite interno o proveedor saturado.
- `502`: error controlado de proveedor HeyGen.

### Paso 3. Polling inicial

Endpoint:

```txt
GET /api/production/heygen/jobs/[jobId]
```

Responsabilidades:

- Leer `production_jobs`.
- Si esta `WAITING_PROVIDER`, llamar `GET /v3/videos/{video_id}`.
- Si sigue procesando, devolver progreso simple.
- Si completo, llamar servicio de importacion.
- Si fallo, guardar `provider_error`.

El polling debe tener backoff desde UI para evitar golpear la API en paralelo desde multiples tabs. Si hay webhook activo, polling queda como fallback de recuperacion, no como mecanismo principal.

### Paso 4. Importar resultado a Supabase

Servicio:

```txt
heygen-import.service.ts
```

Flujo:

1. Recibir `jobId` y payload de HeyGen completado.
2. Descargar `video_url`.
3. Validar seguridad de la URL:
   - HTTPS.
   - Host permitido o derivado de respuesta HeyGen.
   - Timeout.
   - Content-Type `video/mp4` o `video/webm`.
   - Tamano maximo configurado.
4. Subir a:

```txt
production-assets/heygen/{artifactId}/{componentId}/{jobId}.mp4
```

5. Insertar `production_assets`:
   - `asset_type = AVATAR_VIDEO`.
   - `provider = heygen`.
   - `production_job_id = jobId`.
   - `public_url`.
   - `duration_seconds`.
   - `metadata.video_id`.
   - `metadata.video_page_url`.
   - `metadata.thumbnail_url`.
   - `metadata.gif_url`.
6. Marcar job `SUCCEEDED`.
7. Si `autoPromote`, actualizar `material_components.assets.avatar_video`.

### Paso 5. Promover asset aprobado

Action:

```txt
promoteHeygenAvatarAssetAction(assetId: string)
```

Flujo:

1. Validar permisos.
2. Leer `production_assets`.
3. Actualizar `qa_status = APPROVED`.
4. Actualizar `material_components.assets.avatar_video`:

```json
{
  "provider": "heygen",
  "external_id": "heygen-video-id",
  "sync_status": "COMPLETED",
  "public_url": "...",
  "storage_path": "production-assets/heygen/...",
  "duration": 123
}
```

5. Recalcular `production_status`.
6. Limpiar `final_video_url` si el ensamblado anterior queda stale.
7. Registrar evento en pipeline.

La promocion debe centralizarse en un servicio. No debe implementarse duplicada en route, action y UI.

### DoD

- Un admin puede generar talking head desde un componente real.
- El video se guarda en storage propio.
- El intento queda en `production_jobs`.
- El resultado queda en `production_assets`.
- El asset aprobado aparece como `assets.avatar_video`.
- La preview/ensamblado Remotion puede consumir el video.

## Fase 3 - UI de iteraciones en Produccion Visual

Duracion estimada: 5-7 dias.

### Paso 1. Evolucionar `AvatarVideoSection`

Archivo actual:

```txt
apps/web/src/domains/materials/components/ProductionStructuredAssetSections.tsx
```

Agregar:

- Selector de avatar preset.
- Selector de voz preset.
- Selector de engine.
- Selector de resolucion.
- Boton "Generar con HeyGen".
- Estado del job actual.
- Lista de ultimas iteraciones.

Mantener:

- Upload local.
- Import desde Drive.
- Import manual por ID/URL de HeyGen.
- Clear/remover avatar.

Regla de UI:

- No exponer campos tecnicos crudos como unico camino feliz. El usuario debe poder elegir presets entendibles.
- El ID/URL manual queda como fallback avanzado.
- La UI no debe construir payloads HeyGen directos; debe mandar parametros del dominio Courseforge.

### Paso 2. Hook de estado

Extender:

```txt
apps/web/src/domains/materials/hooks/useProductionAssetState.ts
```

Nuevos estados:

```ts
heygenPresets
selectedHeygenAvatarPresetId
selectedHeygenVoicePresetId
isGeneratingHeygen
heygenGenerationJob
heygenIterations
```

Nuevas operaciones:

- `loadHeygenPresets`.
- `generateHeygenAvatarVideo`.
- `pollHeygenGeneration`.
- `promoteHeygenIteration`.
- `rejectHeygenIteration`.

### Paso 3. Componente de iteraciones

Crear:

```txt
apps/web/src/domains/materials/components/HeygenAvatarIterationsPanel.tsx
```

Contenido:

- Tarjeta por iteracion.
- Preview de video/thumbnail.
- Avatar, voice, engine, resolution.
- Estado.
- Duracion.
- Costo estimado/real si esta disponible.
- Botones:
  - Usar esta version.
  - Rechazar.
  - Duplicar parametros.
  - Abrir en HeyGen.

El listado debe paginar o limitar ultimas iteraciones para no degradar componentes con muchos intentos.

### Paso 4. UX recomendada

El panel del avatar debe tener tres modos:

1. `Sin avatar`
   - CTA: generar con HeyGen, subir, importar.
2. `Generando`
   - Estado del job y polling.
3. `Avatar listo`
   - Preview, metadatos, reemplazar, ver iteraciones.

### DoD

- La generacion se puede iniciar desde Produccion Visual.
- El usuario ve estado sin refrescar manualmente.
- Se pueden revisar varias iteraciones.
- Se puede promover una iteracion.
- No se rompe el flujo de upload/import actual.

## Fase 4 - Webhook e importacion automatica robusta

Duracion estimada: 3-5 dias.

### Paso 1. Endpoint webhook

Crear:

```txt
apps/web/src/app/api/webhooks/heygen/route.ts
```

Eventos iniciales:

- `avatar_video.success`
- `avatar_video.fail`

Contrato:

- Aceptar solo `POST`.
- Leer raw body para verificar firma si HeyGen lo requiere.
- Rechazar payload sin firma valida.
- Responder 2xx solo cuando el evento fue aceptado de forma idempotente.

### Paso 2. Asociacion job-evento

Usar `callback_id = production_job.id` al crear el video.

Webhook:

1. Verifica firma.
2. Busca job por `callback_id`.
3. Si success, importa resultado.
4. Si fail, marca job `FAILED`.
5. Agrega entrada en `production_jobs.progress`.

### Paso 3. Idempotencia

Si HeyGen reintenta webhook:

- Si job ya esta `SUCCEEDED`, responder 200 sin duplicar asset.
- Si ya existe `production_assets.production_job_id`, no subir de nuevo.
- Si importacion fallo despues del download, permitir retry controlado.

### Paso 4. Fallback

Mantener polling como fallback:

- Si webhook no llega, el panel puede consultar estado.
- Un job programado posterior podria reintentar jobs `WAITING_PROVIDER` antiguos.

### DoD

- Un render completado se importa sin accion manual.
- Webhook duplicado no duplica assets.
- Error de HeyGen queda visible.
- Polling sigue funcionando como fallback.

## Fase 5 - QA, permisos y controles de costo

Duracion estimada: 3-5 dias.

### Paso 1. Permisos

Solo admins autorizados de la organizacion pueden:

- Sincronizar cuenta.
- Generar con HeyGen.
- Aprobar/rechazar assets.
- Promover una iteracion.

### Paso 2. Estimacion de costo

Calcular aproximacion antes de llamar HeyGen:

```txt
durationEstimateSeconds * pricePerSecond
```

Guardar en:

- `production_jobs.estimated_cost_cents`.
- `production_jobs.actual_cost_cents` si luego se puede estimar con duracion real.

### Paso 3. Limites

Controles recomendados:

- Maximo de duracion por render.
- Maximo de iteraciones por componente.
- Confirmacion si supera cierto costo estimado.
- No generar si falta avatar/voice default.

### Paso 4. Auditoria

Registrar eventos:

- `HEYGEN_AVATAR_VIDEO_REQUESTED`.
- `HEYGEN_AVATAR_VIDEO_COMPLETED`.
- `HEYGEN_AVATAR_VIDEO_FAILED`.
- `HEYGEN_AVATAR_ASSET_APPROVED`.
- `HEYGEN_AVATAR_ASSET_PROMOTED`.

### Paso 5. Observabilidad minima

Cada job debe registrar:

- `jobId`.
- `providerJobId`.
- `componentId`.
- `artifactId`.
- `organizationId`.
- `correlationId`.
- Duracion estimada y real.
- Estado final.
- Error normalizado si falla.

Metricas recomendadas:

- Conteo de jobs creados/completados/fallidos.
- Tiempo promedio de render HeyGen.
- Tiempo promedio de importacion a storage.
- Tasa de fallo por `failure_code`.
- Costo estimado acumulado por organizacion.

### DoD

- No se puede generar sin permisos.
- Costos estimados visibles antes de generar.
- Se puede auditar quien genero y aprobo.
- Jobs fallidos muestran causa.
- Hay logs suficientes para diagnosticar fallos sin exponer secretos.

## Fase 6 - Ajuste con Remotion y estado de produccion

Duracion estimada: 2-4 dias.

### Paso 1. Validar contrato

Confirmar que `normalizeAssemblyAssets` sigue resolviendo:

```txt
assets.avatar_video.public_url -> avatarVideoUrl
```

### Paso 2. Estado de produccion

Mantener regla:

- `VIDEO_THEORETICAL` requiere `avatar_video`.

Revisar si se hace configurable:

- `VIDEO_DEMO` puede requerir screencast + voz, no siempre avatar.
- `VIDEO_GUIDE` puede requerir avatar segun plantilla.

### Paso 3. Stale final video

Cuando se promueve un nuevo avatar:

- Marcar `final_video_assembly_stale = true` si existia final video.
- Limpiar metadata final si el sistema ya lo hace al cambiar source signature.

### Paso 4. Preview

Verificar:

- Split avatar.
- Avatar focus.
- Full slides sin avatar como fallback.

### DoD

- Remotion preview carga el talking head.
- Reemplazar avatar invalida ensamblado final anterior.
- El estado de produccion refleja assets faltantes/listos.

## Fase 7 - Subtitulos, sin bloquear MVP

Subtitulos deben considerarse como modulo complementario, no como requisito inicial para talking head.

### Opcion A - Captions generados por HeyGen

Usar `caption` / `captioned_video_url` / `subtitle_url` cuando HeyGen lo entregue.

Ventajas:

- Bajo esfuerzo.
- Subtitulos alineados al render de HeyGen.

Limitaciones:

- Menos control pedagogico.
- Depende de formato/respuesta de proveedor.

### Opcion B - Subtitulos desde Courseforge

Generar SRT/VTT desde `VideoScript.sections` y timecodes existentes.

Ventajas:

- Control total.
- No depende de HeyGen.
- Puede usarse tambien en Remotion, Soflia y exportaciones.

Limitaciones:

- Hay que ajustar tiempos reales despues del audio/video final.

### Recomendacion

Para MVP:

- Guardar `subtitle_url` si HeyGen lo devuelve.
- No exigir subtitulos para aprobar talking head.

Para fase posterior:

- Crear `production_assets.asset_type = SUBTITLE`.
- Generar VTT/SRT desde `VideoScript.sections`.
- Permitir QA/correccion manual.
- Enlazar subtitulos al `final_video_url` y a Soflia si la publicacion lo soporta.

## Orden recomendado de ejecucion

1. Migracion de catalogo y constantes de provider.
2. Cliente HeyGen server-side.
3. Endpoint de sync de avatares/voices.
4. UI minima para ver y elegir avatar default.
5. Script builder desde componente.
6. Endpoint de crear video HeyGen.
7. Job tracking con polling.
8. Importacion del MP4 a Supabase.
9. Registro en `production_assets`.
10. Promocion a `assets.avatar_video`.
11. Iterations panel en Produccion Visual.
12. Webhook robusto.
13. Controles de costo/permisos.
14. Ajustes de Remotion y stale final video.
15. Subtitulos como mejora posterior.

## Plan de pruebas

### Unitarias

- `heygen-script-builder`
  - concatena secciones en orden.
  - omite textos vacios.
  - calcula hash estable.
  - falla con script vacio.
- `heygen.client`
  - normaliza errores 4xx/5xx.
  - respeta timeout.
  - no expone API key en errores.
- `heygen-import.service`
  - rechaza URL no HTTPS.
  - rechaza MIME no permitido.
  - rechaza archivo que excede limite.
  - no duplica asset si el job ya fue importado.

### Integracion

- Sync de avatares/voices con responses mockeadas.
- Crear job HeyGen desde componente autorizado.
- Polling que completa job y crea `production_assets`.
- Promocion de asset a `material_components.assets.avatar_video`.
- Webhook success/fail con firma valida e invalida.

### UI

- Estado sin avatar.
- Estado generando.
- Estado completado.
- Estado fallido.
- Promover iteracion.
- Mantener upload local e import Drive funcionando.

### Seguridad

- Usuario sin organizacion no puede sincronizar ni generar.
- Usuario de otra organizacion no puede leer/promover assets.
- Webhook sin firma no muta estado.
- Payload malformado devuelve error seguro.

### Regresion

- `saveMaterialAssetsAction` sigue aceptando upload manual.
- `resolveProductionStatus` conserva comportamiento para `VIDEO_THEORETICAL`.
- Remotion sigue leyendo `avatar_video.public_url`.
- Publicacion no recibe videos incompletos.

## Rutas y archivos previstos

Backend/dominio:

```txt
apps/web/src/domains/production/providers/heygen/heygen.client.ts
apps/web/src/domains/production/providers/heygen/heygen.repository.ts
apps/web/src/domains/production/providers/heygen/heygen-catalog.service.ts
apps/web/src/domains/production/providers/heygen/heygen-video.service.ts
apps/web/src/domains/production/providers/heygen/heygen-import.service.ts
apps/web/src/domains/production/providers/heygen/heygen-script-builder.ts
apps/web/src/domains/production/providers/heygen/heygen.validators.ts
apps/web/src/domains/production/providers/heygen/heygen.types.ts
```

API routes:

```txt
apps/web/src/app/api/production/heygen/sync/route.ts
apps/web/src/app/api/production/heygen/videos/route.ts
apps/web/src/app/api/production/heygen/jobs/[jobId]/route.ts
apps/web/src/app/api/webhooks/heygen/route.ts
```

Acciones/UI:

```txt
apps/web/src/domains/materials/actions/heygen-production.actions.ts
apps/web/src/domains/materials/components/HeygenAvatarIterationsPanel.tsx
apps/web/src/domains/materials/components/ProductionStructuredAssetSections.tsx
apps/web/src/domains/materials/hooks/useProductionAssetState.ts
```

DB:

```txt
supabase/migrations/YYYYMMDDHHMMSS_create_heygen_catalog.sql
```

## Criterios de aceptacion del MVP

1. Un admin puede sincronizar la cuenta HeyGen y ver el avatar existente.
2. Un admin puede marcar avatar y voz default.
3. Un componente `VIDEO_THEORETICAL` puede generar talking head desde su guion.
4. El job queda registrado con input/output/error.
5. El MP4 queda guardado en Supabase Storage.
6. El resultado queda como `production_assets.asset_type = AVATAR_VIDEO`.
7. El admin puede aprobar una iteracion.
8. La iteracion aprobada actualiza `material_components.assets.avatar_video`.
9. Remotion usa ese avatar en preview/ensamblado.
10. Si el render falla, el error es visible y no deja el componente en estado ambiguo.
11. Webhook y polling son idempotentes.
12. No se exponen secretos ni URLs sensibles innecesarias.
13. Hay pruebas unitarias e integracion para los servicios criticos.
14. Los endpoints tienen contratos y respuestas consistentes.

## Checklist de implementacion segun `prompt_maestro.md`

- Correctitud: el talking head generado corresponde al guion y componente correctos.
- Seguridad: secretos server-side, autorizacion por organizacion, webhook firmado, descarga externa validada.
- Legibilidad: nombres semanticos, servicios pequenos, rutas delgadas.
- Mantenibilidad: provider HeyGen encapsulado y reemplazable.
- Modularidad: UI, API, servicios, repository, validators y client separados.
- Escalabilidad: jobs asincronos, paginacion, idempotencia, sin rutas calientes pesadas.
- Performance: no descargar videos en rutas de lectura ni cargar previews innecesarias.
- Testabilidad: cliente mockeable, script builder puro, servicios con contratos.
- Observabilidad: logs estructurados, job IDs, provider IDs, errores normalizados.
- Documentacion: README tecnico o seccion en este plan actualizada con contratos finales.

## Recomendacion final

Empezar por el camino mas corto y robusto: catalogo privado de avatares + generacion de talking head + importacion a storage + aprobacion de iteraciones. Subtitulos deben capturarse si HeyGen los devuelve, pero no deben bloquear el MVP. Una vez estable el talking head, la siguiente mejora con mejor retorno seria generar SRT/VTT desde los propios `VideoScript.sections`, porque eso preserva el control instruccional de Courseforge y puede servir tanto para HeyGen como para Remotion y Soflia.
