# Análisis de Integración SCORM en Courseforge

## Resumen Ejecutivo

Este documento analiza la viabilidad de importar contenido SCORM a Courseforge, identificando gaps entre ambos sistemas y proponiendo un flujo de enriquecimiento con IA.

---

## 1. ¿Qué es SCORM?

SCORM (Sharable Content Object Reference Model) es un estándar de e-learning que permite la interoperabilidad entre sistemas LMS. Un paquete SCORM es un archivo ZIP que contiene:

| Componente | Descripción |
|------------|-------------|
| `imsmanifest.xml` | Archivo XML en la raíz que describe toda la estructura del curso |
| SCOs | Sharable Content Objects - unidades de aprendizaje que se comunican con el LMS |
| Assets | Recursos estáticos (imágenes, videos, documentos) |
| HTML/JS/CSS | Contenido web que se presenta al estudiante |

### Versiones de SCORM
- **SCORM 1.2**: Más simple, ampliamente soportado
- **SCORM 2004**: Incluye secuenciación y navegación avanzada

### Modelo de Datos (CMI)
```
cmi.core.lesson_status     → Estado: completed, incomplete, passed, failed
cmi.core.score.raw         → Puntuación obtenida
cmi.suspend_data           → Datos de progreso (JSON codificado como string)
cmi.interactions.n.*       → Tracking de quizzes/interacciones
```

---

## 2. Estructura de imsmanifest.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="course123" version="1.0">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>

  <organizations default="org1">
    <organization identifier="org1">
      <title>Nombre del Curso</title>

      <!-- Módulos (items con hijos) -->
      <item identifier="module1">
        <title>Módulo 1: Introducción</title>

        <!-- Lecciones (items hoja que referencian recursos) -->
        <item identifier="lesson1_1" identifierref="res_lesson1_1">
          <title>1.1 Conceptos Básicos</title>
        </item>
        <item identifier="lesson1_2" identifierref="res_lesson1_2">
          <title>1.2 Quiz de Evaluación</title>
        </item>
      </item>

      <item identifier="module2">
        <title>Módulo 2: Desarrollo</title>
        <!-- más lecciones... -->
      </item>
    </organization>
  </organizations>

  <resources>
    <resource identifier="res_lesson1_1" type="webcontent" adlcp:scormtype="sco" href="content/lesson1_1/index.html">
      <file href="content/lesson1_1/index.html"/>
      <file href="content/lesson1_1/styles.css"/>
      <file href="content/lesson1_1/script.js"/>
      <file href="content/lesson1_1/image.png"/>
    </resource>
    <resource identifier="res_lesson1_2" type="webcontent" adlcp:scormtype="sco" href="content/quiz1/index.html">
      <file href="content/quiz1/index.html"/>
      <file href="content/quiz1/quiz-data.json"/>
    </resource>
  </resources>
