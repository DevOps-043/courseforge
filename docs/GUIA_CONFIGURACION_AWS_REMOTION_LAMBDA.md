# Guia de configuracion AWS para Remotion Lambda en Courseforge

Fecha: 2026-06-29

## Objetivo

Configurar un entorno AWS de staging para que Courseforge ejecute renders de Remotion Lambda sin ngrok, sin maquina local y sin webhooks. La reconciliacion de estado se hace solo por API REST mediante:

- `POST /api/v1/production/remotion/render`
- `GET /api/v1/production/jobs/:jobId/status`
- `GET /api/v1/production/remotion/readiness`

Referencia interna: `docs/PLAN_MIGRACION_REMOTION_CLOUD.md`.

Referencias oficiales:

- Remotion Lambda setup: https://www.remotion.dev/docs/lambda/setup
- Remotion Lambda CLI: https://www.remotion.dev/docs/lambda/cli
- `deployFunction()`: https://www.remotion.dev/docs/lambda/deployfunction
- `deploySite()`: https://www.remotion.dev/docs/lambda/deploysite
- `renderMediaOnLambda()`: https://www.remotion.dev/docs/lambda/rendermediaonlambda
- `getRenderProgress()`: https://www.remotion.dev/docs/lambda/getrenderprogress

## Decisiones de arquitectura

- Ambiente inicial: staging.
- Region inicial configurada: `us-east-2` (Ohio).
- Backend publico: App Runner o ECS Fargate con HTTPS.
- Render engine: Remotion Lambda.
- Storage: bucket S3 creado/gestionado para Remotion Lambda.
- Estado de jobs: Supabase `production_jobs`.
- Resultado final: `material_components.assets.final_video_url`.
- Webhooks: no se usan.
- Modo local: `RENDER_PROVIDER=local`.
- Modo AWS: `RENDER_PROVIDER=lambda`.

## Prerrequisitos

1. Cuenta AWS con acceso administrativo temporal para bootstrap.
2. AWS CLI configurado localmente o credenciales disponibles en el entorno CI/CD.
3. Node y npm funcionando en el repo.
4. Dependencias instaladas:

```bash
npm install --workspace=apps/api
```

5. Backend de Courseforge desplegable en una URL HTTPS estable.
6. Variables Supabase disponibles en el backend:

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Permisos AWS

Para bootstrap se puede usar un usuario/rol con permisos suficientes para que Remotion cree:

- Lambda functions
- IAM role/policies usados por Remotion Lambda
- S3 bucket/objects
- CloudWatch Logs
- Lambda layers/quotas necesarias

Despues del bootstrap, reducir privilegios y operar con un rol dedicado. Como minimo debe permitir:

- Invocar funciones Lambda de Remotion.
- Leer/escribir objetos en el bucket de Remotion.
- Leer progreso/render metadata requerido por `getRenderProgress()`.
- Escribir logs en CloudWatch.

No guardar `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY` en el repo. Usar secretos del proveedor de despliegue, AWS Secrets Manager o SSM Parameter Store.

## Paso 1: elegir nombres de staging

Valores sugeridos:

```env
AWS_REGION=us-east-2
REMOTION_LAMBDA_BUCKET=remotionlambda-courseforge-staging-535166420267-us-east-2
REMOTION_LAMBDA_SITE_NAME=courseforge-staging
REMOTION_LAMBDA_OUTPUT_PRIVACY=private
```

La funcion se puede dejar con el nombre generado por Remotion o guardar el valor devuelto como:

```env
REMOTION_LAMBDA_FUNCTION_NAME=
```

## Paso 2: desplegar funcion Lambda

Opcion recomendada: usar los scripts versionados del repo:

```bash
npm run aws:ensure-remotion-role
npm run aws:bootstrap-remotion
```

El primer comando crea o actualiza el rol IAM `remotion-lambda-role` con trust policy para Lambda y la policy recomendada por Remotion. El segundo comando despliega la funcion Lambda, crea el bucket S3 privado si falta y publica el site Remotion.

Referencia equivalente con `deployFunction()`:

Parametros sugeridos para staging:

```ts
import { deployFunction } from "@remotion/lambda";

const { functionName } = await deployFunction({
  region: "us-east-2",
  timeoutInSeconds: 900,
  memorySizeInMb: 2048,
  diskSizeInMb: 2048,
  createCloudWatchLogGroup: true,
  cloudWatchLogRetentionPeriodInDays: 14,
});

console.log(functionName);
```

Guardar el resultado en:

```env
REMOTION_LAMBDA_FUNCTION_NAME=<functionName>
REMOTION_LAMBDA_REGION=us-east-2
```

Notas:

