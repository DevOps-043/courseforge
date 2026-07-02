# Plan: Bundles Remotion Externos en Cloud con Lambda

## Resumen

El flujo productivo para bundles externos pasa de sandbox/local a build aislado en cloud:

`ZIP aprobado -> AWS CodeBuild -> build durable en S3/site Lambda -> renderMediaOnLambda -> production-videos -> BD/publicacion`

La ruta v1 usa AWS CodeBuild porque permite ejecucion efimera, logs auditables y permisos IAM acotados sin mantener un worker propio. Las plantillas basicas internas siguen funcionando con el `REMOTION_LAMBDA_SERVE_URL` global.

## Opciones evaluadas

- **AWS CodeBuild (v1 elegida)**: compila bundles aprobados bajo demanda, publica artefactos durables y permite consultar estado por API REST/polling.
- **ECS/Fargate worker**: opcion fase 2 si se necesitan builds/renders muy largos, colas persistentes o control fino de red/CPU.
- **Solo bundles precompilados por usuario**: reduce ejecucion de codigo en nuestra nube, pero baja la reproducibilidad y complica la experiencia de creacion.

## Contrato implementado

- `remotion_template_versions.status = APPROVED` conserva el significado de aprobacion humana/auditoria.
- `remotion_template_builds` es la fuente de verdad del build cloud productivo.
- Estados relevantes de build:
  - `BUILDING`
  - `BUILT`
  - `BUILD_FAILED`
- Modos visibles en frontend:
  - `EXTERNAL_CLOUD_BUILD_READY`: requiere build cloud antes del render final.
  - `EXTERNAL_LAMBDA_SITE_READY`: tiene build cloud listo y puede renderizar en Lambda.
  - `EXTERNAL_CLOUD_BUILD_FAILED`: el build fallo y debe reintentarse/corregirse.

## Variables requeridas

Backend/API:

```env
REMOTION_TEMPLATE_CODEBUILD_PROJECT=
REMOTION_TEMPLATE_CODEBUILD_REGION=us-east-2
REMOTION_TEMPLATE_SOURCE_BUCKET=
REMOTION_TEMPLATE_BUILD_BUCKET=
REMOTION_TEMPLATE_BUILD_LOG_BUCKET=
REMOTION_TEMPLATE_BUILD_PUBLIC_BASE_URL=https://...
```

Existentes para render:

```env
RENDER_PROVIDER=lambda
REMOTION_LAMBDA_REGION=
REMOTION_LAMBDA_FUNCTION_NAME=
REMOTION_LAMBDA_BUCKET=
REMOTION_LAMBDA_SERVE_URL=
```

`REMOTION_TEMPLATE_BUILD_PUBLIC_BASE_URL` debe apuntar a una URL HTTPS durable desde la cual Lambda pueda cargar `index.html` y assets del bundle compilado.

## Flujo operativo

1. Admin sube ZIP y se valida estaticamente.
2. Revisor aprueba la version (`APPROVED`).
3. Admin ejecuta **Construir para cloud**.
4. API crea/reusa un registro en `remotion_template_builds`.
5. API descarga el ZIP aprobado desde Supabase Storage y lo copia a `REMOTION_TEMPLATE_SOURCE_BUCKET`.
6. API dispara AWS CodeBuild con variables no secretas y un `s3://...zip` como source.
7. CodeBuild descarga source ZIP desde S3, valida hash, compila y publica salida.
8. API sincroniza estado por REST/polling.
9. Cuando el build esta `BUILT`, postproduccion permite ensamblar final con Remotion Lambda usando el `serve_url` del build.

## Seguridad

- No se pasan secretos de Supabase al build; el backend prepara el ZIP fuente en S3 antes de disparar CodeBuild.
- El build recibe solo identificadores, rutas de storage, hash esperado y paths de salida.
- IAM de CodeBuild debe ser de minimo privilegio: leer source ZIP, escribir output/logs y, si aplica, publicar site Lambda.
- Los errores se sanitizan para no exponer credenciales.
- El sandbox local queda como preview/desarrollo, no como dependencia productiva.

## Checklist de rollout

- Crear proyecto AWS CodeBuild con imagen Node compatible con Remotion 4.0.484.
- Configurar IAM para buckets de source/output/logs.
- Publicar output por CloudFront/S3 HTTPS o Remotion Lambda site equivalente.
- Configurar variables `REMOTION_TEMPLATE_*` en staging.
- Reemplazar el comando temporal del proyecto CodeBuild por `docs/aws-codebuild-remotion-template-buildspec.yml`.
- Probar un bundle externo minimo.
- Probar un bundle con assets reales.
- Confirmar que postproduccion bloquea bundles sin build cloud.
- Confirmar que `final_video_url` queda en `production-videos` y se sincroniza con publicacion.

## Pendientes

- Decidir si la salida sera CloudFront/S3 publico controlado o site Remotion Lambda creado por build.
- Agregar panel de logs detallados si el equipo necesita diagnostico dentro de la UI.