</manifest>
```

---

## 3. Comparación: SCORM vs Courseforge

### 3.1 Estructura Jerárquica

| Nivel | SCORM | Courseforge | Mapeo |
|-------|-------|-------------|-------|
| Curso | `<organization>` | `artifacts` | ✅ Directo |
| Módulo | `<item>` (con hijos) | `syllabus.modules[]` | ✅ Directo |
| Lección | `<item>` (hoja) | `syllabus.modules[].lessons[]` | ✅ Directo |
| Recurso | `<resource>` | `material_components` | ⚠️ Requiere análisis |

### 3.2 Tipos de Contenido

| Tipo SCORM | Contenido Típico | Equivalente Courseforge | Gap |
|------------|------------------|------------------------|-----|
| SCO HTML básico | Texto, imágenes | `READING` | ⚠️ Requiere extracción de texto |
| SCO con video | Video embebido | `VIDEO_*` | ⚠️ Falta script/storyboard |
| SCO interactivo | Simulaciones | `DEMO_GUIDE` | ⚠️ Falta estructura de pasos |
| SCO Quiz | Preguntas | `QUIZ` | ⚠️ Formato diferente |
| SCO multimedia | Mixed media | `DIALOGUE` | ❌ No hay equivalente directo |

### 3.3 Metadatos y Objetivos

| Metadato | SCORM | Courseforge | Gap |
|----------|-------|-------------|-----|
| Título | ✅ `<title>` | ✅ `artifacts.idea_central` | ✅ Directo |
| Descripción | ⚠️ Opcional en metadata | ✅ `artifacts.descripcion` | ⚠️ Puede faltar |
| Objetivos | ❌ No estándar | ✅ `artifacts.objetivos[]` (Bloom) | ❌ **GAP CRÍTICO** |
| Público objetivo | ❌ No estándar | ✅ `target_audience` | ❌ **GAP CRÍTICO** |
| Nivel Bloom | ❌ No existe | ✅ `oa_bloom_verb` por lección | ❌ **GAP CRÍTICO** |

### 3.4 Contenido de Lecciones

| Elemento | SCORM | Courseforge | Gap |
|----------|-------|-------------|-----|
| HTML puro | ✅ Archivos HTML | ✅ `READING.body_html` | ✅ Parseable |
| Puntos clave | ❌ No estructura | ✅ `READING.key_points[]` | ❌ **Generar con IA** |
| Preguntas reflexión | ❌ No estructura | ✅ `READING.reflection_question` | ❌ **Generar con IA** |
| Script de video | ❌ No incluido | ✅ `VIDEO.script.sections[]` | ❌ **Generar con IA** |
| Storyboard | ❌ No incluido | ✅ `VIDEO.storyboard[]` | ❌ **Generar con IA** |
| B-roll prompts | ❌ No existe | ✅ `assets.b_roll_prompts` | ❌ **Generar con IA** |

### 3.5 Quizzes

| Elemento | SCORM (cmi.interactions) | Courseforge (QUIZ) | Transformación |
|----------|--------------------------|-------------------|----------------|
| Tipo pregunta | `true-false`, `choice`, `fill-in` | `TRUE_FALSE`, `MULTIPLE_CHOICE`, `FILL_BLANK` | ✅ Mapeo directo |
| Opciones | Variable según herramienta | `options[]` | ⚠️ Extraer de HTML |
| Respuesta correcta | `correct_responses.n.pattern` | `correct_answer` | ⚠️ Decodificar formato |
| Explicación | ❌ No estándar | ✅ `explanation` (requerido) | ❌ **Generar con IA** |
| Nivel dificultad | ❌ No existe | ✅ `difficulty` | ❌ **Inferir con IA** |
| Nivel Bloom | ❌ No existe | ✅ `bloom_level` | ❌ **Clasificar con IA** |

---

## 4. Gaps Identificados y Soluciones IA

### 4.1 Gaps Críticos (Courseforge requiere, SCORM no tiene)

| Gap | Impacto | Solución IA |
|-----|---------|-------------|
| **Objetivos de aprendizaje Bloom** | Sin esto no se puede generar plan instruccional | Analizar contenido y generar objetivos con taxonomía Bloom |
| **Público objetivo** | Afecta tono y complejidad | Inferir del nivel de contenido |
| **Descripción del curso** | Metadata para SOFLIA | Generar resumen ejecutivo del contenido |
| **Explicaciones de quiz** | SOFLIA requiere feedback | Generar explicación por cada opción |
| **Scripts de video** | Producción visual imposible sin esto | Extraer narración si hay audio, o generar desde contenido |
| **Storyboards** | Producción visual | Generar basado en contenido |
| **Diálogos con Lia** | Interactividad conversacional | Transformar contenido a formato conversacional |
| **Reflexiones y puntos clave** | Estructura pedagógica | Extraer/generar con IA |

### 4.2 Gaps Menores (Información parcial)

| Gap | Impacto | Solución |
|-----|---------|----------|
| Tiempo estimado por lección | Planificación | Calcular de contenido (palabras/duración video) |
| Prerequisitos | Secuenciación | Inferir de estructura del curso |
| Criterios medibles | Evaluación | Generar basado en objetivos |

---

## 5. Flujo Propuesto de Importación SCORM

```
┌─────────────────────────────────────────────────────────────────────┐
│                     FASE 0: UPLOAD & PARSING                        │
├─────────────────────────────────────────────────────────────────────┤
│  1. Usuario sube archivo .zip SCORM                                 │
│  2. Validar: existe imsmanifest.xml en raíz                         │
│  3. Detectar versión SCORM (1.2 vs 2004)                            │
│  4. Extraer estructura: organizations → modules → lessons          │
│  5. Mapear resources a lessons (identifierref → resource.href)     │
│  6. Almacenar archivos en storage temporal                          │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    FASE 1: ANÁLISIS DE CONTENIDO                    │
├─────────────────────────────────────────────────────────────────────┤
│  Para cada SCO/lesson:                                              │
│  1. Extraer HTML principal                                          │
│  2. Detectar tipo de contenido:                                     │
│     - ¿Tiene video? → VIDEO_THEORETICAL/VIDEO_DEMO                  │
│     - ¿Tiene quiz? → QUIZ                                           │
│     - ¿Texto largo? → READING                                       │
│     - ¿Pasos numerados? → DEMO_GUIDE                                │
│  3. Extraer texto limpio (strip HTML)                               │
│  4. Extraer assets (imágenes, videos, PDFs)                         │
│  5. Detectar quizzes embebidos (buscar patrones comunes)            │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                 FASE 2: ENRIQUECIMIENTO CON IA                      │
├─────────────────────────────────────────────────────────────────────┤
│  ARTIFACT (curso base):                                             │
│  ├─ Generar: idea_central, descripcion                              │
│  ├─ Generar: objetivos[] con taxonomía Bloom                        │
│  └─ Inferir: target_audience, level                                 │
│                                                                     │
│  SYLLABUS:                                                          │
│  ├─ Validar estructura importada                                    │
│  ├─ Generar: objective_specific por lección                         │
│  └─ Estimar: duration_minutes por lección                           │
│                                                                     │
│  INSTRUCTIONAL PLAN:                                                │
│  ├─ Clasificar componentes detectados                               │
│  ├─ Generar: oa_bloom_verb, measurable_criteria                     │
│  └─ Identificar componentes faltantes                               │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│               FASE 3: TRANSFORMACIÓN DE CONTENIDO                   │
├─────────────────────────────────────────────────────────────────────┤
│  READING:                                                           │
│  ├─ Estructurar HTML en sections[]                                  │
│  ├─ Generar: key_points[], reflection_question                      │
│  └─ Calcular: estimated_reading_time                                │
│                                                                     │
│  QUIZ:                                                              │
│  ├─ Parsear preguntas del formato SCORM                             │
│  ├─ Normalizar a formato Courseforge                                │
│  ├─ Generar: explanation por cada pregunta                          │
│  ├─ Clasificar: difficulty, bloom_level                             │
│  └─ Validar: min 3, max 5 preguntas                                 │
│                                                                     │
│  VIDEO:                                                             │
│  ├─ Extraer URL de video embebido                                   │
│  ├─ Generar: script.sections[] desde contenido relacionado          │
│  ├─ Generar: storyboard[] con timecodes estimados                   │
│  └─ Generar: b_roll_prompts para producción                         │
│                                                                     │
│  DIALOGUE (nuevo):                                                  │
│  ├─ Transformar contenido a formato conversacional                  │
│  ├─ Generar: scenes[] con Lia y Usuario                             │
│  └─ Añadir: reflection_prompt                                       │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   FASE 4: VALIDACIÓN Y QA                           │
├─────────────────────────────────────────────────────────────────────┤
│  1. Validar estructura completa (DoD checks)                        │
│  2. Detectar lecciones con contenido insuficiente                   │
│  3. Marcar para revisión manual si:                                 │
│     - Contenido < 500 palabras                                      │
│     - Quiz < 3 preguntas                                            │
│     - Video sin URL válida                                          │
│  4. Generar reporte de importación                                  │
│  5. Estado: SCORM_IMPORTED → READY_FOR_QA                           │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                  FASE 5: COMPLETAR FALTANTES                        │
├─────────────────────────────────────────────────────────────────────┤
│  Si hay gaps críticos:                                              │
│  1. Generar componentes faltantes con IA                            │
│     - DIALOGUE si no hay interactividad                             │
│     - QUIZ si no hay evaluación                                     │
│     - Mejorar READING con puntos clave                              │
│  2. Curacion de fuentes adicionales (opcional)                      │
│  3. Producción visual para videos                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Modelo de Datos Propuesto

