# Documentación de Estado: Fase 5 - Generación de Materiales

## 📋 Resumen Ejecutivo

**Fase 5** se encarga de generar los materiales educativos por lección basándose en el plan instruccional (Paso 3) y las fuentes curadas (Paso 4). El sistema actual tiene una implementación **parcial pero funcional** de esta fase.

**Estado General**: 🟡 **Implementado Parcialmente** (~70% completado)

---

## 🎯 Propósito y Alcance (Según Documentación)

### Propósito
Generar materiales completos por lección con controles automáticos y HITL (Human-In-The-Loop), produciendo componentes como:
- DIALOGUE (Guion/Diálogo)
- READING (Lectura)
- QUIZ (Evaluación)
- EXERCISE (Ejercicio)
- DEMO_GUIDE (Guía de demostración)
- STORYBOARD (Storyboard para video)

### Condiciones de Inicio (Start Conditions)
- ✅ Plan instruccional (Paso 3) accesible
- ✅ Curaduría (Paso 4) accesible con fuentes curadas

### Condiciones de Finalización (End Conditions)
- ✅ Materiales completos por lección con estado `APPROVABLE` o `NEEDS_FIX`
- ⚠️ Validación automática de DoD (Definition of Done)
- ⚠️ Consolidación para QA/Coordinación

---

## 🗄️ Modelo de Datos

### ✅ IMPLEMENTADO

#### Tabla: `materials`
**Ubicación**: Tabla principal que agrupa todas las lecciones de un artefacto

**Estados del Sistema**:
```typescript
- PHASE3_DRAFT          // Borrador inicial
- PHASE3_GENERATING     // Generando materiales
- PHASE3_VALIDATING     // Validando materiales generados
- PHASE3_NEEDS_FIX      // Requiere correcciones
- PHASE3_READY_FOR_QA   // Listo para revisión de QA
- PHASE3_APPROVED       // Aprobado por QA
- PHASE3_REJECTED       // Rechazado por QA
```

#### Tabla: `material_lessons`
**Ubicación**: [`supabase/Scripts/material_lessons.sql`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/supabase/Scripts/material_lessons.sql)

**Campos Clave**:
```sql
- id (uuid)
- materials_id (uuid) → FK a materials
- lesson_id (text) → Identificador único de lección
- lesson_title (text)
- module_id (text)
- module_title (text)
- oa_text (text) → Objetivo de Aprendizaje
- expected_components (text[]) → Componentes esperados
- quiz_spec (jsonb) → Especificación del quiz
- requires_demo_guide (boolean)
- dod (jsonb) → Definition of Done con controles
- state (text) → PENDING, GENERATING, GENERATED, APPROVABLE, NEEDS_FIX
- iteration_count (integer)
- max_iterations (integer) → Default: 2
```

**Estados por Lección**:
```typescript
- PENDING       // Pendiente de generar
- GENERATING    // En proceso de generación
- GENERATED     // Generado exitosamente
- APPROVABLE    // Cumple DoD, listo para aprobar
- NEEDS_FIX     // Requiere correcciones
```

#### Tabla: `material_components`
**Ubicación**: [`supabase/Scripts/material_components.sql`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/supabase/Scripts/material_components.sql)

**Campos Clave**:
```sql
- id (uuid)
- material_lesson_id (uuid) → FK a material_lessons
- type (text) → DIALOGUE, READING, QUIZ, EXERCISE, DEMO_GUIDE, STORYBOARD
- content (jsonb) → Contenido del componente
- source_refs (text[]) → Referencias a fuentes curadas
- validation_status (text) → PENDING, PASS, FAIL
- validation_errors (text[])
- iteration_number (integer)
- assets (jsonb) → NUEVO: Links a assets producidos (slides, videos)
```

---

## 🔧 Funcionalidades Implementadas

