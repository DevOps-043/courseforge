# LMS – Daily Pulse | 29 Marzo 2026

**Estado:** 🟢 (Sistema modular de generación de materiales implementado, UI de iteración selectiva completada)

## 1. Reporte Diario (Versión Corta)

- **✅ Done hoy:**
  - **[NUEVO]** Implementación del sistema modular de prompts para generación de materiales: descomposición del prompt monolítico `MATERIALS_GENERATION` en 9 prompts independientes por tipo de componente (`MATERIALS_SYSTEM`, `MATERIALS_DIALOGUE`, `MATERIALS_READING`, `MATERIALS_QUIZ`, `MATERIALS_VIDEO_THEORETICAL`, `MATERIALS_VIDEO_DEMO`, `MATERIALS_VIDEO_GUIDE`, `MATERIALS_DEMO_GUIDE`, `MATERIALS_EXERCISE`).
  - **[NUEVO]** Creación de `prompt-resolver.service.ts`: Servicio de resolución de prompts con cadena de fallback de 3 niveles (organización → global → hardcoded default), ensamblaje de prompts con JSON Schema por tipo de componente.
  - **[NUEVO]** Creación de `materials-generation.prompts.modular.ts`: Archivo de defaults hardcoded para los 9 prompts modulares, con mapeo `COMPONENT_PROMPT_CODES` y exportación del prompt legacy para retrocompatibilidad.
  - **[NUEVO]** Creación de `materials-generation.prompts.legacy.ts`: Wrapper de retrocompatibilidad para el prompt monolítico original.
  - **[NUEVO]** Migración SQL `20260327120000_modular_material_prompts.sql`: Inserta los 9 prompts modulares en `system_prompts` con `ON CONFLICT DO NOTHING` para ser idempotente.
  - Refactorización de `IterationPanel.tsx`: Implementación de selector de componentes por tipo (chips con checkboxes), lógica de "Todos" vs selección individual, botones de regeneración selectiva con conteo dinámico.
  - Refactorización de `SystemPromptsManager.tsx`: UI mejorada con layout sidebar + editor, indicador visual de prompts personalizados (`is_org_override`), modal de confirmación para reset a default, y feedback de estado con auto-dismiss.
  - Refactorización de `settings/actions.ts`: Lógica de merge globals + org-specific en `getSystemPromptsAction`, creación de `resetPromptToDefaultAction` para restaurar prompts al default global, y corrección del flujo de upsert con `onConflict`.
  - Actualización de `materials-generation-helpers.ts` y `materials-generation-runtime.ts` para integración con el nuevo prompt resolver.
  - Ajustes menores en `materials.actions.ts`, `useMaterials.ts`, `materials.service.ts`, `LessonMaterialsCard.tsx`, `MaterialDetailsModal.tsx`.
- **🧪 Ready for QA:**
  - Flujo completo de generación modular de materiales (resolución de prompts desde DB → ensamblaje → envío a Gemini).
  - UI de iteración selectiva por tipo de componente.
  - Administración de prompts modulares desde `/admin/settings` (editar, personalizar por org, restaurar a default).
- **🚨 P0 abiertos:** Ninguno detectado.
- **🔧 Foco siguiente:** Validación end-to-end de generación de materiales con prompts modulares en entorno de producción; testing de iteración selectiva por componente individual.
- **⚠️ Bloqueo/Riesgo:** Ninguno.
- **🧭 Acción requerida:** QA del flujo de generación modular completo y de la UI de iteración selectiva.
- **🔗 Tablero + evidencia:** https://www.notion.so/305c808734dc80b5a238df6ab222aa4a?v=305c808734dc8017a382000cc3ab21d6

---

## 2. Resumen Extenso (Detalles Técnicos)

### Contexto: Modularización del Sistema de Prompts de Materiales

El trabajo del día se centró en la **descomposición del prompt monolítico de generación de materiales** en un sistema modular de prompts independientes por tipo de componente. Esto permite:

1. **Edición granular**: Los administradores pueden personalizar el prompt de cada tipo de componente (QUIZ, READING, VIDEO, etc.) de forma independiente sin afectar los demás.
2. **Iteración selectiva**: Los revisores pueden regenerar solo los componentes específicos de una lección que necesitan mejoras, sin regenerar todo.
3. **Multi-tenancy**: Cada organización puede tener sus propias versiones de prompts, con fallback automático a los defaults globales.

### Nuevo Servicio: Prompt Resolver (`prompt-resolver.service.ts`)

Se creó un servicio centralizado (~372 líneas) que actúa como capa de resolución de prompts con las siguientes responsabilidades:

| Función | Descripción |
|---|---|
| `resolvePrompts()` | Resuelve prompts desde DB con cadena de fallback: org → global → hardcoded |
| `assemblePrompt()` | Ensambla el prompt final concatenando sistema + componentes + JSON Schema |
| `fetchPromptsFromDb()` | Helper interno que consulta `system_prompts` con filtros por org y código |

**Cadena de fallback (3 niveles):**
1. Prompt específico de la organización (`organization_id = current org`)
2. Prompt global (`organization_id = null`)
3. Default hardcoded en `materials-generation.prompts.modular.ts`