### 6.1 Nueva tabla: `scorm_imports`

```sql
CREATE TABLE scorm_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid REFERENCES artifacts(id),

  -- Archivo original
  original_filename text NOT NULL,
  storage_path text NOT NULL,           -- Path al ZIP en storage

  -- Metadata SCORM
  scorm_version text,                   -- '1.2' | '2004'
  manifest_raw jsonb,                   -- imsmanifest.xml parseado

  -- Estructura extraída
  organizations jsonb,                  -- Estructura del curso
  resources jsonb,                      -- Mapeo de recursos
  sco_count integer,                    -- Número de SCOs

  -- Estado de procesamiento
  status text DEFAULT 'UPLOADED',       -- UPLOADED, PARSING, ANALYZED, ENRICHING, TRANSFORMING, COMPLETED, FAILED
  processing_step text,                 -- Paso actual
  error_message text,

  -- Análisis de contenido
  content_analysis jsonb,               -- Resultado del análisis por lección
  detected_components jsonb,            -- Tipos de componentes detectados

  -- Gaps identificados
  gaps_detected jsonb,                  -- Lista de gaps por lección
  enrichment_plan jsonb,                -- Plan de enriquecimiento IA

  -- Tracking
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id)
);
```

### 6.2 Nueva tabla: `scorm_resources`

