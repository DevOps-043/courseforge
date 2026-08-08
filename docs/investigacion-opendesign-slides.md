# Investigacion: OpenDesign aplicado a generacion de diapositivas en Courseforge

Fecha: 2026-08-08

## 1. Entendimiento del objetivo

El objetivo es analizar `nexu-io/open-design` para identificar que practicas podemos adoptar en Courseforge para que la generacion de diapositivas deje de sentirse como el llenado de una plantilla fija y evolucione hacia una generacion visual mas variable, auditable y extensible.

Restricciones:

- Esta fase es de investigacion, sin codificar cambios de producto.
- La solucion futura debe respetar la arquitectura actual de Courseforge: Next.js, Supabase, jobs de produccion, pipeline de materiales y assets de produccion.
- La generacion de slides debe seguir siendo segura, testeable, auditable por fuentes y operable en produccion.
- La integracion de Nano Banana 2 debe tratarse como proveedor de assets visuales, no como reemplazo del motor pedagogico.

Supuestos:

- Courseforge quiere conservar el flujo actual de material_component -> deck spec -> HTML -> QA -> production_assets.
- La prioridad es mejorar variabilidad visual, calidad de direccion creativa y generacion de imagenes, no reemplazar todo el pipeline.

## 2. Diagnostico tecnico

### Que hace OpenDesign

OpenDesign no genera diapositivas como un `.pptx` tradicional desde cero. Su unidad principal es un artefacto HTML real, navegable, exportable y gobernado por instrucciones. La composicion sigue este flujo:

```text
brief -> plugin/direccion -> design template/skill -> design system -> artifact HTML -> preview/export -> memoria/reuso
```

Los conceptos clave son:

- `skills/`: instrucciones funcionales para el agente.
- `design-templates/`: plantillas renderizables, separadas de las skills funcionales.
- `design-systems/`: contratos de marca en `DESIGN.md`, tokens, componentes y assets.
- `plugins/`: paquetes instalables con workflows, templates, prompts o sistemas de diseno.
- Preview sandboxed en iframe y export a HTML, PDF, PPTX, ZIP, Markdown o MP4.

Para decks, OpenDesign documenta dos familias importantes:

- `guizang-ppt`: deck HTML tipo revista, con 5 direcciones visuales, 5 temas cerrados, 10 layouts y checklist visual.
- `html-ppt`: estudio HTML de presentaciones con 36 temas, 15 full-deck templates, 31 layouts, animaciones, runtime de teclado y presenter mode.

### Diferencia central contra Courseforge

Courseforge ya tiene una base inspirada en OpenDesign:

- Schema formal de deck: `CourseDeckSpec`.
- Render HTML 1920x1080.
- Runtime de navegacion.
- QA estructurado.
- Pipeline con etapas: brief, evidence pack, slide plan, visual direction, chart data, render y quality gate.
- Paquetes tipo `soflia-deck` con manifest, skill markdown, template manifest y ejemplo HTML.

La brecha no es de existencia de pipeline, sino de profundidad del catalogo y gobierno visual:

- OpenDesign tiene multiples direcciones, temas y layouts; Courseforge tiene un vocabulario corto de layouts.
- OpenDesign separa "template visual" de "design system"; Courseforge mezcla bastante direccion visual, tokens y renderer en `soflia-deck`.
- OpenDesign exige checklist visual y preflight de clases/layouts; Courseforge valida contratos tecnicos, pero aun poco de ritmo, variedad, overflow visual real o fatiga visual.
- OpenDesign usa artefactos HTML completos como producto final y fuente viva; Courseforge renderiza HTML desde un spec mas cerrado.
- Courseforge usa placeholders visuales abstractos; OpenDesign trata imagenes como ciudadanos de primera clase.

### Riesgo actual

El sistema puede producir decks correctos pero repetitivos porque la variacion permitida esta limitada a:

- Contenido visible.
- Algunos tipos de slide.
- Algunos tokens de color/tipografia.
- Layouts fijos: center, split, split_reverse, framework, data, closing.

Eso genera consistencia, pero tambien monotonia. La salida no falla tecnicamente; falla como direccion creativa escalable.

## 3. Plan de implementacion futuro

### Fase A: Convertir "SofLIA Deck" en motor de plantillas, no una plantilla unica

Crear un catalogo local de `slide_design_templates` inspirado en `design-templates/` de OpenDesign:

