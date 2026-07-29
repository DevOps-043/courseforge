# Project Name Globalization Notes

Fecha: 2026-07-29

## Proposito

Documentar las referencias actuales a nombres de producto/marca como `CourseForge`, `Courseforge`, `SofLIA - Engine`, `Soflia Engine`, `Soflia` y `Sofia`, y dejar guardada la intencion de cambio para una rama futura.

La idea propuesta es reemplazar los textos de marca hardcodeados por una fuente unica dentro del codigo, sin usar variables de entorno, porque el proyecto ya esta cerca del limite de variables disponibles.

## Cambio deseado

Crear una configuracion interna versionada, por ejemplo:

```ts
// apps/web/src/config/app.ts
export const APP_CONFIG = {
  name: "SofLIA - Engine",
  shortName: "SofLIA",
  legacyName: "Courseforge",
};
```

Luego, las vistas y textos visibles deberian importar `APP_CONFIG` en lugar de escribir el nombre directamente.

No se recomienda usar una variable de entorno para esto en este momento porque:

- El nombre del proyecto no es un secreto.
- El equipo quiere evitar consumir mas espacio de environment variables.
- Versionar el nombre en codigo hace el cambio mas simple de revisar.
- Permite centralizar el branding sin tocar configuracion externa.

## Estado de la rama al documentar

La rama ya tenia cambios sin commitear relacionados con produccion, assets, providers, HeyGen y configuracion. Por eso este documento se agrego como nota independiente y no se modificaron archivos de codigo.

## Busqueda realizada

Patrones buscados:

- `CourseForge`
- `Courseforge`
- `courseforge`
- `Soflia Engine`
- `SofLIA Engine`
- `Sofia`
- `Sofia` con acento
- `Soflia`
- `SofLIA`

Se excluyeron intencionalmente archivos generados, builds, dependencias y archivos `.env` para no mezclar ruido ni secretos.

## Resumen de hallazgos

### Frontend vivo

En `apps/web/src`, los conteos aproximados por patron fueron:

| Patron | Coincidencias |
| --- | ---: |
| `CourseForge` / `Courseforge` / `courseforge` | 89 |
| `Soflia` / `SofLIA` | 367 |
| `Soflia Engine` / `SofLIA Engine` | 2 |
| `Sofia` | 1 |

Archivos con mayor concentracion:

| Coincidencias | Archivo |
| ---: | --- |
| 37 | `apps/web/src/app/login/auth-bridge.ts` |
| 25 | `apps/web/src/lib/server/env.ts` |
| 24 | `apps/web/src/domains/production/bundle-agent/workflow.service.ts` |
| 20 | `apps/web/src/app/login/__tests__/auth-bridge-contract.test.ts` |
| 17 | `apps/web/src/app/admin/users/users-page-data.ts` |
| 16 | `apps/web/src/domains/publication/lib/soflia-dialogue-runtime-contract.ts` |
| 14 | `apps/web/src/domains/production/bundle-agent/conversation.service.ts` |
| 13 | `apps/web/src/domains/materials/types/materials.types.ts` |
| 13 | `apps/web/src/app/downloads/page.tsx` |
| 13 | `apps/web/src/domains/publication/lib/publication-payload-builders.ts` |

Referencias visibles detectadas:

| Archivo | Linea | Referencia |
| --- | ---: | --- |
| `apps/web/src/app/layout.tsx` | 10 | metadata title `SofLIA - Engine` |
| `apps/web/src/app/page.tsx` | 36 | texto principal `SofLIA - Engine` |
| `apps/web/src/app/page.tsx` | 96 | texto descriptivo con `SofLIA - Engine` |
| `apps/web/src/components/layout/SharedSidebarLayout.tsx` | 150 | marca del sidebar `SofLIA Engine` |
| `apps/web/src/lib/lia-app-context.ts` | 1 | comentario de contexto `SofLIA - Engine` |
| `apps/web/src/lib/lia-app-context.ts` | 4 | titulo de prompt `SofLIA - Engine` |
| `apps/web/src/lib/lia-app-context.ts` | 6 | descripcion de Lia en `SofLIA - Engine` |
| `apps/web/src/app/login/LoginForm.tsx` | 221 | alt text `SofLIA - Engine Network` |
| `apps/web/src/app/admin/users/UserModal.tsx` | 220 | placeholder de ejemplo `Sofia` |

### Backend Express