```sql
CREATE TABLE scorm_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorm_import_id uuid REFERENCES scorm_imports(id),

  -- Identificadores SCORM
  resource_identifier text NOT NULL,    -- identifier del <resource>
  scorm_type text,                      -- 'sco' | 'asset'

  -- Archivos
  href text,                            -- Archivo principal
  files jsonb,                          -- Lista de archivos asociados
  extracted_path text,                  -- Path extraído en storage

  -- Análisis
  content_type text,                    -- READING, VIDEO, QUIZ, DEMO_GUIDE, MIXED
  raw_html text,                        -- HTML principal extraído
  clean_text text,                      -- Texto limpio (strip tags)
  word_count integer,

  -- Assets detectados
  images jsonb,                         -- URLs de imágenes
  videos jsonb,                         -- URLs de videos embebidos
  documents jsonb,                      -- PDFs, etc.

  -- Quiz detectado
  has_quiz boolean DEFAULT false,
  quiz_raw jsonb,                       -- Quiz en formato original
  quiz_transformed jsonb,               -- Quiz en formato Courseforge

  -- Mapeo a Courseforge
  mapped_to_lesson_id text,             -- lesson_id en syllabus
  material_component_id uuid,           -- Componente generado

  created_at timestamptz DEFAULT now()
);
```

### 6.3 Nuevos estados en `artifact_state`