- `soflia-challenger`
- `academic-editorial`
- `technical-blueprint`
- `course-workshop`
- `data-story`
- `magazine-lesson`

Cada template deberia tener:

- `template-manifest.json`
- `skill.md`
- `tokens.css` o JSON de tokens
- `layouts/`
- `quality-checklist.md`
- `examples/`
- metadata de escenario, audiencia, densidad, uso recomendado y limites

Impacto:

- Mantiene compatibilidad con `CourseDeckSpec`.
- Permite que el agente seleccione direccion visual segun audiencia, tema, tipo de componente y objetivo pedagogico.
- Evita hardcodear todos los estilos en `html-deck-renderer.service.ts`.

### Fase B: Ampliar el vocabulario de layouts

Tomar como referencia OpenDesign, pero adaptarlo al dominio educativo. Nuevos layouts recomendados:

- `hero_question`: pregunta detonadora.
- `objective_map`: mapa de resultados de aprendizaje.
- `concept_ladder`: progresion de concepto simple a avanzado.
- `worked_example_steps`: ejemplo paso a paso.
- `mistake_analysis`: errores comunes y correccion.
- `decision_matrix`: comparacion o criterio de decision.
- `practice_brief`: instrucciones de actividad.
- `reflection_prompt`: reflexion individual.
- `source_evidence`: evidencia/fuente destacada.
- `visual_summary`: cierre con sintesis visual.

Impacto:

- Mayor variedad sin sacrificar estructura.
- Mejor alineacion con tipos actuales: concept, worked_example, exercise, knowledge_check, summary, bibliography.

### Fase C: Introducir "visual direction agent" real

Hoy existe una etapa `visual_direction`, pero en la practica el renderer sigue siendo unificado. La etapa deberia decidir:

- template visual.
- ritmo del deck.
- layout por slide.
- densidad.
- uso de imagen, diagrama, chart o tipografia pura.
- reglas de alternancia visual.
- prompts de imagen si aplica.

Salida propuesta:

```json
{
  "templateId": "technical-blueprint",
  "rhythm": ["hero_light", "split", "framework", "dark_break", "worked_example"],
  "slideAssignments": [
    {
      "slideId": "script-section-1",
      "layout": "concept_ladder",
      "visualAssetPolicy": "generate_image",
      "imagePromptId": "asset-01",
      "density": "comfortable"
    }
  ]
}
```

### Fase D: Integrar Nano Banana 2 como proveedor de assets

Nano Banana 2 debe entrar como proveedor de imagenes educativas y B-roll stills, no como generador de decks completos.

Modelos actuales segun documentacion de Google:

- `gemini-3.1-flash-image`: Nano Banana 2, modelo general recomendado.
- `gemini-3.1-flash-lite-image`: Nano Banana 2 Lite, bajo costo/latencia.
- `gemini-3-pro-image`: Nano Banana Pro, mayor calidad y control.
- `gemini-2.5-flash-image`: Nano Banana legacy.

Uso recomendado en Courseforge:

- `gemini-3.1-flash-image` para assets por slide.
- `gemini-3-pro-image` solo para portadas, imagenes hero o assets con alta exigencia de marca/texto.
- `gemini-3.1-flash-lite-image` para borradores o iteraciones masivas.

Nuevo servicio propuesto:

```text
domains/production/images/
  image-generation-provider.types.ts
  nano-banana-image.service.ts
  image-prompt-policy.service.ts
  image-asset-storage.service.ts
  image-generation-qa.service.ts
```

Contrato de asset:

```json
{
  "provider": "google_nano_banana_2",
  "model": "gemini-3.1-flash-image",
  "prompt": "...",
  "negativePromptPolicy": ["no texto pequeno", "no marcas no autorizadas"],
  "slideId": "script-section-2",
  "usage": "hero_image",
  "aspectRatio": "16:9",
  "sourceRefs": ["component.content.script", "curation_row:..."],
  "storagePath": "production-assets/images/...",
  "safety": {
    "synthIdExpected": true,
    "humanReviewRequired": false
  }
}
```

### Fase E: QA visual real

Courseforge ya tiene QA de spec/html. Falta QA visual similar al rigor operativo de OpenDesign:

- Renderizar cada slide a PNG.
- Medir si hay slide no vacia.
- Detectar overflow textual.
- Detectar contraste minimo.
- Detectar repeticion excesiva de layout.
- Detectar 3+ slides consecutivas con mismo ritmo visual.
- Verificar imagenes cargadas y no rotas.
- Validar que imagenes generadas no contengan texto pequeno ilegible.

