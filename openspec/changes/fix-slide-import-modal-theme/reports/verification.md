# Evidencia — modal de importación

Fecha: 2026-10-20. Base `82a36ab0`; rama local `codex/fix-slide-import-modal-theme`.

## Diagnóstico corroborado

- `engine-design-system.css` fuerza texto claro y estilos de botones en los descendientes de `.engine-page-hero` con `!important`.
- El diálogo nativo del importador vivía dentro del hero, aunque su top layer lo mostraba por encima de la página. Las reglas seguían afectándolo.
- ConfirmationModal y UserModal utilizan EngineDialog: portal a document.body, tokens de tema, header/footer separados y cuerpo desplazable.
- El fixture anterior solo cargaba utilidades y una variable, sin CSS del producto ni contexto hero. Por eso su validación anterior no acreditaba contraste en la página real.

## Cambios y alcance

- ImportSlideTemplateDialog reutiliza EngineDialog, con CSS Module propio para campos, avisos, carga de archivos y botones.
- Los cambios no modifican EngineDialog ni sus otros consumidores, APIs, selección de plantillas, persistencia o políticas del iframe.
- El fixture actualizado incorpora CSS Modules y engine-design-system.css, monta el disparador dentro del hero y proporciona fuentes de sistema de respaldo a las variables que Next normalmente inyecta.

## Comprobaciones ejecutadas

- `npm run typecheck`: pasó.
- ESLint final de ImportSlideTemplateDialog.tsx y del fixture: pasó, incluida la QA de fuentes de respaldo y contraste del aviso de error.
- Chrome local: pasó el fixture en claro/oscuro a 1440×1000 y 390×844. Comprueba contraste ≥4.5:1 del texto/controles contra la superficie declarada del tema, portal fuera del hero, Escape, retorno del foco, revisión obligatoria, errores, preview sandboxed 1920×1080, guardado simulado y ausencia de desbordamiento horizontal. Comprueba encabezado y botón de guardado visibles al desplazar el cuerpo. Cuatro guardados simulados, cero errores de página.
- Capturas inspeccionadas: `empty-light-1440.png`, `loaded-dark-1440.png` y `loaded-dark-390.png`; los cuatro escenarios generan capturas vacías y con contenido bajo `apps/web/.tmp/html-template-import-theme-qa/`. Resultado estructurado en result.json.
- OpenSpec temporal fijado a 1.8.0: `validate fix-slide-import-modal-theme --strict --no-interactive` pasó.
- `npm run verify:pr`: la ejecución restringida se detuvo por spawnSync git EPERM. Reintentada con permisos, pasaron adapters:check (27), harness:validate y docs:check (99 documentos antes del informe final), y se detuvo porque el ejecutable raíz `openspec` no está instalado. No se presenta la compuerta completa como aprobada ni se modifican sus reglas.
- `git diff --check`: sin errores de espacios en el diff.
- Comprobación documental final: 101 documentos verificados; especificación del cambio válida.

## Límites y reversión

La prueba monta el frontend real con respuestas locales; no se inició sesión en staging ni se validó persistencia remota. No hubo despliegue, publicación ni cambios de datos. La comprobación de contraste no certifica toda la accesibilidad del producto ni fuentes remotas. La primera ejecución del fixture restringida no pudo iniciar esbuild (spawn EPERM); se repitió con permisos para los procesos locales.

La revisión del diff la hizo el mismo agente. Revertir el TSX y retirar su CSS Module revierte esta corrección sin migraciones; el fixture puede conservarse para detectar la regresión.