### 1. ✅ Generación de Materiales con IA
**Archivo**: [`netlify/functions/materials-generation-background.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/materials-generation-background.ts)

**Características Implementadas**:
- ✅ Generación por lotes (batch processing) con `BATCH_SIZE = 2`
- ✅ Delays entre lecciones (15s) y entre batches (60s) para evitar rate limits
- ✅ Retry logic con exponential backoff y jitter
- ✅ Fallback entre modelos: `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-2.0-flash`
- ✅ Manejo de errores 429 (rate limit) y 503 (overload)
- ✅ Generación basada en prompt configurable
- ✅ Uso de fuentes curadas (solo fuentes con `apta = true`)
- ✅ Soporte para regeneración de lecciones individuales (fix mode)
- ✅ IDs únicos garantizados usando `globalIndex` para evitar sobrescritura

**Flujo de Generación**:
```
1. Fetch materials record
2. Fetch instructional plan (Paso 3)
3. Fetch curated sources (Paso 4) - solo aptas
4. Determinar lecciones a procesar (todas o una específica)
5. Procesar en batches:
   - Crear/encontrar registro de material_lesson
   - Obtener fuentes para la lección
   - Generar con Gemini (con retry y fallback)
   - Guardar componentes generados
   - Actualizar estado de lección
6. Actualizar estado global de materials
```

### 2. ✅ Validación Automática de Materiales
**Archivo**: [`netlify/functions/validate-materials-background.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/validate-materials-background.ts)

**Controles Implementados**:

#### Control 3: Consistencia con el Plan ✅
```typescript
- Verifica que todos los componentes esperados estén presentes
- Detecta componentes faltantes
- Estado: control3_consistency → PASS/FAIL
```

#### Control 4: Uso de Fuentes ⚠️ (Parcial)
```typescript
- Verifica que se usen fuentes (lenient)
- NO valida que solo se usen fuentes aptas
- NO valida que afirmaciones clave estén respaldadas
- Estado: control4_sources → PASS (siempre, por ahora)
```

#### Control 5: Validación de Quiz ✅
```typescript
- Verifica cantidad mínima de preguntas
- Verifica que cada pregunta tenga explicación (>10 chars)
- Estado: control5_quiz → PASS/FAIL
```

**Resultado de Validación**:
```typescript
interface LessonDod {
  control3_consistency: 'PASS' | 'FAIL' | 'PENDING';
  control4_sources: 'PASS' | 'FAIL' | 'PENDING';
  control5_quiz: 'PASS' | 'FAIL' | 'PENDING';
  errors: string[];
}
```

**Estados Resultantes**:
- Si `errors.length > 0` → `NEEDS_FIX`
- Si `errors.length === 0` → `APPROVABLE`
- Estado global: `PHASE3_READY_FOR_QA` o `PHASE3_NEEDS_FIX`

### 3. ✅ Servicios Frontend
**Archivo**: [`src/domains/materials/services/materials.service.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/src/domains/materials/services/materials.service.ts)

**Funcionalidades**:
- ✅ `getMaterialsForArtifact()` - Obtener materials por artifact
- ✅ `getLessonsForMaterials()` - Obtener lecciones
- ✅ `getComponentsForLesson()` - Obtener componentes
- ✅ `triggerMaterialsGeneration()` - Disparar generación
- ✅ `triggerValidation()` - Disparar validación
- ✅ `regenerateLesson()` - Regenerar lección específica
- ✅ Suscripción en tiempo real a cambios en `materials` y `material_lessons`

### 4. ✅ Generación de Prompts para Video
**Archivo**: [`netlify/functions/video-prompts-generation.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/video-prompts-generation.ts)

**Características**:
- ✅ Convierte storyboard en prompts técnicos para generación de video
- ✅ Usa `gemini-2.0-flash` para generación rápida
- ✅ Guarda prompts en `material_components.assets.b_roll_prompts`
- ✅ Formato optimizado para herramientas como Flow, Runway Gen-3, Sora, VEO