Esto puede extender `open-design-slide-test.service.ts` y conectarse al endpoint existente `production/open-design/html-to-png`.

## 4. Implementacion propuesta

No se implementa codigo en esta investigacion. La implementacion recomendada, cuando se apruebe, deberia ser incremental:

1. Crear documentacion de contrato para `SlideDesignTemplate`.
2. Extraer los tokens/layouts actuales de `html-deck-renderer.service.ts` a un template `soflia-challenger`.
3. Agregar 2 templates nuevos de bajo riesgo: `academic-editorial` y `technical-blueprint`.
4. Ampliar `CourseSlideLayoutSchema` con layouts pedagogicos.
5. Hacer que `buildVisualAssignmentMap` seleccione template + layout + ritmo.
6. Integrar Nano Banana 2 detras de un provider interface.
7. Guardar imagenes en `production-assets`, enlazadas por slide y job.
8. Ampliar QA con rasterizacion PNG y checks visuales.
9. Exponer en admin una seleccion de direccion visual por deck, con default automatico.

Archivos que probablemente se tocarian:

- `apps/web/src/domains/production/slides/specs/course-deck.schema.ts`
- `apps/web/src/domains/production/slides/render/html-deck-renderer.service.ts`
- `apps/web/src/domains/production/slides/agents/visual-template-selection-agent.service.ts`
- `apps/web/src/domains/production/slides/generation/course-deck-generation-orchestrator.service.ts`
- `apps/web/src/domains/production/validation/open-design-slide-test.service.ts`
- `apps/web/src/app/api/production/slides/generate/route.ts`
- nuevos archivos bajo `apps/web/src/domains/production/images/`

## 5. Riesgos y validaciones

### Riesgos

- Aumentar layouts sin QA visual puede producir slides bonitas pero rotas.
- Permitir HTML generado libremente aumenta superficie XSS; el enfoque seguro es spec declarativo + renderer controlado.
- Generar imagenes por slide aumenta costo y latencia; debe ser asincrono, cacheable e idempotente.
- Nano Banana 2 puede generar texto dentro de imagenes con errores o detalles no verificables; no debe usarse para claims educativos sin fuentes.
- Imagenes con personas, marcas o escenarios sensibles requieren politicas de seguridad y revision humana.
- Si se integra un proveedor directo desde rutas sincronas, `maxDuration = 120` puede quedarse corto en decks grandes.

### Validaciones necesarias

- Unit tests para seleccion de template/layout.
- Contract tests de `CourseDeckSpec`.
- Tests de renderer por cada layout nuevo.
- QA HTML safety: scripts, iframes, handlers, URLs peligrosas.
- Rasterizacion HTML->PNG por slide.
- Snapshot visual por template base.
- Tests de idempotencia de jobs y storage paths.
- Tests de permisos por `organization_id`.
- Pruebas con 5 tipos de cursos: academico, tecnico, soft skills, compliance y producto.

## 6. Mejoras adicionales recomendadas

### Obligatorio antes de codificar Nano Banana 2

- Definir politica de uso de imagenes: que se puede generar, que requiere aprobacion, que se rechaza.
- Centralizar modelo/costo/timeout en `model_settings` o una tabla equivalente.
- Registrar metadata completa del prompt, modelo, slide, usuario/job y storage.
- Implementar cache por hash de prompt + modelo + aspect ratio + seed/config.

### Deseable

- Crear un "template gallery" interno para que admin vea ejemplos antes de generar.
- Permitir regenerar solo assets visuales sin regenerar todo el deck.
- Guardar critique scores por deck: legibilidad, variedad, evidencia, ritmo, densidad.
- Agregar presenter notes y modo presentador si el deck se usa para capacitacion sin video.

## Conclusion

La recomendacion no es copiar OpenDesign completo. Lo valioso es adoptar su separacion conceptual:

```text
contenido pedagogico != direccion visual != template != design system != asset generado != QA visual
```

Courseforge ya tiene una base solida para hacerlo sin reescribir todo. El siguiente salto es convertir `soflia-deck` de una plantilla dominante a un sistema de plantillas versionadas, con layouts pedagogicos, seleccion visual inteligente, imagenes generadas por proveedor y QA visual real.
