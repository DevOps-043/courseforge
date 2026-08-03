# Plan: Modulo Hibrido de Slides OpenDesign + Hanademi

Fecha: 2026-08-01

Fuentes:

- Prompt maestro: `prompt_maestro.md`
- Investigacion Hanademi: `docs/HANADEMI_DECK_SVG_IMPLEMENTATION_NOTES.md`
- Investigacion OpenDesign previa: `docs/OPEN_DESIGN_TO_COURSEFORGE_VIDEO_AUTOMATION_ANALYSIS.md`
- Repositorio OpenDesign: `https://github.com/nexu-io/open-design`
- OpenDesign `html-ppt`: `design-templates/html-ppt/SKILL.md`
- OpenDesign `html-ppt-course-module`: `design-templates/html-ppt-course-module/SKILL.md`
- OpenDesign layouts: `design-templates/html-ppt/references/layouts.md`
- OpenDesign course module template: `design-templates/html-ppt/templates/full-decks/course-module/`

## 1. Entendimiento del objetivo

Se requiere un modulo separado del flujo actual, pero integrable dentro de Fase 6, para generar diapositivas de cursos en Courseforge.

El modulo debe combinar dos referencias:

- OpenDesign: tomar su enfoque visual para decks bonitos, funcionales, con templates, tokens, runtime HTML, presenter notes y export.
- Hanademi: tomar solamente el enfoque de graficas SVG, porque sus charts son mas adecuados como salida responsive/exportable que las graficas genericas de OpenDesign.

Restriccion principal: no dejar la responsabilidad completa a un solo agente. La generacion debe pasar por pasos separados con contratos, validaciones y QA.

## 2. Diagnostico tecnico

### 2.1 Que aporta OpenDesign

OpenDesign aporta un modelo visual y operativo, no un runtime SaaS listo para copiar.

Hallazgos relevantes:

- Usa `SKILL.md` como contrato portable de capacidad.
- Usa `DESIGN.md` como contrato visual y de marca.
- En `html-ppt`, los decks son HTML estatico con:
  - `.deck`
  - `<section class="slide">`
  - `assets/base.css`
  - temas por CSS variables
  - `runtime.js` para navegacion, presenter mode, overview y deep-links
  - layouts reutilizables
  - speaker notes ocultas
- El template `course-module` ya modela una estructura pedagogica util:
  - cover
  - objetivos
  - concepto
  - ejemplo trabajado
  - ejercicio
  - check de entendimiento
  - resumen
- El catalogo de layouts incluye covers, toc, bullets, columnas, KPIs, tablas, charts, codigo, terminal, diagramas, timeline, roadmap, comparativas y cierre.

Lo que no se debe copiar directamente:

- Daemon local.
- Ejecucion de agentes CLI.
- Filesystem `.od` como fuente de verdad.
- Skills arbitrarios desde carpetas sin revision.
- Chart.js como motor principal de graficas educativas exportables.

### 2.2 Que aporta Hanademi

Hanademi aporta un patron de graficas SVG inline:

- SVG como fuente visual canonica.
- `viewBox` fijo y escalado vectorial responsive.
- Graficas compuestas con `rect`, `line`, `path`, `circle`, `text`.
- Coordenadas calculadas antes del render.
- Export PNG/PDF desde SVG.
- Animaciones controladas por CSS y `pathLength`.

Decision clave: no adoptar el layout 4:3 de Hanademi como base del modulo. Courseforge y OpenDesign ya operan naturalmente en 16:9, especialmente para Remotion y video. Debemos adaptar el motor de graficas de Hanademi a un canvas logico `1920x1080`.

### 2.3 Estado actual de Courseforge

Courseforge ya tiene una base aprovechable:

- `production_jobs`
- `production_assets`
- RLS por `organization_id`
- idempotencia por `(organization_id, idempotency_key)`
- `MaterialAssets.slides`
- `assets.slides.animated_deck`
- endpoint `api/production/slides/animated-deck/prepare`
- endpoint `api/production/open-design/html-to-png`
- importacion/control de assets remotos
- preprocesador que elimina scripts, scopa CSS, valida URLs remotas y prepara deck para Remotion
- providers y credenciales para HeyGen como patron de integracion

Riesgo actual detectado: `api/production/open-design/export` genera HTML interpolando contenido en strings. Ese patron no debe crecer como generador principal porque mezcla extraccion, diseno, render, storage y HTML string building. Ademas, cualquier interpolacion HTML debe escapar/sanitizar contenido para prevenir inyeccion.

## 3. Decision arquitectonica

Crear un modulo interno separado:

```text
apps/web/src/domains/production/slides/
```