---

## ❌ Funcionalidades NO Implementadas

### 1. ❌ Iteración Dirigida (Fix Mode Completo)
**Documentación**: Sección 4.3 - "Iteración dirigida (solo lo que incumple)"

**Faltante**:
- ❌ Prompt incremental específico por tipo de falla
- ❌ UI para especificar instrucciones de corrección
- ❌ Regeneración selectiva de componentes (actualmente regenera toda la lección)

**Ejemplo Esperado**:
```
"Reescribe el quiz de la lección X conforme al Paso 3: N preguntas..."
"Ajusta storyboard para que sea producible..."
```

### 2. ❌ Control 4 Completo (Uso Correcto de Fuentes)
**Documentación**: Sección 4.1 - "Control 4 — Uso correcto de fuentes"

**Faltante**:
- ❌ Validación de que NO se usen fuentes NO aptas
- ❌ Validación de "afirmaciones clave" respaldadas por fuentes
- ❌ Detección heurística de claims sin respaldo
- ❌ Marcado explícito cuando falta fuente

**Estado Actual**: Control siempre pasa (lenient)

### 3. ❌ Bloqueo por URLs Rotas
**Documentación**: Sección 2 - "Regla de bloqueo recomendada"

**Faltante**:
- ❌ Validación de accesibilidad de URLs antes de Paso 5
- ❌ Bloqueo si fuentes críticas tienen 404/403/timeout
- ❌ Devolución a Paso 4 con lista de URLs fallidas

### 4. ❌ UI de Checklist HITL
**Documentación**: Sección 4.2 - "Controles HITL"

**Faltante**:
- ❌ Vista por lección con checklist de validación manual
- ❌ Confirmación de "producible" para demos/guías
- ❌ Verificación de alineación pedagógica (OA ↔ contenido)

### 5. ❌ Gestión de Bloqueadores
**Documentación**: Sección 4.4 - "Bloqueadores"

**Faltante**:
- ❌ Detección y registro de bloqueadores
- ❌ Campos: qué es, impacto, responsable, estado
- ❌ Estado `PHASE3_ESCALATED`
- ❌ UI para gestionar bloqueadores

### 6. ❌ Empaquetado y Naming
**Documentación**: Sección 5 - "Empaquetado + QA final"

**Faltante**:
- ❌ Naming/versionado según convención
- ❌ Estructura de carpetas definida
- ❌ Tabla `phase3_packages` (rutas/naming/version)
- ❌ Validación con regex de naming

### 7. ❌ QA Consolidado
**Documentación**: Sección 5 - "QA final"

**Faltante**:
- ❌ Vista consolidada de todas las lecciones para QA
- ❌ Flujo de aprobación/rechazo con comentarios
- ❌ Ciclo de corrección y reenvío
- ❌ Botón "Consolidar entrega Fase 3 → QA"

### 8. ❌ Audit Log Completo
**Documentación**: Sección 9 - "Registros y audit log"

**Faltante**:
- ❌ `prompt_version` tracking
- ❌ `model` usado por generación
- ❌ `input_hash` y `output_hash`
- ❌ `package_paths`
- ❌ Tabla `pipeline_events` para Fase 3

---

## 📊 Matriz de Implementación

