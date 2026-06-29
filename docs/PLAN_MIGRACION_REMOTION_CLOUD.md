# Plan de Migracion Cloud del Pipeline Remotion sin Ngrok

Fecha: 2026-06-29

## Entendimiento del objetivo

Courseforge necesita dejar de depender de ngrok y de una maquina local para operar el pipeline de Remotion. El objetivo es mover backend, orquestacion y renders a una infraestructura cloud con URLs estables, HTTPS, storage persistente, secretos seguros, monitoreo y capacidad de escalar renders.

Este plan usa `prompt_maestro.md` como fuente de verdad: correctitud funcional, seguridad, legibilidad, mantenibilidad, modularidad, escalabilidad, performance, testabilidad, observabilidad y documentacion clara.

Decision base: AWS completo para produccion.

- API backend: App Runner o ECS Fargate.
- Render: Remotion Lambda.
- Storage: S3 para bundles, previews y renders.
- Secretos: AWS Secrets Manager o SSM Parameter Store.
- Logs y metricas: CloudWatch.
- DB/Auth: Supabase se mantiene como fuente principal.

## Diagnostico tecnico

Hallazgos actuales:

- `apps/web/src/domains/materials/actions/production.actions.ts` disparaba renders contra `EXPRESS_API_URL` con fallback a `http://localhost:4000`.
- Acciones de produccion y preview enviaban `ngrok-skip-browser-warning`, lo que acopla el flujo al tunel temporal.
- `apps/api/src/features/production/production.controller.ts` crea `production_jobs`, pero antes siempre delegaba a `RemotionQueueService`.
- `apps/api/src/features/production/remotion-queue.service.ts` ejecuta una cola local con `child_process.fork()`, util para desarrollo pero no suficiente como runtime productivo.
- `apps/api/src/features/production/remotion-worker.service.ts` persiste el resultado final en Supabase Storage y actualiza `material_components.assets.final_video_url`.
- Las plantillas ZIP aprobadas pasan por `APPROVED_FOR_SANDBOX` y por el sandbox externo, pero el preview interno y el render final todavia tienen rutas que pueden divergir.

Riesgo principal: si se migra "por parche", se puede terminar con API cloud, render local, storage mixto y secretos dispersos. Por eso la implementacion se separa en contratos y providers.

## Implementacion propuesta

### 1. Contratos y provider selector

Se agrego una interfaz `RenderProvider` con implementaciones:

- `LocalRemotionProvider`: usa la cola local existente para desarrollo.
- `RemotionLambdaProvider`: envia jobs a Remotion Lambda cuando `RENDER_PROVIDER=lambda`.

La seleccion se centraliza en `RemotionRenderOrchestratorService`.

### 2. Configuracion cloud

Variables nuevas o formalizadas:

- `RENDER_PROVIDER=local|lambda`
- `API_PUBLIC_URL`
- `EXPRESS_PUBLIC_URL`
- `REMOTION_LAMBDA_REGION`
- `REMOTION_LAMBDA_FUNCTION_NAME`
- `REMOTION_LAMBDA_SERVE_URL`
- `REMOTION_LAMBDA_SITE_NAME`
- `REMOTION_LAMBDA_BUCKET`
- `REMOTION_LAMBDA_OUTPUT_PRIVACY=private|public`

Si `RENDER_PROVIDER=lambda`, la API falla rapido si faltan variables criticas.

Antes de activar renders reales en staging, validar:

`GET /api/v1/production/remotion/readiness`

La ruta requiere autenticacion y no expone secretos. Devuelve `200` si la configuracion esta lista y `503` si faltan variables o dependencias runtime como `@remotion/lambda`.

### 3. Backend cloud-ready

`POST /api/v1/production/remotion/render` mantiene su contrato publico, pero ahora despacha el job al provider configurado.

No se usan webhooks. El sistema operativo de Courseforge para Remotion Lambda es solo API REST.

`GET /api/v1/production/jobs/:jobId/status` sincroniza progreso con `getRenderProgress()` cuando el job esta en `WAITING_PROVIDER` y `renderProvider=lambda`. Esta ruta es la fuente de reconciliacion de estados, cierre exitoso y fallo.

El polling REST actualiza:

- `production_jobs.status`
- `production_jobs.provider_job_id`
- `production_jobs.input_snapshot`
- `production_jobs.output_snapshot`
- `material_components.assets.final_video_url`
- `material_components.assets.production_status`

### 4. Frontend sin ngrok

Las acciones web ahora resuelven la API con:

1. `EXPRESS_INTERNAL_API_URL`
2. `EXPRESS_API_URL`
3. `API_PUBLIC_URL`
4. `http://localhost:4000` solo fuera de produccion

En produccion, si no hay URL configurada, falla con error explicito. Se removieron los headers de ngrok.

### 5. Storage y trazabilidad

La implementacion Lambda usa rutas S3 bajo:

`remotion-renders/{environment}/{organizationId}/{jobId}.mp4`

El output se registra como `s3://bucket/key` o como URL publica/controlada devuelta por `getRenderProgress()`.

## Rollout recomendado

1. Mantener `RENDER_PROVIDER=local` en desarrollo.
2. Configurar AWS y Remotion Lambda en staging.
3. Activar `RENDER_PROVIDER=lambda` solo en staging.
4. Probar composicion interna corta.
5. Probar render con slides, audio y B-roll.
6. Probar plantilla ZIP aprobada.
7. Validar polling REST, estados y `final_video_url`.
8. Activar en produccion por organizacion o ventana controlada.
9. Retirar ngrok de runbooks y variables operativas.

## Validaciones

- `npm run lint --workspace=apps/api`
- `npm run test:remotion --workspace=apps/api`
- `npx tsc -p apps/web/tsconfig.json --noEmit`

Casos a validar en staging:

- `GET /api/v1/production/remotion/readiness` devuelve `200` con `RENDER_PROVIDER=lambda`.
- Render exitoso con `RENDER_PROVIDER=lambda`.
- Polling REST avanza progreso de `WAITING_PROVIDER`.
- Polling REST no reabre jobs terminales.
- Job fallido marca `production_status=FAILED`.
- Job completado actualiza `final_video_url`.
- Frontend no usa `ngrok-skip-browser-warning`.
- Produccion falla rapido si falta URL publica o secreto.

## Riesgos residuales

- `@remotion/lambda` debe instalarse en `apps/api` antes de activar Lambda.
- La forma exacta de `getRenderProgress()` debe validarse contra la cuenta AWS/Remotion real antes de activar produccion.
- Si los renders reales exceden limites practicos de Lambda, la fase 2 debe mover renders pesados a ECS Fargate, AWS Batch o Remotion sobre workers dedicados.
- Las plantillas ZIP externas requieren una segunda estabilizacion para garantizar que preview y render usen exactamente el mismo bundle/props contract.
