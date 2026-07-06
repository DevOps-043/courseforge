# Cloud Run para Remotion en Courseforge

## Objetivo

Hospedar `apps/api` como backend vivo de Remotion en Cloud Run, manteniendo Netlify como app principal y Supabase como estado/storage. Este despliegue usa `RENDER_PROVIDER=local`: Cloud Run ejecuta Chromium, cola local secuencial y `@remotion/renderer`.

## Proyecto GCP

Crear un proyecto separado, por ejemplo:

```bash
gcloud projects create soflia-engine-render-prod --name="Soflia Engine Render Prod"
gcloud beta billing projects link soflia-engine-render-prod --billing-account=<BILLING_ACCOUNT_ID>
gcloud config set project soflia-engine-render-prod
```

Habilitar APIs:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com logging.googleapis.com monitoring.googleapis.com
```

Crear Artifact Registry:

```bash
gcloud artifacts repositories create courseforge-api --repository-format=docker --location=us-central1 --description="Courseforge Remotion API images"
```

Crear service account runtime:

```bash
gcloud iam service-accounts create courseforge-remotion-runner --display-name="Courseforge Remotion Runner"
```

## Secretos y variables

Guardar secretos sensibles en Secret Manager:

```bash
printf "%s" "<SUPABASE_SERVICE_ROLE_KEY>" | gcloud secrets create courseforge-supabase-service-role-key --data-file=-
gcloud secrets add-iam-policy-binding courseforge-supabase-service-role-key --member="serviceAccount:courseforge-remotion-runner@soflia-engine-render-prod.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

Variables no secretas:

```text
NODE_ENV=production
RENDER_PROVIDER=local
API_PUBLIC_URL=https://<cloud-run-url>
EXPRESS_PUBLIC_URL=https://<cloud-run-url>
REMOTION_ENTRY_POINT=/app/apps/web/src/remotion/index.ts
REMOTION_RENDER_TIMEOUT_MS=1800000
EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS=1800000
ALLOWED_ORIGINS=https://<netlify-prod-domain>,https://<netlify-staging-domain>
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
```

En Netlify configurar:

```text
PRODUCTION_API_URL=https://<cloud-run-url>
API_PUBLIC_URL=https://<cloud-run-url>
```

## Build y deploy

Construir desde la raiz del monorepo para incluir `apps/web/src/remotion`:

```bash
gcloud builds submit --config apps/api/cloudbuild.yaml .
```

Primer deploy. Usar una URL temporal y luego actualizar `API_PUBLIC_URL`/`EXPRESS_PUBLIC_URL` cuando Cloud Run entregue la URL final:

```bash
gcloud run deploy courseforge-remotion-api \
  --image us-central1-docker.pkg.dev/soflia-engine-render-prod/courseforge-api/courseforge-remotion-api:prod \
  --region us-central1 \
  --service-account courseforge-remotion-runner@soflia-engine-render-prod.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --timeout 30m \
  --concurrency 1 \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --set-env-vars NODE_ENV=production,RENDER_PROVIDER=local,REMOTION_ENTRY_POINT=/app/apps/web/src/remotion/index.ts,REMOTION_RENDER_TIMEOUT_MS=1800000,EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS=1800000,NEXT_PUBLIC_SUPABASE_URL=<supabase-url>,ALLOWED_ORIGINS=https://<netlify-prod-domain> \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=courseforge-supabase-service-role-key:latest
```

Actualizar las URLs publicas cuando exista la URL real:

```bash
gcloud run services update courseforge-remotion-api \
  --region us-central1 \
  --update-env-vars API_PUBLIC_URL=https://<cloud-run-url>,EXPRESS_PUBLIC_URL=https://<cloud-run-url>
```

## Validacion

```bash
curl https://<cloud-run-url>/health
curl https://<cloud-run-url>/api/v1/production/remotion/readiness
```

Luego validar desde Netlify staging:

1. Configurar `PRODUCTION_API_URL`.
2. Renderizar solo un video corto con "Ensamblar seleccionado".
3. Verificar en Supabase `production_jobs.status = SUCCEEDED`.
4. Confirmar `material_components.assets.final_video_url`.
5. Revisar logs Cloud Run sin secretos ni stack traces sensibles.

## Rollback

Cambiar `PRODUCTION_API_URL` en Netlify al backend anterior o desactivar temporalmente el ensamblado Remotion en la UI. No borrar el servicio Cloud Run hasta confirmar que no quedan jobs `PENDING`, `QUEUED` o `RUNNING`.
