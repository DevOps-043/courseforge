# Auditoria y plan de mejora del sistema configurable de prompts

Fecha: 2026-07-14  
Fuente de verdad de calidad: `prompt_maestro.md`  
Alcance: `system_prompts`, `model_settings`, UI de `/admin/settings`, prompts legacy y versionado por organizacion.

## 1. Entendimiento del objetivo

Se requiere ordenar el sistema configurable de IA por el flujo real del pipeline, eliminar o aislar prompts legacy que aun puedan aparecer a usuarios, versionar cambios de prompts con trazabilidad humana, actualizar la lista de modelos Gemini vigentes y agregar ayuda contextual no tecnica para cada prompt/configuracion editable.

La meta no es solo reacomodar la pantalla. El cambio debe cerrar el ciclo completo:

- Catalogo de prompts alineado al orden real de uso.
- Base de datos sin prompts obsoletos expuestos por accidente.
- Historial auditable de cambios.
- UI comprensible para administradores.
- Runtime sin regresiones en resolucion de prompts por organizacion.

## 2. Diagnostico tecnico actual

### 2.1 Hallazgos principales

| Area | Estado actual | Riesgo |
| --- | --- | --- |
| Orden de prompts | `getSystemPromptsAction()` ordena por `code` y `version`; la UI lista por orden alfabetico. | Los usuarios editan prompts fuera del contexto del paso donde impactan. |
| Separacion modelo/prompt | `CurationSettingsManager` muestra configuraciones de modelos; `SystemPromptsManager` muestra prompts aparte. | El admin no ve juntos el modelo y los prompts que controlan el mismo paso. |
| Versionado | `updateSystemPromptAction()` actualiza la fila org-specific en sitio o hace upsert de override. | No hay historial real por cambio; una version puede sobrescribirse sin trazabilidad suficiente. |
| Responsable | `system_prompts` solo guarda `created_at` y `updated_at`. | No se puede saber quien modifico un prompt. |
| Legacy | `MATERIALS_GENERATION` sigue sembrado en migraciones y triggers de defaults por organizacion. | Puede aparecer a organizaciones nuevas o usuarios aunque el runtime moderno use prompts modulares. |
| Prompts modulares | `MATERIALS_SYSTEM` + prompts por componente se resuelven desde DB con fallback hardcoded. | Correcto como arquitectura base, pero falta exposicion ordenada y metadata de proposito. |
| Produccion visual | Existen `VIDEO_BROLL_PROMPTS` y `CLIP_GENERATION_PROMPTS`. | Si no se incluyen en el nuevo registry, la Fase 6 queda parcialmente fuera del control administrativo. |
| Modelos Gemini | La UI lista modelos 3.x/2.5, pero hay valores probablemente obsoletos o no canonicos, por ejemplo `gemini-3-flash`. | El usuario puede guardar un modelo no disponible para la API. |

### 2.2 Evidencia de codigo relevante

| Evidencia | Archivo |
| --- | --- |
| Resolucion de prompts de materiales por org -> global -> fallback hardcoded. | `apps/web/src/shared/config/prompts/prompt-resolver.service.ts` |
| Mapeo de componente a prompt modular. | `apps/web/src/shared/config/prompts/materials-generation.prompts.modular.ts` |
| Acciones admin de prompts/modelos y orden alfabetico por query. | `apps/web/src/app/admin/settings/actions.ts` |
| UI actual de prompts separada de modelos. | `apps/web/src/domains/prompts/components/SystemPromptsManager.tsx` |
| UI actual de modelos por setting type. | `apps/web/src/domains/curation/components/CurationSettingsManager.tsx` |
| Seed legacy inicial de `MATERIALS_GENERATION`. | `supabase/migrations/20240117_create_system_prompts.sql` |
| Trigger de nuevas organizaciones que todavia inserta `MATERIALS_GENERATION`. | `supabase/migrations/20260331120000_modularize_pipeline_model_settings.sql` |
| Prompts modulares de materiales. | `supabase/migrations/20260327120000_modular_material_prompts.sql` |
| Prompt de B-roll configurable. | `supabase/migrations/20260402120000_add_video_broll_prompt.sql` |
| Prompt de clips configurable. | `supabase/migrations/20260604150000_add_clip_generation_prompt_and_bucket.sql` |

## 3. Catalogo operativo propuesto

Este registry debe ser la fuente unica para ordenar UI, explicar propositos y decidir que prompt pertenece a cada paso.

