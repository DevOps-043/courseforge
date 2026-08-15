# Resumen ejecutivo

## Situación actual

SofLIA - Engine ya dispone de una base técnicamente valiosa para slides: un spec declarativo versionado, generación de copy con fuentes curadas, planificación y creación de imágenes, render HTML determinista, QA estructurado, jobs idempotentes y persistencia auditable. Sin embargo, esa base sigue anclada a `artifactId` y `materialComponentId`, convive con rutas legacy de Gamma y OpenDesign, y su superficie denominada independiente todavía necesita un componente de video existente.

Pulse Hub tiene una separación conceptual más clara para creación agéntica: una Skill activa crea un workspace aislado, el modelo opera mediante herramientas limitadas, escribe primero un guion y después un `deck.json` estricto, el runtime React controla layout y movimiento, y una condición de salida verifica que el entregable exista y sea válido. Su debilidad está en la persistencia local sin versionado, una trazabilidad de evidencia menos fuerte y varias rutas heredadas de WhatsApp/PDF que contradicen el contrato principal.

La oportunidad no consiste en trasladar Pulse Hub completo. Consiste en conservar el núcleo transaccional y pedagógico de SofLIA - Engine y adoptar de Pulse Hub cuatro patrones: proyecto independiente, contrato declarativo controlado por runtime, bucle de herramientas acotado y cierre verificable con autocorrección.

## Hallazgos principales

### 1. El módulo actual de SofLIA - Engine no es realmente independiente

**[CÓDIGO]** `/admin/slides` permite introducir texto o JSON propio, pero toda solicitud exige `componentId`; la API resuelve obligatoriamente un `material_component`, su artefacto, lección y organización. Evidencia: `apps/web/src/app/admin/slides/SofliaEngineSlidesGenerator.tsx`, `apps/web/src/app/api/production/slides/generate/route.ts` y `apps/web/src/domains/production/jobs/production-jobs.service.ts`.

**Impacto:** no puede existir un deck antes o fuera de un curso, ni reutilizarse después en varios consumidores sin simular una pertenencia al pipeline.

### 2. SofLIA - Engine tiene una buena IR de slides, pero varias representaciones paralelas

**[CÓDIGO]** `course-deck-v1` representa slides, notas, citas, claims, gráficas, layout, visuales y sistema de diseño. En paralelo existen:

- HTML SofLIA - Engine;
- `animated-deck-v1` preparado desde HTML para Remotion;
- PNG generados por el exportador denominado OpenDesign;
- URL/ID legacy de Gamma;
- imágenes o HTML subidos manualmente.

**Riesgo:** cada representación tiene reglas, estados y caminos de exportación diferentes; la edición o regeneración no parte de una única fuente canónica.

### 3. Los “agentes” de slides de SofLIA - Engine son mayormente deterministas

**[CÓDIGO]** `deck-brief-agent`, `lesson-evidence-agent`, `slide-strategy-agent`, `visible-copy-agent` y `visual-template-selection-agent` no llaman a un proveedor de IA. Los prompts y modelos se resuelven y se registran en los stages, pero solo `visible-copy-synthesis-agent.service.ts` realiza síntesis LLM; la generación de imágenes llama a OpenAI por separado.

**[DISCREPANCIA]** La migración `20260806143000_scope_slide_agent_prompts.sql` describe siete agentes configurables, pero varios prompts no gobiernan la decisión efectiva de sus servicios homónimos.

**Oportunidad:** conservar esas reglas como herramientas deterministas del futuro agente y reservar el LLM para decisiones donde aporte valor, en vez de convertir cada stage en una llamada costosa.

### 4. Pulse Hub separa mejor contenido generado y runtime

**[CÓDIGO]** El modelo solo escribe `guion.md`, `deck.json` e imágenes. No puede escribir HTML, JSX, CSS, Tailwind ni coordenadas. `PresentationPlayerApp.tsx` selecciona composiciones probadas y aplica Framer Motion. El schema limita arquetipos, densidad, imágenes, gráficos y movimiento.

**Valor transferible:** el agente expresa intención; el runtime conserva geometría, accesibilidad, branding y comportamiento.

### 5. Pulse Hub sí implementa un bucle agéntico operativo

**[CÓDIGO]** La Skill dispone de herramientas para listar, leer, escribir y editar archivos, generar imágenes y descargar imágenes. Los loops Gemini/OpenAI pueden continuar hasta que el workspace confirme que `deck.json` existe y pasa Zod; si el modelo intenta terminar antes, se reinyecta una instrucción de reparación. Evidencia: `src/services/gemini-chat/workspace-completion.ts`, `src/services/gemini-chat/agentic-loop.ts` y `src/services/openai-chat/send-message-stream.ts`.