En `apps/api/src`, los conteos aproximados fueron:

| Patron | Coincidencias |
| --- | ---: |
| `CourseForge` / `Courseforge` / `courseforge` | 34 |
| `Soflia` / `SofLIA` | 11 |

Archivos con mayor concentracion:

| Coincidencias | Archivo |
| ---: | --- |
| 14 | `apps/api/src/features/production/template-cloud-build.service.ts` |
| 6 | `apps/api/src/features/production/aws-credentials-env.ts` |
| 4 | `apps/api/src/features/production/desktop-worker.service.ts` |
| 3 | `apps/api/src/features/production/production.controller.ts` |
| 3 | `apps/api/src/features/production/__tests__/remotion-render-config.test.ts` |
| 3 | `apps/api/src/features/production/__tests__/template-manifest.service.test.ts` |

Estas referencias parecen mayormente tecnicas: nombres de variables, buckets, paths, plantillas, user agents, issuers JWT o compatibilidad con integraciones existentes.

### Documentacion

En `docs/`, los archivos con mayor concentracion fueron:

| Coincidencias | Archivo |
| ---: | --- |
| 21 | `docs/course-engine-soflia-dialogue-generation.md` |
| 21 | `docs/OPEN_DESIGN_TO_COURSEFORGE_VIDEO_AUTOMATION_ANALYSIS.md` |
| 20 | `docs/HEYGEN_API_INTEGRATION_RESEARCH.md` |
| 19 | `docs/OPEN_DESIGN_VIDEO_RUNTIME_RESEARCH_BRIEF.md` |
| 16 | `docs/SOFLIA_DIALOGUE_PROMPT_NORMALIZATION_RUNBOOK.md` |
| 15 | `docs/google_drive_integration_research.md` |
| 14 | `docs/SCORM_INTEGRATION_ANALYSIS.md` |
| 13 | `docs/CLOUD_RUN_REMOTION_DEPLOYMENT.md` |

Tambien hay muchas referencias en archivos Markdown de la raiz, incluyendo `README.md`, `CLAUDE.md`, `AGENTS.md`, planes historicos e informes de integracion.

## Clasificacion recomendada

### 1. Marca visible para usuarios

Debe migrarse primero a `APP_CONFIG`.

Ejemplos:

- Titulos de pagina y metadata.
- Home/login/sidebar.
- Textos de onboarding, error, privacidad y descargas.
- Alt text de imagenes.
- Copys de administracion visibles.
- Contexto visible o semi-visible que Lia use para describir la app.

### 2. Prompt/contexto de Lia

Debe migrarse con cuidado. Si Lia debe decir el nombre actual del producto, puede usar `APP_CONFIG.name`. Si el prompt documenta integraciones o marcas externas, no todo debe cambiarse automaticamente.

### 3. Integracion con Soflia

No todo lo que dice `Soflia` es branding interno. Muchas referencias parecen representar el destino de publicacion, API externa, runtime de dialogos, proveedor o plataforma conectada.

Estas referencias deben revisarse una por una antes de renombrar.

### 4. Identificadores tecnicos heredados

No deben cambiarse solo por branding si forman parte de contratos existentes:

- Variables de entorno como `COURSEFORGE_*` o `SOFLIA_*`.
- Issuers JWT.
- Nombres de buckets, manifests, templates o rutas externas.
- Eventos del navegador como `courseforge:admin-focus-mode`.
- IDs de composiciones, nombres de jobs o artefactos generados.
- Tests que validan compatibilidad con nombres legacy.

Para esos casos conviene mantener alias legacy o documentar una migracion tecnica separada.

### 5. Documentacion historica

Puede actualizarse al final o dejarse como referencia historica. No es necesario bloquear el cambio de UI por documentos viejos.

## Plan futuro sugerido

1. Crear `apps/web/src/config/app.ts` con `APP_CONFIG`.
2. Cambiar primero referencias visibles de UI y metadata.
3. Cambiar prompts de Lia que describen el nombre actual de la app.
4. Mantener `COURSEFORGE_*`, `SOFLIA_*` y otros contratos tecnicos hasta tener una migracion especifica.
5. Agregar tests simples para metadata/layout si ya existe patron de testing aplicable.
6. Revisar documentacion al final, separando docs historicos de docs vigentes.

## Nota importante

Este documento no implementa el cambio. Solo deja inventariado el estado actual y la decision de preferir configuracion interna en codigo sobre environment variables.