- Remotion recomienda CloudWatch Logs habilitado.
- `REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS` controla el timeout de render/browser que Remotion envia a `renderMediaOnLambda()`. Mantenerlo por debajo del limite AWS de 900s; `840000` deja margen para cierre, subida de archivos y escritura de progreso.
- Lambda tiene limite maximo de 900 segundos por invocacion. Para staging se usa 900s para evitar fallos tempranos durante renders reales; para produccion se debe medir duracion/costo y ajustar con cuidado.
- Si staging necesita mas memoria o disco, aumentar gradualmente y medir costo/duracion.

## Paso 3: crear/confirmar bucket S3

Remotion Lambda requiere un bucket compatible con su runtime. El nombre debe iniciar con `remotionlambda-`. Para este staging se uso:

Guardar el nombre final en:

```env
REMOTION_LAMBDA_BUCKET=<bucket>
```

Politica inicial recomendada:

- Bucket privado por defecto para outputs.
- Permitir lectura publica solo del prefijo `sites/*`, porque Remotion Lambda carga el bundle desde `REMOTION_LAMBDA_SERVE_URL` con un navegador headless.
- Mantener `remotion-renders/*` privado.
- Encriptacion server-side habilitada.
- Lifecycle policy para limpiar renders temporales de staging.
- Prefijo usado por Courseforge:

```text
remotion-renders/{environment}/{organizationId}/{jobId}.mp4
```

## Paso 4: desplegar site Remotion

El site es el bundle Remotion que Lambda usara para renderizar composiciones.

Entry point esperado en Courseforge:

```text
apps/web/src/remotion/index.ts
```

Ejemplo con `deploySite()`:

```ts
import path from "path";
import { deploySite } from "@remotion/lambda";

const { serveUrl } = await deploySite({
  region: "us-east-2",
  bucketName: "remotionlambda-courseforge-staging-535166420267-us-east-2",
  siteName: "courseforge-staging",
  entryPoint: path.resolve(process.cwd(), "apps/web/src/remotion/index.ts"),
  privacy: "no-acl",
  options: {
    onBundleProgress: (progress) => console.log(`Bundle: ${progress}%`),
    onUploadProgress: ({ filesUploaded, totalFiles }) =>
      console.log(`Upload: ${filesUploaded}/${totalFiles}`),
  },
});

console.log(serveUrl);
```

Guardar el resultado en:

```env
REMOTION_LAMBDA_SERVE_URL=<serveUrl>
REMOTION_LAMBDA_SITE_NAME=courseforge-staging
```

Importante:

- Si cambia el codigo Remotion, redeploy del site.
- Mantener `siteName` estable en staging para evitar proliferacion de sites.
- Si `REMOTION_LAMBDA_SERVE_URL` devuelve XML `AccessDenied`, revisar que el bucket permita `s3:GetObject` publico sobre `sites/*`.
- Validar que las composiciones internas esperadas sigan disponibles: `full-slides`, `split-avatar`, `avatar-focus`.

## Paso 5: configurar backend Courseforge

Variables minimas para staging:

```env
NODE_ENV=production
RENDER_PROVIDER=lambda

API_PUBLIC_URL=https://api-staging.tu-dominio.com
EXPRESS_PUBLIC_URL=https://api-staging.tu-dominio.com
EXPRESS_INTERNAL_API_URL=https://api-staging.tu-dominio.com

REMOTION_LAMBDA_REGION=us-east-2
REMOTION_LAMBDA_FUNCTION_NAME=<functionName>
REMOTION_LAMBDA_SERVE_URL=<serveUrl>
REMOTION_LAMBDA_SITE_NAME=courseforge-staging
REMOTION_LAMBDA_BUCKET=remotionlambda-courseforge-staging-535166420267-us-east-2
REMOTION_LAMBDA_OUTPUT_PRIVACY=private
REMOTION_LAMBDA_FRAMES_PER_LAMBDA=600
REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA=1
REMOTION_LAMBDA_TIMEOUT_IN_MILLISECONDS=840000

NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
COURSEFORGE_JWT_SECRET=
```

No configurar:

```env
REMOTION_WEBHOOK_SECRET=
REMOTION_LAMBDA_WEBHOOK_URL=
```

Courseforge no usa webhooks para este flujo.

## Paso 6: validar readiness

Con un token valido de Courseforge:

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  https://api-staging.tu-dominio.com/api/v1/production/remotion/readiness
```

Resultado esperado:

```json
{
  "ok": true,
  "provider": "lambda",
  "checks": []
}
```

El arreglo `checks` puede contener checks detallados; todos deben tener `ok: true`.

Si devuelve `503`, corregir variables/dependencias antes de probar renders reales.

## Paso 7: prueba de render corta

1. Usar un componente con assets minimos y duracion corta.
2. Disparar el render desde la UI de Fase 7 o con `POST /api/v1/production/remotion/render`.
3. Confirmar que el response incluya:

```json
{
  "success": true,
  "renderProvider": "lambda",
  "status": "WAITING_PROVIDER"
}
```

4. Hacer polling:

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  https://api-staging.tu-dominio.com/api/v1/production/jobs/<JOB_ID>/status
```