```sql
-- Añadir nuevos estados para flujo SCORM
ALTER TYPE artifact_state ADD VALUE 'SCORM_UPLOADED';
ALTER TYPE artifact_state ADD VALUE 'SCORM_PARSING';
ALTER TYPE artifact_state ADD VALUE 'SCORM_ANALYZED';
ALTER TYPE artifact_state ADD VALUE 'SCORM_ENRICHING';
ALTER TYPE artifact_state ADD VALUE 'SCORM_READY_FOR_QA';
```

---

## 7. Implementación Técnica

### 7.1 Dependencias Necesarias

```json
{
  "dependencies": {
    "jszip": "^3.10.1",           // Extraer ZIP
    "fast-xml-parser": "^4.3.0",  // Parsear XML
    "cheerio": "^1.0.0",          // Parsear HTML
    "sanitize-html": "^2.11.0"    // Limpiar HTML
  }
}
```

### 7.2 Servicio de Parsing (ejemplo)

```typescript
// apps/web/src/domains/scorm/services/scorm-parser.service.ts

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';

interface ScormManifest {
  version: '1.2' | '2004';
  title: string;
  organizations: ScormOrganization[];
  resources: ScormResource[];
}

interface ScormOrganization {
  identifier: string;
  title: string;
  items: ScormItem[];
}

interface ScormItem {
  identifier: string;
  title: string;
  resourceRef?: string;    // identifierref
  children: ScormItem[];   // items anidados
}

interface ScormResource {
  identifier: string;
  type: 'sco' | 'asset';
  href: string;
  files: string[];
}

export async function parseScormPackage(zipBuffer: Buffer): Promise<ScormManifest> {
  const zip = await JSZip.loadAsync(zipBuffer);

  // 1. Buscar imsmanifest.xml en la raíz
  const manifestFile = zip.file('imsmanifest.xml');
  if (!manifestFile) {
    throw new Error('Invalid SCORM package: imsmanifest.xml not found in root');
  }

  // 2. Parsear XML
  const xmlContent = await manifestFile.async('string');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });
  const manifest = parser.parse(xmlContent);

  // 3. Detectar versión
  const version = detectScormVersion(manifest);

  // 4. Extraer estructura
  const organizations = extractOrganizations(manifest);
  const resources = extractResources(manifest);

  return {
    version,
    title: organizations[0]?.title || 'Untitled Course',
    organizations,
    resources
  };
}

function detectScormVersion(manifest: any): '1.2' | '2004' {
  const schemaVersion = manifest?.manifest?.metadata?.schemaversion;
  if (schemaVersion?.includes('2004')) return '2004';
  return '1.2';
}

// ... más funciones de extracción
```

### 7.3 Servicio de Enriquecimiento IA

```typescript
// apps/web/src/domains/scorm/services/scorm-enrichment.service.ts

import { generateWithGemini } from '@/lib/ai/gemini';

interface EnrichmentResult {
  objectives: string[];
  targetAudience: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  description: string;
}

export async function enrichFromScormContent(
  courseTitle: string,
  modulesTitles: string[],
  sampleContent: string
): Promise<EnrichmentResult> {

  const prompt = `
Analiza el siguiente contenido de un curso SCORM y genera:

1. 5-7 objetivos de aprendizaje usando taxonomía de Bloom (verbos: comprender, aplicar, analizar, evaluar, crear)
2. Público objetivo inferido del nivel de complejidad
3. Nivel del curso (beginner, intermediate, advanced)
4. Descripción del curso (2-3 oraciones)

TÍTULO DEL CURSO: ${courseTitle}