**Limitación:** la compuerta solo demuestra existencia y validez de schema, no calidad narrativa, fidelidad factual ni ausencia de overflow visual.

### 6. La validación visual de Pulse Hub no está cerrada en el runtime actual

**[CÓDIGO]** `PresentationPreview.tsx` espera un mensaje `pulse-presentacion-calidad`, pero el emisor encontrado está en `electron/organization-branding/deck-base-js.ts`, perteneciente al runtime HTML heredado. No se encontró un emisor equivalente en `PresentationPlayerApp.tsx`.

**[INFERENCIA]** En decks React actuales, el badge de calidad puede quedar sin informe. Debe confirmarse ejecutando la aplicación.

### 7. Ambos productos arrastran rutas legacy que confunden el contrato

- SofLIA - Engine conserva Gamma manual y un exportador `/open-design/export` que en realidad crea HTML/PNG internos sin integrar OpenDesign.
- Pulse Hub conserva un workflow WhatsApp que usa la política `deck.json` pero pide HTML al modelo, y un `create_document` que acepta “pptx/powerpoint” pero produce PDF.

Estas rutas no deberían definir el nuevo módulo; deben encapsularse como adaptadores de compatibilidad o retirarse deliberadamente.

## Fortalezas a conservar

### SofLIA - Engine

- Spec pedagógico auditable con `speakerNotes`, `validationHints`, fuentes y gráficos.
- Jobs, idempotencia, estados de proveedor y snapshots.
- `production_assets` y bucket para outputs reproducibles.
- QA determinista que bloquea `FAIL`.
- Integración con fuentes aprobadas y multi-tenancy.
- Adaptación a producción de video y Remotion.

### Pulse Hub

- Proyecto/workspace independiente de otros dominios.
- Herramientas acotadas y reparación basada en estado real.
- Separación LLM → IR → runtime.
- Branding protegido que el modelo no puede sobrescribir.
- Continuidad de edición conversacional sobre el mismo workspace.
- Importación prioritaria de visuales de la fuente.

## Riesgos principales

1. **Acoplamiento de identidad:** `artifact_id` y `material_component_id` son obligatorios en jobs/assets y en el schema actual de SofLIA - Engine.
2. **Fuentes de verdad múltiples:** JSON, HTML, PNG, `material_components.assets` y filas de `production_assets` pueden divergir.
3. **Versionado insuficiente:** regenerar sobrescribe rutas estables de spec/HTML/QA en SofLIA - Engine y editar sobrescribe archivos en Pulse Hub.
4. **Nombres que exageran capacidades:** agentes sin LLM, OpenDesign sin integración real, “pptx” que genera PDF y comentarios de PDF donde se entrega HTML.
5. **QA incompleto:** SofLIA - Engine valida estructura y seguridad, pero no ejecuta captura/visión del deck; Pulse Hub tiene señales de QA visual heredadas pero no un gate demostrado en el runtime React.
6. **HITL inconsistente:** Pulse Hub prescribe confirmación de enfoque y outline; SofLIA - Engine permite regeneración completa sin un brief/outline persistido y aprobable.
7. **Coste y latencia:** generación secuencial de imágenes y bucles de hasta 20 iteraciones requieren presupuestos explícitos.

## Recomendación central

**[RECOMENDACIÓN]** Crear un dominio `SlideProject` independiente, versionado y multi-tenant. Un proyecto debe poder originarse desde un brief libre, archivos, URL o un adaptador del pipeline. El pipeline no será su propietario: solo creará o vinculará un proyecto y consumirá una versión aprobada.

La fuente canónica debe ser una IR declarativa que combine lo mejor de `course-deck-v1` y el control de arquetipos de Pulse Hub. Desde esa IR se derivan HTML interactivo, frames PNG, PDF/PPTX futuro y el adaptador Remotion. HTML y PNG pasan a ser builds, nunca documentos maestros.

El agente recomendado no debe “escribir slides” directamente. Debe orquestar herramientas de ingesta, outline, evidencia, composición, selección visual, render, QA y reparación, con límites de iteración/coste y gates humanos explícitos.

## Prioridad sugerida

1. Separar identidad y persistencia del deck respecto de materiales, sin cambiar todavía el renderer.
2. Unificar IR y versionado; declarar derivados y lineage.
3. Extraer generadores/validadores actuales como herramientas puras.
4. Añadir workspace conversacional y orquestador agéntico.
5. Incorporar QA visual basado en render real y reparación localizada.
6. Añadir exportadores adicionales solo después de estabilizar la fuente canónica.