5. Confirmar progresion:

- `WAITING_PROVIDER`
- `SUCCEEDED` o `FAILED`
- `output_snapshot.renderProvider = "lambda"`
- `output_snapshot.outputStoragePath` presente
- `material_components.assets.final_video_url` actualizado cuando termine bien

Para staging, partir renders largos en chunks pequenos mientras se validan cuotas:

```env
REMOTION_LAMBDA_FRAMES_PER_LAMBDA=600
REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA=1
```

No configurar `REMOTION_LAMBDA_CONCURRENCY` y `REMOTION_LAMBDA_FRAMES_PER_LAMBDA` al mismo tiempo. Remotion acepta solo una estrategia de particionamiento.

Si AWS devuelve `Concurrency limit reached` o `Rate Exceeded`, esperar a que terminen renders activos y reintentar con `REMOTION_LAMBDA_FRAMES_PER_LAMBDA=900` para reducir la cantidad de Lambdas por render. Si el problema persiste con un solo render activo, revisar cuotas Lambda o solicitar aumento de concurrencia en AWS.

## Paso 8: observabilidad

Revisar en AWS:

- CloudWatch Logs de la funcion Remotion.
- Errores de Lambda.
- Duracion promedio.
- Memoria usada.
- Throttling.
- Objetos generados en S3.

Revisar en Supabase:

- `production_jobs.status`
- `production_jobs.provider_job_id`
- `production_jobs.provider_request_id`
- `production_jobs.provider_error`
- `production_jobs.output_snapshot`
- `material_components.assets.production_status`

## Paso 9: rollback

Para volver a modo local en staging:

```env
RENDER_PROVIDER=local
```

Luego redeploy del backend.

No borrar inmediatamente Lambda, bucket ni site. Mantenerlos hasta confirmar que no hay jobs `WAITING_PROVIDER`.

## Checklist de aceptacion

- [ ] Backend publico HTTPS disponible.
- [ ] `@remotion/lambda` instalado en runtime.
- [ ] Funcion Lambda desplegada.
- [ ] Site Remotion desplegado.
- [ ] Bucket S3 configurado.
- [ ] Variables Lambda configuradas en backend.
- [ ] `GET /remotion/readiness` devuelve `200`.
- [ ] Render corto finaliza en `SUCCEEDED`.
- [ ] Polling REST actualiza progreso.
- [ ] No hay dependencia de ngrok.
- [ ] No hay webhooks configurados.
- [ ] Logs visibles en CloudWatch.
- [ ] Output visible en S3 o URL final registrada.

## Problemas comunes

### Readiness devuelve `@remotion/lambda is not installed`

Ejecutar instalacion en el runtime real:

```bash
npm install --workspace=apps/api
```

### Readiness devuelve `REMOTION_LAMBDA_SERVE_URL is missing`

Falta desplegar o registrar el site Remotion. Ejecutar `deploySite()` y guardar `serveUrl`.

### Render queda en `WAITING_PROVIDER`

Revisar:

- `provider_job_id` en `production_jobs`.
- `renderId` y `bucketName` en `input_snapshot`/`output_snapshot`.
- CloudWatch Logs de Lambda.
- Permisos S3 del bucket.
- Que `GET /jobs/:jobId/status` se este llamando; este endpoint reconcilia progreso por REST.

### Render falla con `Concurrency limit reached`

La cuenta o region alcanzo el limite de concurrencia/rate de AWS Lambda. En staging usar:

```env
REMOTION_LAMBDA_FRAMES_PER_LAMBDA=900
REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA=1
```

No combinar `REMOTION_LAMBDA_CONCURRENCY` con `REMOTION_LAMBDA_FRAMES_PER_LAMBDA`; si ambas existen, el backend falla al arrancar para evitar renders con tuning ambiguo.

Luego reintentar cuando no haya renders activos. Para produccion, medir uso real y pedir aumento de cuota Lambda si la carga lo requiere.

### Job termina pero no hay `final_video_url`

Revisar si `getRenderProgress()` esta devolviendo `outputFile`, `outputUrl` u `outputStoragePath`. Si no, ajustar el mapeo en `remotion-lambda-progress.service.ts` contra la respuesta real de staging.

## Notas de seguridad

- Nunca guardar credenciales AWS en el repo.
- Usar roles/secret manager del proveedor de despliegue.
- Mantener bucket privado por defecto.
- Permitir publico solo el bundle del site Remotion (`sites/*`); no publicar outputs ni assets sensibles.
- Evitar URLs publicas permanentes para assets internos si no son necesarias.
- No registrar `SUPABASE_SERVICE_ROLE_KEY`, AWS secret keys ni tokens en logs.
- Separar staging y produccion por bucket/site/function.