El servicio también incluye **OUTPUT_SCHEMAS** — fragmentos JSON Schema por tipo de componente (DIALOGUE, READING, QUIZ, DEMO_GUIDE, EXERCISE, VIDEO_THEORETICAL, VIDEO_DEMO, VIDEO_GUIDE) que se inyectan en el prompt final para forzar la estructura de salida correcta.

### Prompts Modulares (9 nuevos prompts)

Se descompuso el prompt monolítico original en 9 prompts especializados:

| Código | Tipo | Propósito |
|---|---|---|
| `MATERIALS_SYSTEM` | Base | Reglas globales, formato JSON, accesibilidad, coherencia Bloom |
| `MATERIALS_DIALOGUE` | Componente | Diálogos interactivos con SofLIA |
| `MATERIALS_READING` | Componente | Lecturas de refuerzo (~750 palabras, HTML) |
| `MATERIALS_QUIZ` | Componente | Cuestionarios formativos (MCQ, V/F, completar) |
| `MATERIALS_VIDEO_THEORETICAL` | Componente | Videos teóricos con guion y storyboard |
| `MATERIALS_VIDEO_DEMO` | Componente | Videos demostrativos con capturas |
| `MATERIALS_VIDEO_GUIDE` | Componente | Videos guía con ejercicio paralelo |
| `MATERIALS_DEMO_GUIDE` | Componente | Guías paso a paso con screenshots |
| `MATERIALS_EXERCISE` | Componente | Ejercicios prácticos independientes |

Cada prompt contiene: cuándo usarlo, objetivos Bloom, estructura orientativa, y requerimientos de generación. Los prompts de video incluyen la "Regla de Oro" para storyboards (narration_text debe ser el guión literal).

### UI: IterationPanel (Iteración Selectiva por Componente)

Se amplió significativamente el componente `IterationPanel.tsx` (+99 líneas) para soportar:

- **Selector de componentes con chips**: Muestra los tipos de componentes disponibles en la lección como chips seleccionables con `CheckSquare`/`Square` icons.
- **Modo "Todos"**: Chip "Todos" seleccionado por defecto que regenera todos los componentes.
- **Selección individual**: Al deseleccionar "Todos", se pueden elegir componentes específicos (ej. solo QUIZ y READING).
- **Botón dinámico**: El texto del botón cambia según la selección: "Regenerar Todo" vs "Regenerar N componente(s)".
- **Feedback contextual**: Mensaje informativo cuando hay componentes seleccionados ("Solo se regenerarán los componentes seleccionados. Los demás se mantendrán intactos.").

### UI: SystemPromptsManager (Administración de Prompts)

Se refactorizó completamente `SystemPromptsManager.tsx` (+273 líneas):

- **Layout split-panel**: Sidebar con lista de prompts + editor de texto a la derecha.
- **Indicador de personalización**: Dot amarillo (`is_org_override`) junto a prompts que tienen una versión personalizada por la organización.
- **Badge "Personalizado"**: Etiqueta visual en el header del editor para prompts con override de org.
- **Modal de reset**: `ResetConfirmModal` con confirmación para restaurar al default global (elimina la fila org-specific de `system_prompts`).
- **Feedback con auto-dismiss**: Mensajes de éxito/error con animación y dismiss automático usando `STATUS_MESSAGE_DISMISS_DELAY_MS`.

### Server Actions (Admin Settings)

Se refactorizaron significativamente las acciones de servidor:

- **`getSystemPromptsAction()`**: Ahora implementa merge correcto de prompts globales + org-specific. Busca primero los globales, luego los de la org, y hace overlay por `code`. Incluye prompts que solo existen a nivel org.
- **`updateSystemPromptAction()`**: Cuando se edita un prompt global desde una org, crea un override org-specific via `upsert` con `onConflict: 'code,version,organization_id'` en lugar de mutar el global.
- **`resetPromptToDefaultAction()`** [NUEVO]: Elimina el override org-specific para un código dado, restaurando el fallback al default global.

### Migración SQL

La migración `20260327120000_modular_material_prompts.sql` (316 líneas) inserta los 9 prompts modulares en la tabla `system_prompts` con:
- `ON CONFLICT (code, version, organization_id) DO NOTHING` para idempotencia.
- Sin `organization_id` (prompts globales/default).
- Contenido completo de cada prompt usando dollar-quoting (`$$...$$`).

### Background Functions

- **`materials-generation-background.ts`**: Actualizado para usar el nuevo `prompt-resolver.service` en lugar del prompt monolítico hardcoded.
- **`materials-generation-helpers.ts`**: Integración con `resolvePrompts()` y `assemblePrompt()` para construir el prompt final basado en los tipos de componente solicitados.
- **`materials-generation-runtime.ts`**: Ajustes en el runtime para pasar los `componentTypes` filtrados al resolver.

### Resumen Cuantitativo

| Métrica | Valor |
|---|---|
| Archivos modificados | 12 |
| Archivos nuevos | 4 |
| Total archivos tocados | 16 (+ 2 reportes) |
| Líneas añadidas | ~1,589 |
| Líneas eliminadas | ~145 |
| Dominios impactados | Materials, Prompts, Admin Settings, Background Functions |
| Commit | `9319173` |

---

_Reporte generado por Antigravity (Assistant)._