| Orden | Paso UI | `model_settings.setting_type` | Prompts asociados | Estado | Proposito no tecnico |
| --- | --- | --- | --- | --- | --- |
| 1 | Base del curso | `ARTIFACT_BASE` | Ninguno configurable actualmente | Activo | Define la idea base, objetivos iniciales y alternativas de nombre. |
| 2 | Syllabus | `SYLLABUS` | Ninguno configurable actualmente | Activo | Convierte la idea en modulos y lecciones. |
| 3 | Plan instruccional | `INSTRUCTIONAL_PLAN` | `INSTRUCTIONAL_PLAN` | Activo | Decide que debe aprender el estudiante y que componentes tendra cada leccion. |
| 4 | Curacion de fuentes | `CURATION` | `CURATION_PLAN` | Activo | Busca y estructura fuentes confiables para alimentar materiales. |
| 5 | Materiales | `MATERIALS` | `MATERIALS_SYSTEM`, `MATERIALS_DIALOGUE`, `MATERIALS_READING`, `MATERIALS_QUIZ`, `MATERIALS_VIDEO_THEORETICAL`, `MATERIALS_VIDEO_DEMO`, `MATERIALS_VIDEO_GUIDE`, `MATERIALS_DEMO_GUIDE`, `MATERIALS_EXERCISE` | Activo | Genera el contenido final de cada leccion. |
| 6 | Produccion visual | Pendiente: usar `MATERIALS` o crear `VISUAL_PRODUCTION` | `VIDEO_BROLL_PROMPTS`, `CLIP_GENERATION_PROMPTS` | Activo | Convierte storyboards en prompts visuales para B-roll o clips. |
| Legacy | Materiales monoliticos | N/A | `MATERIALS_GENERATION` | Deprecar | Prompt antiguo previo a la modularizacion. No debe aparecer en el flujo principal. |

## 4. Decision sobre prompts legacy

### 4.1 No borrar directamente en la primera migracion

`MATERIALS_GENERATION` debe pasar por una fase de deprecacion controlada porque:

- Existe en seeds historicos.
- Aun aparece en triggers de nuevas organizaciones.
- Algunas organizaciones pueden tener overrides propios.
- Hay migraciones posteriores que lo actualizan junto con prompts activos.

### 4.2 Accion recomendada

1. Agregar metadata de estado (`lifecycle_status`) con valores `ACTIVE`, `LEGACY`, `DEPRECATED`, `ARCHIVED`.
2. Marcar `MATERIALS_GENERATION` como `LEGACY` o `DEPRECATED`.
3. Ocultarlo de la UI principal.
4. Corregir `populate_default_org_settings()` para que nuevas organizaciones reciban prompts modulares, no el monolitico.
5. Crear una vista o filtro admin "Legacy / Archivados".
6. Ejecutar auditoria de BD antes de borrar:

```sql
select code, version, organization_id, is_active, count(*)
from public.system_prompts
where code = 'MATERIALS_GENERATION'
group by code, version, organization_id, is_active
order by organization_id nulls first, version;
```

7. Solo eliminar fisicamente si:
   - No existe consumidor runtime.
   - No aparece en defaults de nuevas organizaciones.
   - No hay organizaciones usando ese prompt como unica configuracion de materiales.
   - Existe respaldo o migracion reversible.

## 5. Modelo de datos propuesto

### 5.1 Cambios minimos a `system_prompts`

Agregar columnas:

```sql
alter table public.system_prompts
add column if not exists lifecycle_status text not null default 'ACTIVE',
add column if not exists display_order integer,
add column if not exists pipeline_step text,
add column if not exists purpose text,
add column if not exists impact_summary text,
add column if not exists updated_by uuid null references public.profiles(id),
add column if not exists change_summary text,
add column if not exists supersedes_prompt_id uuid null references public.system_prompts(id);
```

Checks sugeridos:

```sql
alter table public.system_prompts
add constraint system_prompts_lifecycle_status_check
check (lifecycle_status in ('ACTIVE', 'LEGACY', 'DEPRECATED', 'ARCHIVED'));
```

### 5.2 Versionado recomendado

La accion de guardar un prompt no debe sobrescribir el contenido historico. Debe:

1. Leer la version activa actual por `code + organization_id`.
2. Desactivar la version anterior o dejarla como historica.
3. Insertar una nueva fila con version siguiente.
4. Guardar `updated_by`, `change_summary`, `supersedes_prompt_id`.
5. Resolver en runtime solo la version activa mas reciente.

Ejemplo de estrategia de version:

- Version semantica administrada por sistema: `1.0.1`, `1.0.2`, etc.
- Si el usuario restaura una version anterior, no se muta esa version: se crea una nueva version activa con el contenido restaurado.

## 6. Modelos Gemini vigentes

La lista debe vivir centralizada, por ejemplo:

`apps/web/src/shared/config/ai/gemini-models.ts`