MÓDULOS:
${modulesTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

MUESTRA DE CONTENIDO:
${sampleContent.slice(0, 3000)}

Responde en JSON:
{
  "objectives": ["Comprender...", "Aplicar...", ...],
  "targetAudience": "...",
  "level": "beginner|intermediate|advanced",
  "description": "..."
}`;

  const result = await generateWithGemini(prompt, {
    model: 'gemini-2.0-flash',
    temperature: 0.3
  });

  return JSON.parse(result);
}
```

---

## 8. UI Propuesta

### 8.1 Página de Importación SCORM

```
/admin/import-scorm
├── Drag & drop zone para archivo .zip
├── Validación en tiempo real
├── Preview de estructura detectada
│   ├── Módulos y lecciones
│   ├── Tipos de contenido detectados
│   └── Gaps identificados
├── Configuración de enriquecimiento
│   ├── ☑️ Generar objetivos con IA
│   ├── ☑️ Generar explicaciones de quiz
│   ├── ☑️ Crear diálogos con Lia
│   └── ☑️ Generar scripts de video
└── Botón: "Importar y Procesar"
```

### 8.2 Dashboard de Progreso

```
/admin/import-scorm/[import_id]
├── Barra de progreso (5 fases)
├── Log de procesamiento en tiempo real
├── Vista previa de contenido enriquecido
├── Lista de gaps pendientes
└── Acciones: Continuar, Pausar, Cancelar
```

---

## 9. Consideraciones Adicionales

### 9.1 Formatos de Quiz SCORM

Los quizzes en SCORM pueden estar en formatos muy variados:
- HTML puro con JavaScript custom
- Articulate Storyline (JSON específico)
- iSpring (formato propietario)
- Captivate (XML específico)

**Estrategia**: Crear parsers específicos para los formatos más comunes, con fallback a extracción por IA.

### 9.2 Videos Embebidos

Los videos en SCORM pueden estar:
- Embebidos como archivos locales (MP4, WebM)
- Como iframes de YouTube/Vimeo
- Como reproductores Flash (legacy)
- Como HTML5 video tags

**Estrategia**: Detectar patrón y extraer URL. Si es local, subir a Cloudflare/S3.

### 9.3 Limitaciones Conocidas

1. **DRM/Protección**: Algunos SCORM tienen protección que impide extracción
2. **Flash**: Contenido Flash no es parseable
3. **Interactividad compleja**: Simulaciones/juegos no son convertibles
4. **Tamaño**: Paquetes muy grandes pueden tardar mucho

---

## 10. Próximos Pasos

1. **Fase 1 - Infraestructura** (2-3 días)
   - [ ] Crear tablas `scorm_imports` y `scorm_resources`
   - [ ] Implementar upload a storage
   - [ ] Crear servicio de parsing básico

2. **Fase 2 - Parsing Completo** (3-4 días)
   - [ ] Parser de imsmanifest.xml
   - [ ] Extracción de contenido HTML
   - [ ] Detección de tipos de contenido
   - [ ] Extracción de quizzes

3. **Fase 3 - Enriquecimiento IA** (4-5 días)
   - [ ] Generación de objetivos Bloom
   - [ ] Generación de explicaciones de quiz
   - [ ] Transformación a diálogos Lia
   - [ ] Generación de scripts de video

4. **Fase 4 - UI y QA** (2-3 días)
   - [ ] Página de importación
   - [ ] Dashboard de progreso
   - [ ] Integración con flujo existente

5. **Fase 5 - Testing y Refinamiento** (2-3 días)
   - [ ] Testing con paquetes SCORM reales
   - [ ] Ajuste de prompts de IA
   - [ ] Documentación

---

## Fuentes

- [SCORM Content Packaging Specification](https://scorm.com/scorm-explained/technical-scorm/content-packaging/)
- [SCORM 2004 Manifest Structure](https://scorm.com/scorm-explained/technical-scorm/content-packaging/manifest-structure/)
- [SCORM Run-Time Reference](https://scorm.com/scorm-explained/technical-scorm/run-time/run-time-reference/)
- [SCORM 1.2 Overview for Developers](https://scorm.com/scorm-explained/technical-scorm/scorm-12-overview-for-developers/)
- [iSpring SCORM Complete Guide](https://www.ispringsolutions.com/blog/scorm-course)
- [node-sco-parser](https://github.com/Mindflash/node-sco-parser)
