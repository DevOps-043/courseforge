# Evidencia de identidad global

Fecha: 2026-10-27. Base: `2750311a` en staging; rama local `codex/global-branding`. Árbol limpio al comenzar. Implementación sin commit ni despliegue; el nuevo nombre aún no fue definido.

## Resultado funcional

- `apps/web/src/config/app.ts` define identidad pública e inmutable: nombre, nombre corto, descripción, logo, icono, contacto e identidad separada del asistente.
- UI, metadata, ventanas OAuth, prompts predeterminados, defaults de slides/bundles, manifiestos y exportaciones nuevas consumen la configuración.
- El icono conserva sus bytes y URL `/icon.png`; vive en `public/` y se declara desde metadata para permitir cambiarlo por configuración.
- No se reescriben documentos, prompts personalizados, snapshots o marcas aportadas por usuarios. Proveedores externos y contratos de sesión, organización, almacenamiento y preview conservan identidad.
- Los literales restantes de producto en código activo tienen excepciones específicas: configuración, prefijo histórico de carpetas cloud y user agent. Los comentarios históricos no se consideran presentación.

## Verificaciones

| Comando o revisión | Resultado |
| --- | --- |
| `npm run test:branding` | 5/5 aprobadas; incluye marca alternativa, SSR de privacidad, metadata/correo, prompts, schema, proveedor, escape OAuth y auditoría AST de literales |
| `npm run typecheck` | Aprobado |
| ESLint focalizado sobre los 70 archivos TS/TSX afectados, con la configuración existente y `--quiet` | Aprobado; no se relajaron reglas |
| `npm run test:remotion --workspace=apps/web` | Suite completa aprobada después de migrar defaults y servicios de bundles |
| `npm run test:hyperframes --workspace=apps/web` | Compila y ejecuta pruebas iniciales; se detiene en `composition-agent-model-output.test.js` por `MODULE_NOT_FOUND: @/lib/server/outbound-http` |
| Preview compiler, telemetry, editor-patch y standalone-media compilados, ejecutados con `node --test` | 140/140 aprobadas |
| `npm run docs:audit` | Auditoría generada; README y contexto contrastados y actualizados para el alcance |
| `adapters:check`, `harness:validate`, `docs:check` dentro de `verify:pr` | Aprobados |
| `npm run test:harness` | 20/20 aprobadas al repetir fuera del sandbox; el primer intento no podía crear `.git/config` en fixtures temporales |
| OpenSpec 1.8.0: `validate global-branding --type change --strict --no-interactive` | Aprobado |
| OpenSpec 1.8.0: `validate --all --strict --no-interactive` | 18 aprobados y 1 fallo en `diagnose-font-catalog`, sin cambios en ese directorio |
| `npm run verify:pr` | Incompleto: la instalación local carece del ejecutable OpenSpec; se validó mediante `npm exec` con la misma versión declarada |
| `npm run verify` | Se detiene en lint global: 1,646 errores fuera del conjunto modificado, incluidos artefactos generados en `dist/` y `.tmp/`; pasos posteriores de esa cadena no ejecutados |
| `git diff --check` | Aprobado |

Las salidas completas locales se conservaron en `.tmp/branding-*.log` (archivos temporales ignorados); esta tabla conserva el resumen durable.

## Revisión adversarial

Revisión realizada por el mismo agente, sin atribuir independencia. Se revisaron diff, directivas Next.js, imports de jobs, caracteres especiales, defaults persistidos, IDs de proveedor, namespaces y fuentes HTML. Se corrigieron la posición de `use client` en home, el escape del mensaje de error OAuth y la prioridad del icono de archivo sobre metadata. Se agregó truncado con título completo para nombres largos en el sidebar.

El import de `composition-agent-provider.service.ts` que detiene HyperFrames ya existe idéntico en HEAD; no se modificó para ampliar el alcance. Los errores globales de lint y la especificación `diagnose-font-catalog` requieren una corrección propia. Ninguna regla ni suite se omitió para declarar la compuerta aprobada.

## Límites y operación

No se ejecutaron build de producción, QA visual autenticada, render cloud, generación pagada, publicación ni migraciones. La configuración necesita rebuild para publicarse. Los colores/tipografías mantienen los tokens de tema existentes; el cambio de identidad visual final requiere los assets y decisiones de producto.

Reversión: revertir el diff de esta rama y devolver el icono a su ruta anterior; no hay migración de datos. Mantener OpenSpec activo hasta integrar el cambio.