Modelos de texto recomendados para el selector, verificados contra documentacion oficial de Google AI Models al 2026-07-14:

| Valor API | Etiqueta | Estado UI | Uso recomendado |
| --- | --- | --- | --- |
| `gemini-3.5-flash` | Gemini 3.5 Flash | Stable | Paso con alta calidad y buen rendimiento. |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | Stable | Alto volumen, costo bajo, baja latencia. |
| `gemini-3.1-pro` | Gemini 3.1 Pro | Preview | Tareas complejas si se acepta riesgo de preview. |
| `gemini-3-flash` | Gemini 3 Flash | Preview | Solo si la API del proyecto lo soporta. |
| `gemini-2.5-pro` | Gemini 2.5 Pro | Stable | Curacion y materiales complejos. |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Stable | Default balanceado. |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite | Stable | Fallback economico/rapido. |

Notas:

- La documentacion oficial marca `gemini-2.0-flash` como modelo previo/deprecado o apagado; no debe ser fallback nuevo.
- La UI debe distinguir `Stable`, `Preview`, `Deprecated`.
- Guardar un modelo `Preview` deberia mostrar advertencia.
- Los defaults nuevos no deben usar modelos apagados.

## 7. Rediseño UI propuesto

### 7.1 Nueva estructura de `/admin/settings`

Cambiar de:

- Prompts del Sistema
- Configuracion de Modelos

A:

- Configuracion IA por paso
  - Base del curso
  - Syllabus
  - Plan instruccional
  - Curacion de fuentes
  - Materiales
  - Produccion visual
- Legacy / Archivados

### 7.2 Contenido de cada paso

Cada paso debe mostrar:

- Modelo principal.
- Modelo fallback.
- Temperatura.
- Nivel de pensamiento.
- Prompts usados por ese paso.
- Boton `?` por cada campo configurable.
- Ultima modificacion con fecha, hora y responsable.
- Historial de versiones.

### 7.3 Ayudas `?` no tecnicas

Ejemplos:

| Configuracion | Texto para ayuda |
| --- | --- |
| Modelo principal | "Es el modelo que se usa primero para este paso. Cambiarlo puede mejorar calidad, velocidad o costo." |
| Modelo fallback | "Es el modelo de respaldo si el principal falla o no responde correctamente." |
| Temperatura | "Controla que tan creativa o conservadora sera la respuesta. Valores bajos son mas consistentes." |
| `INSTRUCTIONAL_PLAN` | "Define que aprendera el estudiante en cada leccion y que tipo de materiales se generaran." |
| `CURATION_PLAN` | "Define como se buscan y justifican las fuentes que alimentan los materiales." |
| `MATERIALS_SYSTEM` | "Contiene reglas generales que todos los materiales deben respetar." |
| `MATERIALS_QUIZ` | "Define como se crean las preguntas, respuestas y retroalimentacion del quiz." |
| `VIDEO_BROLL_PROMPTS` | "Convierte escenas del storyboard en instrucciones visuales para generar B-roll." |
| `CLIP_GENERATION_PROMPTS` | "Convierte el guion en descripciones visuales para buscar o generar clips de apoyo." |

## 8. Plan de implementacion por fases

### Fase 0 - Auditoria y seguridad

Objetivo: confirmar el inventario antes de tocar datos.

Tareas:

1. Crear script o server action interna para listar prompts por `code`, `organization_id`, `is_active`, `updated_at`.
2. Confirmar codigos consumidos por runtime:
   - `INSTRUCTIONAL_PLAN`
   - `CURATION_PLAN`
   - `MATERIALS_SYSTEM`
   - `MATERIALS_*`
   - `VIDEO_BROLL_PROMPTS`
   - `CLIP_GENERATION_PROMPTS`
3. Confirmar codigos solo seed/legacy:
   - `MATERIALS_GENERATION`
4. Exportar resultado antes de migrar.

Criterio de cierre:

- Tabla de prompts clasificada por estado y accion.

### Fase 1 - Registry central

Objetivo: tener una fuente unica para orden, proposito y agrupacion.

Tareas:

1. Crear `apps/web/src/shared/config/ai/pipeline-ai-registry.ts`.
2. Mover `MODEL_SETTING_TYPES`, orden, metadata y prompts asociados al registry.
3. Usar el registry en `getModelSettingsAction()`.
4. Usar el registry en la UI.

Criterio de cierre:

- La UI ya no depende de orden alfabetico ni arrays duplicados.

### Fase 2 - Modelos Gemini centralizados

Objetivo: eliminar opciones obsoletas o no canonicas.

Tareas:

