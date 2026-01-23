# Documentación de Estado: Fase 6 - Producción Visual (Slides en Gamma)

## 📋 Resumen Ejecutivo

**Fase 6** (también conocida como **Paso 6** o **GO-OP-06**) se encarga de transformar los guiones y storyboards validados en slides visuales completas usando Gamma, listas para producción de video.

**Estado General**: 🟡 **Parcialmente Implementado** (~40% completado)

> **Nota**: Existe una implementación funcional de UI para gestión de producción visual, tracking de URLs de Gamma, generación de prompts de B-roll, y gestión de screencasts. Lo que falta es la automatización completa del workflow y validaciones DoD.

---

## 🎯 Propósito y Alcance (Según Documentación)

### Propósito
Transformar insumos textuales (guion + storyboard validados) en soporte visual estructurado:
- Slides completas en Gamma
- Export a PNG organizado
- Listas para producción de video

### Condiciones de Inicio (Start Conditions)
- ✅ Plan instruccional (Fase 1) validado
- ✅ Curaduría de fuentes (Fase 2) completa
- ❌ Por cada lección/video existe guion final + storyboard asociado

### Condiciones de Finalización (End Conditions)
- ❌ Cada lección/video tiene su deck creado (1 por video)
- ❌ Slides revisadas vs guion + storyboard y cumplen DoD
- ❌ Slides exportadas a PNG y organizadas
- ❌ Tramo marcado "Completo" en sistema de tracking

---

## 🗄️ Modelo de Datos

### ❌ NO IMPLEMENTADO

#### Entidad Sugerida: `artifact_type = "slides_deck"`
**Documentación**: Sección 9 - "Contrato de integración"

**Campos Esperados** (no existen):
```typescript
{
  tn_mn_vn: string;              // Ej: "T1-M1-V1"
  gamma_deck_url: string;
  gamma_deck_id: string;
  gamma_folder_id: string;
  png_export_path: string;
  file_count: number;
  dod_checklist: {
    coverage_complete: boolean;
    script_storyboard_alignment: boolean;
    gamma_config_correct: boolean;
    visual_consistency: boolean;
    production_ready: boolean;
  };
  qa_status: string;
  qa_notes: string;
}
```

#### Eventos Sugeridos (pipeline_events)
**No existen**:
- `GO-OP-06_STARTED`
- `GO-OP-06_DECK_CREATED`
- `GO-OP-06_CONFIG_VALIDATED`
- `GO-OP-06_EXPORTED_PNG`
- `GO-OP-06_QA_APPROVED` / `GO-OP-06_QA_REJECTED`
- `GO-OP-06_COMPLETED`

### ⚠️ PARCIALMENTE RELACIONADO

#### Campo: `material_components.assets`
**Ubicación**: Migración [`20260123120000_add_assets_to_material_components.sql`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/supabase/migrations/20260123120000_add_assets_to_material_components.sql)

**Propósito**: Almacenar links y metadata para assets producidos (slides, videos, screencasts)

**Estado**: ✅ Campo existe, pero NO se usa para Fase 6

**Estructura Actual**:
```typescript
assets: {
  b_roll_prompts?: string;  // Usado por video-prompts-generation
  // Potencialmente podría extenderse para:
  // gamma_deck_url?: string;
  // png_export_path?: string;
  // slide_count?: number;
}
```

---

---

## 🔧 Funcionalidades Implementadas

### ✅ 1. UI de Producción Visual
**Archivo**: [`VisualProductionContainer.tsx`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/src/domains/materials/components/VisualProductionContainer.tsx)

**Características Implementadas**:
- ✅ Contenedor principal para Fase 6 integrado en `ArtifactClientView`
- ✅ Filtrado automático de componentes "producibles" (VIDEO_*, DEMO_GUIDE)
- ✅ Agrupación por lección con orden preservado
- ✅ Vista de lista de producción con estado de carga
- ✅ Mensajes de estado (cargando, sin items, etc.)
- ✅ Integración con hooks de materials para real-time updates

**Flujo Implementado**:
```typescript
1. Fetch materials y lessons
2. Para cada lesson:
   - Obtener components
   - Filtrar solo VIDEO_* y DEMO_GUIDE
   - Agrupar por lesson
3. Renderizar ProductionAssetCard por cada component
4. Manejar generación de prompts y guardado de assets
```