| Componente | Especificado | Implementado | Estado | Prioridad |
|------------|--------------|--------------|--------|-----------|
| **Modelo de Datos** |
| materials table | ✅ | ✅ | Completo | - |
| material_lessons table | ✅ | ✅ | Completo | - |
| material_components table | ✅ | ✅ | Completo | - |
| phase3_validations table | ✅ | ❌ | Faltante | Media |
| phase3_packages table | ✅ | ❌ | Faltante | Baja |
| **Generación** |
| Generación con IA | ✅ | ✅ | Completo | - |
| Batch processing | ✅ | ✅ | Completo | - |
| Retry con backoff | ✅ | ✅ | Completo | - |
| Model fallback | ✅ | ✅ | Completo | - |
| Fix mode básico | ✅ | ✅ | Parcial | Alta |
| Iteración dirigida | ✅ | ❌ | Faltante | Alta |
| **Validación** |
| Control 3 (Consistencia) | ✅ | ✅ | Completo | - |
| Control 4 (Fuentes) | ✅ | ⚠️ | Parcial | Alta |
| Control 5 (Quiz) | ✅ | ✅ | Completo | - |
| Validación de URLs | ✅ | ❌ | Faltante | Media |
| **HITL** |
| Checklist manual | ✅ | ❌ | Faltante | Alta |
| Gestión de bloqueadores | ✅ | ❌ | Faltante | Media |
| **QA** |
| Vista consolidada | ✅ | ❌ | Faltante | Alta |
| Flujo aprobación/rechazo | ✅ | ❌ | Faltante | Alta |
| **Otros** |
| Empaquetado | ✅ | ❌ | Faltante | Baja |
| Audit log completo | ✅ | ❌ | Faltante | Media |
| Video prompts | ⚠️ | ✅ | Extra | - |

---

## 🔍 Archivos Clave

### Backend (Netlify Functions)
- [`materials-generation-background.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/materials-generation-background.ts) - Generación principal
- [`validate-materials-background.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/validate-materials-background.ts) - Validación
- [`video-prompts-generation.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/video-prompts-generation.ts) - Prompts de video

### Frontend (Services)
- [`materials.service.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/src/domains/materials/services/materials.service.ts) - Servicio principal

### UI Components (Probablemente en)
- `src/domains/materials/components/` - Componentes de UI
- `src/app/admin/artifacts/[id]/` - Vista de artefacto

### Database
- [`material_lessons.sql`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/supabase/Scripts/material_lessons.sql) - Schema de lecciones
- [`material_components.sql`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/supabase/Scripts/material_components.sql) - Schema de componentes

### Prompts
- `src/shared/config/prompts/materials-generation.prompts.ts` - Prompt de generación

---

## 🎯 Recomendaciones de Prioridad

### 🔴 Alta Prioridad (Funcionalidad Core)
1. **Iteración Dirigida Completa** - Permitir correcciones específicas sin regenerar todo
2. **Control 4 Completo** - Validar uso correcto de fuentes aptas
3. **UI de Checklist HITL** - Permitir validación manual por operador
4. **Vista QA Consolidada** - Flujo de aprobación/rechazo

### 🟡 Media Prioridad (Mejoras Operativas)
5. **Gestión de Bloqueadores** - Tracking de impedimentos
6. **Validación de URLs** - Prevenir errores de fuentes rotas
7. **Audit Log Completo** - Trazabilidad total

### 🟢 Baja Prioridad (Nice to Have)
8. **Empaquetado y Naming** - Organización de outputs
9. **Tabla phase3_validations** - Historial de validaciones
10. **Tabla phase3_packages** - Metadata de paquetes

---

## 📝 Notas Adicionales

### Fortalezas del Sistema Actual
- ✅ Arquitectura sólida y escalable
- ✅ Manejo robusto de errores y rate limits
- ✅ Generación por lotes eficiente
- ✅ Validación básica funcional
- ✅ Real-time updates

### Áreas de Mejora
- ⚠️ Falta UI completa para operadores
- ⚠️ Validación de fuentes muy permisiva
- ⚠️ No hay flujo de QA formal
- ⚠️ Falta trazabilidad completa (audit log)

### Decisiones Pendientes (OPEN_QUESTIONS)
1. **Límite de iteraciones**: Actualmente `max_iterations = 2` (coherente con el sistema)
2. **Definición de "afirmaciones clave"**: Propuesta de heurística + HITL pendiente
3. **Naming/versionado**: Delegar a config o hardcodear estándar