1. Crear `apps/web/src/shared/config/ai/gemini-models.ts`.
2. Reemplazar opciones hardcodeadas en `CurationSettingsManager`.
3. Actualizar defaults en:
   - `apps/web/src/app/admin/settings/actions.ts`
   - `apps/web/src/lib/server/model-settings.ts`
   - `apps/web/netlify/functions/shared/bootstrap.ts` si aplica por defaults locales.
4. Migrar filas activas con fallback `gemini-2.0-flash` hacia `gemini-2.5-flash` o modelo vigente aprobado.

Criterio de cierre:

- Ninguna nueva configuracion usa modelos apagados como default.

### Fase 3 - Versionado auditable

Objetivo: guardar historial real.

Tareas:

1. Crear migracion con metadata de auditoria.
2. Cambiar `updateSystemPromptAction()` para insertar nueva version.
3. Agregar `change_summary` obligatorio o sugerido en UI.
4. Mostrar historial por prompt.
5. Agregar accion "Restaurar esta version" que crea nueva version activa.

Criterio de cierre:

- Se puede ver fecha, hora, responsable y contenido anterior.

### Fase 4 - UI por paso

Objetivo: unir modelos y prompts en el contexto correcto.

Tareas:

1. Crear componente `PipelineAiSettingsManager`.
2. Reutilizar controles actuales de modelo y editor de prompt.
3. Agregar tooltips `?`.
4. Mover prompts legacy a seccion separada.
5. Mantener compatibilidad con rutas tenant-aware `/[empresaSlug]/admin/settings`.

Criterio de cierre:

- Un admin entiende que cambia en cada paso sin conocer nombres internos.

### Fase 5 - Limpieza legacy en BD

Objetivo: evitar que usuarios sigan viendo prompts obsoletos.

Tareas:

1. Corregir `populate_default_org_settings()`.
2. Insertar defaults modulares para organizaciones que no los tengan.
3. Marcar `MATERIALS_GENERATION` como `DEPRECATED`.
4. Ocultarlo de UI principal.
5. Despues de periodo de observacion, decidir borrado fisico o archivado permanente.

Criterio de cierre:

- Ninguna organizacion nueva recibe `MATERIALS_GENERATION` como prompt editable principal.

### Fase 6 - Pruebas y rollout

Validaciones automaticas:

```bash
npx tsc -p apps/web/tsconfig.json --noEmit
npm run test --workspace=apps/web
```

Validaciones manuales:

1. Ver `/admin/settings`.
2. Ver `/{empresaSlug}/admin/settings`.
3. Editar un prompt global desde una organizacion y confirmar que crea override/version nueva.
4. Restaurar una version anterior.
5. Crear o simular nueva organizacion y confirmar defaults modulares.
6. Generar materiales de prueba para confirmar resolucion `org -> global -> fallback`.

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigacion |
| --- | --- | --- |
| Desactivar prompt usado por una org | Fallos de generacion | Deprecar antes de borrar; resolver fallback global/hardcoded. |
| Versionado duplica filas activas | Resolver podria tomar prompt incorrecto | Constraint parcial o logica transaccional para una sola activa por `code + org`. |
| Modelos preview fallan en produccion | Jobs fallidos | Etiquetar preview y exigir fallback stable. |
| UI nueva rompe flujo tenant-aware | Admin de empresa ve datos cruzados | Mantener `resolveActiveTenantContext()` y pruebas en rutas slug/no slug. |
| Migracion destructiva de legacy | Perdida de personalizaciones | Export previo y archivado antes de delete. |

## 10. Orden recomendado para ejecutar

1. Implementar registry central y modelos Gemini centralizados.
2. Cambiar UI para ordenar por paso sin tocar aun la persistencia.
3. Agregar columnas de metadata y versionado.
4. Cambiar guardado a versionado historico.
5. Corregir trigger/defaults de nuevas organizaciones.
6. Deprecar `MATERIALS_GENERATION`.
7. Validar con una organizacion existente y una nueva.
8. Evaluar borrado fisico despues de confirmar uso cero.

## 11. Definition of Done

- Los prompts se muestran por orden de pipeline, no alfabeticamente.
- Cada paso muestra modelo + prompts relacionados.
- Cada prompt/configuracion tiene ayuda `?` clara y no tecnica.
- Cada prompt muestra ultima modificacion con fecha, hora y responsable.
- El usuario puede ver versiones anteriores.
- Guardar un prompt conserva historial.
- `MATERIALS_GENERATION` no aparece en flujo principal.
- Nuevas organizaciones no reciben prompts legacy como defaults principales.
- Modelos Gemini vigentes estan centralizados y etiquetados por estabilidad.
- Tests y TypeScript pasan antes de rollout.