El modulo debe generar un `CourseDeckSpec` estructurado y luego renderizarlo de forma deterministica.

Regla de oro:

```text
La IA planifica y propone specs.
El sistema valida, renderiza, exporta y sincroniza.
```

No permitir:

```text
material aprobado -> agente unico -> HTML final -> publicacion
```

Usar:

```text
material aprobado
  -> deck brief
  -> slide plan
  -> evidence + chart data
  -> visual spec
  -> deck spec validado
  -> render HTML deterministico
  -> prepare animated deck
  -> export PNG / Remotion
  -> QA
  -> sync a material_components.assets
```

## 4. Modelo hibrido propuesto

### 4.1 Capas del modulo

```text
apps/web/src/domains/production/slides/
  specs/
    course-deck.schema.ts
    slide.schema.ts
    chart.schema.ts
    design-token.schema.ts
  planning/
    deck-brief.service.ts
    slide-plan.service.ts
    slide-plan.prompt.ts
  evidence/
    slide-evidence.service.ts
    chart-data-extractor.service.ts
    claim-grounding.service.ts
  visual/
    open-design-template-catalog.ts
    course-module-template.service.ts
    visual-direction.service.ts
  charts/
    chart-layout.service.ts
    svg-chart-renderer.service.ts
    renderers/
      bar-chart.svg.ts
      line-chart.svg.ts
      area-chart.svg.ts
      proportion-chart.svg.ts
      lollipop-chart.svg.ts
      waterfall-chart.svg.ts
  render/
    html-deck-renderer.service.ts
    slide-html-renderer.service.ts
    deck-css-renderer.service.ts
  validation/
    deck-spec.validator.ts
    chart-spec.validator.ts
    slide-html-security.validator.ts
    visual-regression-checklist.ts
  jobs/
    slide-production-orchestrator.service.ts
  sync/
    slide-assets-sync.service.ts
```

### 4.2 Contrato principal

```ts
type CourseDeckSpec = {
  schemaVersion: "course-deck-v1";
  artifactId: string;
  materialComponentId: string;
  locale: "es" | "en";
  format: "16:9";
  width: 1920;
  height: 1080;
  template: "course-module" | "concept-lesson" | "demo-guide" | "data-explainer";
  designSystem: CourseDeckDesignSystem;
  slides: CourseSlideSpec[];
  sourceSnapshot: CourseDeckSourceSnapshot;
};
```

```ts
type CourseSlideSpec = {
  id: string;
  order: number;
  slideType:
    | "cover"
    | "objectives"
    | "concept"
    | "worked_example"
    | "exercise"
    | "knowledge_check"
    | "summary"
    | "data_explainer"
    | "diagram"
    | "quote"
    | "transition";
  title: string;
  subtitle?: string;
  bodyBlocks: SlideBodyBlock[];
  speakerNotes?: string;
  chart?: CourseChartSpec;
  citations: SlideCitation[];
  validationHints: {
    learningObjectiveId?: string;
    sourceRefs: string[];
    mustKeepClaims: string[];
  };
};
```

### 4.3 Contrato de graficas

Inspirado en Hanademi, pero semantico antes de SVG:

```ts
type CourseChartSpec =
  | BarChartSpec
  | LineChartSpec
  | AreaChartSpec
  | ProportionChartSpec
  | LollipopChartSpec
  | WaterfallChartSpec;
```

Cada chart debe contener:

- tipo
- titulo interno
- dataset semantico
- unidades
- escala sugerida
- source refs
- callouts
- precision numerica
- reglas de formato

El SVG generado es salida derivada, no fuente primaria.

## 5. Orquestacion por pasos

### Paso 0 - Elegibilidad

Entrada:

- componente `VIDEO_THEORETICAL` o `VIDEO_GUIDE`
- opcionalmente `DEMO_GUIDE` si se necesita deck de soporte
- materiales aprobados
- storyboard/script disponibles

Validaciones:

- componente pertenece a la organizacion activa
- Paso 5 aprobado o componente generado
- no hay job equivalente exitoso con misma idempotency key

Salida:

- `production_job` con `job_type = SLIDE_DECK_GENERATION`
- `input_snapshot` completo

### Paso 1 - Deck Brief

Responsabilidad: construir un brief tecnico-pedagogico desde el material.

No usa creatividad visual aun. Solo normaliza:

- objetivo de aprendizaje
- audiencia
- tipo de componente
- duracion estimada
- storyboard
- script
- fuentes
- tono de marca
- cantidad objetivo de slides
- restricciones de idioma

Salida:

- `DeckBrief`

### Paso 2 - Plan de Slides

Responsabilidad del primer agente/modelo:

- proponer estructura narrativa
- decidir que slides son necesarias
- no producir HTML
- no inventar datos
- marcar donde se requiere grafica, tabla o diagrama

Salida:

- `SlidePlan`

Validacion:

- cubre objetivo de aprendizaje
- no excede max slides por componente
- cada slide tiene proposito
- no duplica contenido

### Paso 3 - Evidencia y Datos

Responsabilidad del segundo agente/modelo o servicio:

- extraer claims permitidos
- seleccionar cifras existentes
- detectar si hay datos suficientes para una grafica
- producir `ChartDataCandidate[]`

Salida:

- `SlideEvidencePack`
- `ChartDataCandidate[]`

Validacion:

- cada claim tiene fuente o proviene de material aprobado
- no hay numeros sin trazabilidad
- datos para chart son suficientes y tipados

### Paso 4 - Direccion Visual

Responsabilidad:

- elegir template inspirado en OpenDesign
- elegir layout por slide
- aplicar tokens Courseforge/SofLIA
- no generar charts aun

Templates iniciales recomendados:

- `course-module`: default para modulos educativos
- `data-explainer`: cuando hay charts importantes
- `demo-guide`: cuando domina una guia paso a paso
- `concept-lesson`: cuando domina explicacion teorica

Salida:

- `VisualDirectionSpec`

### Paso 5 - Deck Spec

Responsabilidad del tercer agente/modelo:

- producir `CourseDeckSpec` JSON
- incluir speaker notes
- incluir citations
- incluir chart specs semanticos
- no producir HTML final

Validacion:

- Zod schema estricto
- limites de longitud por slide
- no presenter-only text en contenido visible
- idioma consistente
- citas presentes cuando hay claims

### Paso 6 - Render deterministico

Responsabilidad del sistema:

- convertir `CourseDeckSpec` a HTML deck estilo OpenDesign
- usar tokens CSS, no colores literales
- insertar charts como SVG inline generado por `svg-chart-renderer.service`
- generar `.slide` compatible con preprocesador actual
- guardar HTML en `production-assets`

Salida:

- `production_asset` tipo `SLIDE_DECK_HTML`
- mirror opcional a `material_components.assets.slides.html_content_path`

### Paso 7 - Preparacion para preview/render

Reusar endpoint/servicio existente:

- `prepareAnimatedDeckForRemotion`
- importacion de assets remotos
- limpieza de scripts
- scoping CSS
- validacion de URLs
- `assets.slides.animated_deck`

Salida:

- `production_asset` tipo `SLIDE_DECK_SPEC`
- `assets.slides.animated_deck.status = READY_FOR_RENDER`

### Paso 8 - Export

Opciones:

- PNG por slide con rasterizador actual.
- Remotion render para video assembly.
- PDF/PPTX en fase posterior.

Salida:

- `production_asset` tipo `SLIDE_IMAGE_SET`
- `MaterialAssets.slides.images`

### Paso 9 - QA

No se publica automaticamente.

QA revisa:

- precision pedagogica
- claims/fuentes
- legibilidad
- layout
- charts
- contraste
- duracion/uso en video

Salida:

- `production_assets.qa_status = APPROVED | REJECTED`
- solo approved se sincroniza a flujos de video/publicacion

## 6. Extensiones al dominio `production`

### 6.1 Nuevos job types

Agregar a `PRODUCTION_JOB_TYPES`:

```ts
SLIDE_DECK_GENERATION: "SLIDE_DECK_GENERATION",
SLIDE_DECK_EXPORT: "SLIDE_DECK_EXPORT",
SLIDE_DECK_PREPARE: "SLIDE_DECK_PREPARE",
```

### 6.2 Nuevos asset types

Agregar a `PRODUCTION_ASSET_TYPES`:

```ts
SLIDE_DECK_SPEC: "SLIDE_DECK_SPEC",
SLIDE_DECK_HTML: "SLIDE_DECK_HTML",
SLIDE_IMAGE_SET: "SLIDE_IMAGE_SET",
SLIDE_CHART_SPEC: "SLIDE_CHART_SPEC",
```

### 6.3 Nuevo provider

Agregar a `PRODUCTION_PROVIDERS`:

```ts
COURSEFORGE_SLIDES: "courseforge_slides",
```

No llamarlo `open_design` como provider principal. OpenDesign aqui es referencia de template, no proveedor externo productivo.

## 7. Integracion con flujo actual

### Como modulo aparte

Exponer rutas internas:

```text
POST /api/production/slides/generate
POST /api/production/slides/prepare
POST /api/production/slides/export-png
POST /api/production/slides/approve
```

### Como parte de Fase 6

En `ProductionAssetCard` o contenedor equivalente:

- boton "Generar slides Courseforge"
- mostrar job status
- mostrar preview HTML/PNG
- permitir preparar deck animado
- permitir exportar PNG
- bloquear uso en video si QA esta rechazada

### Compatibilidad con campos existentes

Mantener mirror controlado:

- `assets.slides.html_content_path`
- `assets.slides.animated_deck`
- `assets.slides.images`
- `assets.slides_url` como fallback de primera imagen o URL preview
- `assets.production_status`
- `assets.final_video_assembly_stale = true` cuando cambien slides

`material_components.assets` sigue siendo cache operacional, no fuente unica.

## 8. Seguridad

Reglas obligatorias:

- Nunca aceptar HTML final del modelo sin sanitizacion.
- El modelo produce JSON spec, no HTML ejecutable.
- El renderer HTML es codigo nuestro.
- Escapar todo texto al renderizar HTML.
- Permitir solo assets remotos HTTPS y descargarlos/importarlos con limites.
- Bloquear scripts, iframes, forms, event handlers y fetch/WebSocket en preview/render.
- Mantener `organization_id` en jobs/assets.
- Usar service role solo en servidor.
- No incluir secretos ni dumps de base de datos en prompts.
- Registrar errores normalizados sin PII.

Riesgo especifico a corregir antes de escalar:

- `api/production/open-design/export` interpola textos en HTML. Si ese endpoint sigue existiendo, debe escaparse todo contenido o moverse al renderer deterministico.

## 9. QA y validaciones

### Validacion automatica

- `CourseDeckSpec` parsea con Zod.
- Todas las slides tienen titulo y proposito.
- Cada chart tiene dataset valido.
- Cada claim numerico tiene source ref.
- No hay placeholders.
- No hay HTML crudo no permitido en textos.
- Longitudes maximas por slide.
- Ratio 16:9.
- CSS dentro de limite.
- PNG exportable por cada slide.

### QA humana

- El deck ensena el objetivo correcto.
- El orden narrativo funciona.
- Las graficas no exageran ni distorsionan.
- Las notas del speaker corresponden a la narracion.
- El diseno no sacrifica legibilidad.
- Las slides pueden usarse en composicion de video.

## 10. Plan de implementacion incremental

### Fase 1 - Contratos y render minimo

Entregables:

- schemas `CourseDeckSpec`, `CourseSlideSpec`, `CourseChartSpec`
- renderer HTML deterministico
- renderer SVG para `bar`, `line`, `area`, `proportion`
- tests unitarios de charts y escaping

No incluye IA todavia.

### Fase 2 - Orquestador con input real

Entregables:

- `slide-production-orchestrator.service`
- `DeckBrief` desde componente real
- `production_job` con idempotencia
- guardar `SLIDE_DECK_SPEC` y `SLIDE_DECK_HTML`
- mirror a `MaterialAssets.slides`

### Fase 3 - Generacion IA por etapas

Entregables:

- prompt de slide plan
- prompt de evidence/chart extraction
- prompt de deck spec
- validadores entre cada paso
- retry solo de la etapa fallida

### Fase 4 - Preview/export integrado

Entregables:

- UI en Fase 6
- preparar animated deck
- export PNG
- mostrar imagenes generadas
- marcar `final_video_assembly_stale`

### Fase 5 - QA y aprobacion

Entregables:

- `qa_status` por asset
- approve/reject
- bloqueo de publicacion/render final si no esta aprobado
- eventos en `pipeline_events`

### Fase 6 - Ampliacion

Entregables opcionales:

- PDF/PPTX export
- mas tipos de charts
- design systems por organizacion
- templates adicionales inspirados en OpenDesign
- generacion por modulo completo, no solo componente

## 11. Criterios de aceptacion del MVP

El MVP es aceptable si:

- genera un deck 16:9 desde un componente de video aprobado
- guarda spec, HTML e imagenes como `production_assets`
- actualiza `material_components.assets.slides`
- genera al menos charts `bar`, `line`, `area`, `proportion`
- no permite HTML arbitrario del modelo
- usa jobs idempotentes
- soporta preview/export PNG
- deja QA antes de usar las slides en video/publicacion
- tiene tests unitarios de schemas, chart layout, escaping y sync

## 12. Decision final recomendada

Adoptar OpenDesign como inspiracion de sistema visual y Hanademi como inspiracion de graficas, pero implementar un modulo Courseforge propio:

```text
OpenDesign visual templates + Courseforge pedagogical specs + Hanademi SVG charts
```

El modulo debe ser primero deterministico y testeable. La IA entra por etapas, generando specs revisables, no HTML final ni assets publicables directamente.

