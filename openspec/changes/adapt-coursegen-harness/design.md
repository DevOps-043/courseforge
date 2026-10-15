## Context

El receptor tiene npm workspaces apps/web y apps/api, pruebas compiladas a .tmp
con TypeScript y Node, ESLint configurado, guardas de migraciones, compliance y
QA visual en CI. La rama principal de trabajo tiene cambios ajenos sin commit.

## Goals / Non-Goals

Objetivo: fuente canónica, adaptación por dominio y evidencia ejecutable.
No objetivos: importar el arnés runtime Electron, reescribir el pipeline educativo
o normalizar toda la documentación histórica.

## Decisions

- Usar rama codex/coursegen-harness en worktree desde staging para preservar trabajo.
- Conservar el contexto operativo existente en docs/architecture/system-context.md
  y archivar guías reemplazadas; CLAUDE.md y codex.md pasan a ser routers.
- Mantener las 17 áreas del estándar maestro con contratos reales del receptor.
- Generar wrappers ordinarios en .codex/.claude/.agents sin symlinks; comparar el
  conjunto completo para detectar wrappers huérfanos sin borrarlos automáticamente.
- Registro JSON con esquema comprobado localmente, roles documentales y declaración
  explícita de que no autoriza herramientas runtime.
- OpenSpec fijado como devDependency; se usa su CLI local sin instalación global.
- docs:check valida el catálogo canónico nuevo y los enlaces locales nuevos respecto
  a HEAD, sin convertir enlaces históricos rotos en un bloqueo artificial.
- verify:harness valida solo infraestructura de agentes; verify:pr ejecuta además
  npm run verify, cuya secuencia de controles de producto se conserva.
- CI añade verificación de arnés antes de los controles existentes y conserva
  compliance, QA multimedia, build y auditoría.
- No generar wrappers de skills OpenSpec por una segunda vía: workflows delgados
  invocan el CLI local y artefactos; las skills de proceso explican las invariantes.

## Risks / Trade-offs

Las reglas no son permisos ejecutables. Las pruebas del harness usan repositorios
temporales y no llaman proveedores externos. El validador de enlaces no prueba
disponibilidad web ni semántica de documentación. La CLI OpenSpec añade dependencias
de desarrollo, no runtime. Las pruebas del producto pueden revelar deuda de la base.

## Migration Plan

Activar fuentes, generar wrappers, validar estructura y errores intencionales,
ejecutar la compuerta local y entregar diff/evidencia. Mantener el cambio activo
hasta integrarlo; no archivar anticipadamente. Rollback: revertir el commit de
infraestructura y restaurar lockfile/routers/CI; no hay migración de datos.