### ✅ 2. Gestión de Assets por Componente
**Archivo**: [`ProductionAssetCard.tsx`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/src/domains/materials/components/ProductionAssetCard.tsx)

**Características Implementadas**:

#### Sección Gamma Slides ✅
- ✅ Botón "Copiar Estructura" - Copia storyboard JSON al clipboard
- ✅ Link directo a gamma.app
- ✅ Input para pegar URL de Gamma deck creado
- ✅ Guardado de `slides_url` en `material_components.assets`
- ✅ Solo visible para VIDEO_THEORETICAL y VIDEO_GUIDE

#### Sección B-roll Prompts ✅
- ✅ Botón "Generar Prompts con Gemini" - Llama a video-prompts-generation
- ✅ Textarea editable con prompts generados
- ✅ Botón "Copiar" para clipboard
- ✅ Input para URL de video final
- ✅ Guardado de `b_roll_prompts` y `video_url` en assets
- ✅ Visible para VIDEO_THEORETICAL, VIDEO_DEMO, VIDEO_GUIDE

#### Sección Screencast ✅
- ✅ Guía de instrucciones (usar OBS Studio)
- ✅ Input para URL de screencast
- ✅ Guardado de `screencast_url` en assets
- ✅ Visible para DEMO_GUIDE y VIDEO_GUIDE

#### Visualización de Storyboard ✅
- ✅ Panel de referencia con storyboard completo
- ✅ Muestra timecode, visual_content, narration_text
- ✅ Scroll vertical con custom scrollbar
- ✅ Solo lectura (referencia para producción)

### ✅ 3. Persistencia de Assets
**Ubicación**: Campo `assets` en tabla `material_components`

**Estructura Implementada**:
```typescript
interface MaterialAssets {
  slides_url?: string;      // URL de deck en Gamma
  b_roll_prompts?: string;  // Prompts generados por Gemini
  video_url?: string;       // URL de video final
  screencast_url?: string;  // URL de screencast grabado
}
```

**Server Actions**:
- ✅ `saveMaterialAssetsAction(componentId, assets)` - Guarda assets en DB
- ✅ `generateVideoPromptsAction(componentId, storyboard)` - Genera prompts con Gemini

### ✅ 4. Generación de Prompts para Video
**Archivo**: [`video-prompts-generation.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/video-prompts-generation.ts)

**Características**:
- ✅ Convierte storyboard en prompts técnicos para video IA
- ✅ Usa `gemini-2.0-flash`
- ✅ Formato optimizado para Flow, Runway Gen-3, Sora, VEO
- ✅ Incluye: sujeto/acción, estilo visual, movimiento de cámara, ambiente

### ✅ 5. Integración en Artifact View
**Archivo**: [`ArtifactClientView.tsx`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/src/app/admin/artifacts/[id]/ArtifactClientView.tsx)

**Implementación**:
- ✅ Tab "Producción Visual" en vista de artefacto
- ✅ Renderiza `VisualProductionContainer`
- ✅ Visible después de completar Fase 5 (Materiales)

### ✅ 6. Workflow Manual Asistido
**Implementado**:
- ✅ Copiar estructura de storyboard para Gamma (manual)
- ✅ Crear deck en Gamma (manual, fuera del sistema)
- ✅ Pegar URL de Gamma deck (manual)
- ✅ Generar prompts de B-roll con IA (automático)
- ✅ Copiar prompts para herramientas de video (manual)
- ✅ Grabar screencast con OBS (manual, guiado)
- ✅ Guardar todas las URLs en sistema (automático)

---

## ⚠️ Funcionalidades Parcialmente Implementadas

### 1. ⚠️ Tracking de Progreso
**Implementado**:
- ✅ Se guardan URLs de assets
- ✅ Se puede ver qué componentes tienen assets

**Faltante**:
- ❌ Estados del workflow (PENDING, IN_PROGRESS, DECK_READY, etc.)
- ❌ Indicadores visuales de completitud
- ❌ Progreso por lección/módulo
- ❌ Dashboard de estado general

### 2. ⚠️ Modelo de Datos
**Implementado**:
- ✅ Campo `assets` en `material_components`
- ✅ Estructura básica para slides_url, video_url, screencast_url

**Faltante**:
- ❌ Artifact type `slides_deck` dedicado
- ❌ Eventos de pipeline GO-OP-06
- ❌ DoD checklist en estructura
- ❌ Metadata de Gamma (deck_id, folder_id)
- ❌ Metadata de PNG export (path, count, resolution)

---

## ❌ Funcionalidades NO Implementadas

### 1. ❌ Integración con Gamma
**Documentación**: Secciones 4.2, 6, 10

**Faltante Completo**:
- ❌ Creación de decks en Gamma
- ❌ Configuración automática (idioma, estilo, sin imágenes)
- ❌ Carga de guion + storyboard a Gamma
- ❌ Generación/ajuste de slides
- ❌ Naming según convención `Tn–Mn–Vn`

**Opciones de Implementación** (no decididas):
- Opción A: RPA (Playwright) + config snapshot verificado
- Opción B: HITL obligado (operador confirma config) + sistema trackea

### 2. ❌ Export a PNG
**Documentación**: Sección 4.3, 6

**Faltante Completo**:
- ❌ Export de slides a PNG desde Gamma
- ❌ Organización en carpetas
- ❌ Naming de archivos PNG
- ❌ Registro de rutas de export
- ❌ Validación de export completo

**Estándar No Definido**:
- Resolución de PNG
- Naming de archivos individuales
- Estructura de carpetas

### 3. ❌ Validaciones DoD (Definition of Done)
**Documentación**: Sección 4.3

**Checklist Esperado** (no implementado):
```typescript
{
  coverage_complete: boolean;           // Todo video tiene deck (1:1)
  script_storyboard_alignment: boolean; // Orden y coherencia
  gamma_config_correct: boolean;        // Texto mínimo, idioma, sin imágenes
  visual_consistency: boolean;          // Paleta/tipografías consistentes
  production_ready: boolean;            // PNG exportado + organizado
}
```

**Validaciones Automáticas Esperadas**:
- ❌ `deck_title` debe coincidir con regex `^T\d+\s?-\s?M\d+\s?-\s?V\d+$`
- ❌ `gamma_config.language == 'es-LATAM'`
- ❌ `gamma_config.images == 'OFF'`
- ❌ `png_export_path` no vacío

### 4. ❌ Estados del Workflow
**Documentación**: Sección 8 (YAML spec)

**Estados Esperados** (no existen):
```typescript
- PENDING          // Video listo para producción de slides
- IN_PROGRESS      // Deck en creación/edición
- DECK_READY       // Deck cumple DoD interno (pre-QA)
- EXPORTED         // PNG exportado y registrado
- QA_REVIEW        // En revisión de QA
- QA_APPROVED      // Aprobado por QA
- QA_REJECTED      // Requiere corrección y re-export
- COMPLETED        // Tramo completado
```

### 5. ❌ UI de Operador
**Documentación**: Secciones 5, 6

**Faltante Completo**:
- ❌ Vista de preparación del módulo
- ❌ Inicialización de tracking
- ❌ Selección de video pendiente
- ❌ Interfaz para crear deck en Gamma
- ❌ Revisión de guion + storyboard
- ❌ Ajuste de slides
- ❌ Trigger de export PNG
- ❌ Registro de rutas

### 6. ❌ Flujo de QA
**Documentación**: Sección 6B

**Faltante Completo**:
- ❌ Vista de QA para revisar slides
- ❌ Comparación guion vs slides
- ❌ Aprobación/rechazo con observaciones
- ❌ Ciclo de corrección y re-export

### 7. ❌ Gestión de Errores Típicos
**Documentación**: Sección 7

**Casos No Manejados**:
- ❌ Orden incorrecto vs storyboard
- ❌ Aparición de imágenes (config incorrecta)
- ❌ Texto cambia sentido del guion
- ❌ Errores de idioma/registro
- ❌ Escalamiento a responsable de guion/storyboard

### 8. ❌ Tracking y Audit Log
**Documentación**: Sección 8 (audit_log_fields)

**Campos Esperados** (no existen):
```typescript
{
  course_id: string;
  module_id: string;
  video_id: string;
  tn_mn_vn: string;
  gamma_deck_url: string;
  gamma_deck_id: string;
  gamma_config_snapshot: object;
  export_path: string;
  qa_decision: string;
  qa_notes: string;
  operator_user_id: string;
  timestamps: {
    started_at: string;
    exported_at: string;
    qa_reviewed_at: string;
    completed_at: string;
  }
}
```

### 9. ❌ Política de Escalamiento
**Documentación**: Sección 8 (escalation_policy)

**Faltante**:
```typescript
{
  max_iterations: 2;
  escalate_to: ["Responsable de guion/storyboard", "Coordinación"];
  escalate_on: [
    "storyboard_incomplete",
    "meaning_conflict_script_vs_slides",
    "persistent_config_errors"
  ]
}
```

### 10. ❌ Modalidades Operativas
**Documentación**: Sección 6A

**Opciones No Implementadas**:
- Modalidad A: Un deck por video (crear individualmente)
- Modalidad B: Deck por módulo y luego segmentar

---

## 📊 Matriz de Implementación

| Componente | Especificado | Implementado | Estado | Prioridad |
|------------|--------------|--------------|--------|-----------|
| **Modelo de Datos** |
| slides_deck artifact type | ✅ | ❌ | No existe | Media |
| pipeline_events para GO-OP-06 | ✅ | ❌ | No existe | Media |
| assets field | ✅ | ✅ | **Implementado** | - |
| **Integración Gamma** |
| Creación de decks | ✅ | ⚠️ | Manual (fuera del sistema) | Baja |
| Configuración automática | ✅ | ❌ | No existe | Media |
| Naming Tn-Mn-Vn | ✅ | ❌ | No existe | Media |
| Tracking de URL | ✅ | ✅ | **Implementado** | - |
| **Export PNG** |
| Export desde Gamma | ✅ | ❌ | No existe | Media |
| Organización de archivos | ✅ | ❌ | No existe | Baja |
| Estándar de naming | ⚠️ | ❌ | No definido | Baja |
| **Validaciones** |
| DoD checklist | ✅ | ❌ | No existe | Media |
| Validaciones automáticas | ✅ | ❌ | No existe | Media |
| **Workflow** |
| Estados del proceso | ✅ | ❌ | No existe | Media |
| Transiciones | ✅ | ❌ | No existe | Media |
| **UI** |
| Vista de producción | ✅ | ✅ | **Implementado** | - |
| Gestión de assets | ✅ | ✅ | **Implementado** | - |
| Vista de QA | ✅ | ❌ | No existe | Alta |
| Tracking de progreso | ✅ | ⚠️ | Parcial (sin estados) | Media |
| **Generación de Prompts** |
| B-roll prompts con IA | ⚠️ | ✅ | **Implementado** | - |
| Copiar/pegar workflow | ✅ | ✅ | **Implementado** | - |
| **Gestión de Errores** |
| Detección de errores típicos | ✅ | ❌ | No existe | Baja |
| Escalamiento | ✅ | ❌ | No existe | Baja |
| **Audit** |
| Audit log completo | ✅ | ❌ | No existe | Baja |
| Snapshots de config | ✅ | ❌ | No existe | Baja |

---

## 🔍 Archivos Relacionados (Potenciales)

### Backend (No Existen)
- `netlify/functions/slides-generation-background.ts` - **NO EXISTE**
- `netlify/functions/gamma-integration.ts` - **NO EXISTE**
- `netlify/functions/png-export.ts` - **NO EXISTE**

### Frontend (No Existen)
- `src/domains/visual-production/` - **NO EXISTE**
- `src/domains/slides/` - **NO EXISTE**

### Existente pero NO usado para Fase 6
- [`video-prompts-generation.ts`](file:///c:/Users/Lordg/OneDrive/Desktop/Laburo/courseforge/apps/web/netlify/functions/video-prompts-generation.ts) - Solo genera prompts, no slides

---

## 🎯 Plan de Implementación Sugerido

### Fase 1: Fundamentos (Semana 1-2)
1. **Definir Modelo de Datos**
   - Crear tabla `slides_decks` o usar artifact type
   - Definir schema de `assets` extendido
   - Crear eventos de pipeline

2. **Decisión Técnica Crítica**
   - ¿RPA (Playwright) o HITL?
   - ¿API de Gamma disponible?
   - Definir estándar de export PNG

### Fase 2: Integración Básica (Semana 3-4)
3. **Implementar Integración con Gamma**
   - Creación de decks
   - Configuración automática
   - Naming según convención

4. **Implementar Export PNG**
   - Export desde Gamma
   - Organización de archivos
   - Registro de rutas

### Fase 3: Validación y Workflow (Semana 5-6)
5. **Implementar Validaciones DoD**
   - Checklist automático
   - Validaciones de config
   - Detección de errores típicos

6. **Implementar Estados del Workflow**
   - State machine completa
   - Transiciones
   - Política de escalamiento

### Fase 4: UI y QA (Semana 7-8)
7. **Implementar UI de Operador**
   - Vista de preparación
   - Tracking de progreso
   - Interfaz de ajuste

8. **Implementar Flujo de QA**
   - Vista de revisión
   - Aprobación/rechazo
   - Ciclo de corrección

### Fase 5: Audit y Refinamiento (Semana 9-10)
9. **Implementar Audit Log**
   - Tracking completo
   - Snapshots de config
   - Trazabilidad

10. **Testing y Refinamiento**
    - Suite de pruebas
    - Casos límite
    - Optimización

---

## 🔴 Decisiones Críticas Pendientes (OPEN_QUESTIONS)

### 1. Integración con Gamma
**Pregunta**: ¿Cómo se integrará con Gamma?

**Opciones**:
- **A) RPA (Playwright)**: Automatización completa del navegador
  - ✅ Pros: Totalmente automático
  - ❌ Contras: Frágil, requiere mantenimiento
  
- **B) HITL (Human-In-The-Loop)**: Operador manual
  - ✅ Pros: Flexible, menos frágil
  - ❌ Contras: Requiere intervención humana
  
- **C) API de Gamma**: Si existe
  - ✅ Pros: Robusto, mantenible
  - ❌ Contras: Depende de disponibilidad de API

**Impacto**: Define arquitectura completa de la Fase 6

### 2. Estándar de Export PNG
**Pregunta**: ¿Cuál es el estándar de export?

**Pendiente Definir**:
- Resolución (ej: 1920x1080, 4K)
- Naming de archivos (ej: `T1-M1-V1-slide-001.png`)
- Estructura de carpetas (ej: `/exports/T1/M1/V1/`)
- Formato de compresión

**Impacto**: Sin esto, no se puede validar "organización correcta"

### 3. Tracking System
**Pregunta**: ¿Usar Coda, sistema interno, o ambos?

**Opciones**:
- **A) Solo Coda**: Como menciona la documentación
- **B) Solo sistema interno**: Base de datos propia
- **C) Híbrido**: Sincronización bidireccional

**Impacto**: Define flujo de trabajo del operador

---

## 📝 Notas Adicionales

### Relación con Fase 5
- Fase 6 **depende** de Fase 5 para obtener:
  - Guiones finales (DIALOGUE component)
  - Storyboards (STORYBOARD component)
- El campo `material_components.assets` podría servir como puente

### Complejidad Estimada
- **Alta**: Requiere integración externa (Gamma)
- **Media-Alta**: UI compleja para operador y QA
- **Media**: Validaciones y workflow
- **Baja**: Modelo de datos y audit log

### Riesgos Principales
1. **Dependencia de Gamma**: Si no hay API, RPA es frágil
2. **Estándares no definidos**: PNG export sin especificación clara
3. **Decisión HITL vs Automatización**: Afecta toda la arquitectura
4. **Integración con Fase 5**: Asegurar que storyboards estén listos

### Oportunidades
- Reutilizar patrones de Fase 5 (estados, validaciones, audit)
- Extender `material_components.assets` en lugar de nueva tabla
- Aprovechar real-time updates de Supabase

---

## 🎯 Recomendaciones Inmediatas

### Antes de Implementar
1. ✅ **Decidir estrategia de integración con Gamma** (RPA vs HITL vs API)
2. ✅ **Definir estándar de export PNG** (resolución, naming, carpetas)
3. ✅ **Validar que Fase 5 genera storyboards** correctamente
4. ✅ **Diseñar mockups de UI** para operador y QA

### Primeros Pasos Técnicos
1. Extender `material_components.assets` con campos de Gamma
2. Crear eventos de pipeline para GO-OP-06
3. Implementar proof-of-concept de integración con Gamma
4. Diseñar schema de validaciones DoD

### Coordinación con Fase 5
1. Asegurar que `STORYBOARD` component esté completo
2. Validar que `DIALOGUE` component tenga formato esperado
3. Definir trigger para iniciar Fase 6 (¿automático o manual?)
