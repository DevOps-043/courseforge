# Inventario de evidencia

Las rutas se muestran relativas a la raíz de cada repositorio salvo que se indique lo contrario.

**Clasificación de esta sección:** la existencia y función observable de los archivos se registra como **[CÓDIGO]**; una entrada no acredita por sí sola que el flujo esté desplegado, habilitado o utilizado en producción.

## SofLIA - Engine (`D:\Pulse Hub\courseforge`)

### Entradas y UI

| Ruta | Función |
|---|---|
| `apps/web/src/app/admin/slides/page.tsx` | Dashboard de decks recientes y candidatos; consulta `production_assets` y componentes de video. |
| `apps/web/src/app/admin/slides/SofliaEngineSlidesGenerator.tsx` | Entrada manual de texto/JSON y llamada a `/api/production/slides/generate`; exige `componentId`. |
| `apps/web/src/domains/materials/hooks/useProductionAssetState.ts` | Orquesta UI de producción: SofLIA slides, OpenDesign legacy, Gamma, uploads y preparación animada. |
| `apps/web/src/domains/materials/components/ProductionAssetGammaSection.tsx` | Flujo manual de Gamma, copia de contenido, URL y preview. |
| `apps/web/src/app/admin/slides/templates/SlideTemplateStudioClient.tsx` | Conversación/spec/generación de paquetes `slide_template`. |

### Pipeline y API

| Ruta | Función |
|---|---|
| `apps/web/netlify/functions/video-prompts-generation.ts` | Genera B-roll y prepara un `CourseDeckSpec` determinista desde storyboard. |
| `apps/web/src/app/api/production/slides/generate/route.ts` | API principal: auth, contexto, jobs, fuentes, generación, imágenes, QA, storage y persistencia. |
| `apps/web/src/app/api/production/slides/animated-deck/prepare/route.ts` | Convierte/importa HTML a `animated-deck-v1` consumible por Remotion. |
| `apps/web/src/app/api/production/slides/html-preview/route.ts` | Preview HTML de producción. |
| `apps/web/src/app/api/admin/slides/html-preview/route.ts` | Preview HTML administrativo. |
| `apps/web/src/app/api/production/open-design/export/route.ts` | Generador interno legacy de HTML/PNG; no contiene llamada OpenDesign. |

### IR, planificación y render

| Ruta | Función |
|---|---|
| `apps/web/src/domains/production/slides/specs/course-deck.schema.ts` | Schema `course-deck-v1`, slides, charts, visual assets y design system. |
| `apps/web/src/domains/production/slides/generation/course-deck-generation-orchestrator.service.ts` | Stages de generación y quality gate. |
| `apps/web/src/domains/production/slides/planning/course-deck-from-component.service.ts` | Convierte custom input/script/storyboard en spec. |
| `apps/web/src/domains/production/slides/render/html-deck-renderer.service.ts` | Render HTML determinista. |
| `apps/web/src/domains/production/slides/charts/svg-chart-renderer.service.ts` | Render declarativo de gráficas SVG. |
| `apps/web/src/domains/production/slides/charts/instructional-chart-agent.service.ts` | Construcción determinista de gráficos instruccionales. |
| `apps/web/src/domains/production/validation/animated-deck-preprocessor.service.ts` | Sanitización, extracción y validación del deck HTML para Remotion. |

### “Agentes”, prompts y modelos

| Ruta | Función |
|---|---|
| `apps/web/src/domains/production/slides/agents/deck-brief-agent.service.ts` | Brief determinista; no invoca LLM. |
| `apps/web/src/domains/production/slides/agents/lesson-evidence-agent.service.ts` | Evidence pack determinista. |
| `apps/web/src/domains/production/slides/agents/slide-strategy-agent.service.ts` | Plan/tipos de slide deterministas. |
| `apps/web/src/domains/production/slides/agents/visible-copy-agent.service.ts` | Copy base determinista. |
| `apps/web/src/domains/production/slides/agents/visible-copy-synthesis-agent.service.ts` | Único agente de copy que invoca OpenAI/Gemini y puede reparar idioma. |
| `apps/web/src/domains/production/slides/agents/visual-template-selection-agent.service.ts` | Asignación determinista de layouts. |
| `apps/web/src/domains/production/slides/agents/slide-agent-prompt-codes.ts` | Códigos/scope de prompts y model settings. |
| `apps/web/src/domains/production/slides/agents/slide-agent-prompt-resolver.service.ts` | Overrides por organización, globales y defaults de modelo. |
| `supabase/migrations/20260806143000_scope_slide_agent_prompts.sql` | Seeds de prompts y modelos para siete responsabilidades de slides. |
| `supabase/migrations/20260807100000_update_slide_visible_copy_titles_prompt.sql` | Evolución del prompt de copy visible. |
| `supabase/migrations/20260807101500_update_slide_strategy_fillability_prompt.sql` | Evolución del prompt de estrategia. |
| `supabase/migrations/20260808130000_add_slide_image_generation_model_setting.sql` | Configuración de modelo de imágenes. |

### Fuentes, imágenes y QA

| Ruta | Función |
|---|---|
| `apps/web/src/domains/production/slides/data/slide-source-pack-loader.service.ts` | Carga fuentes aprobadas de `curation_rows`. |
| `apps/web/src/domains/production/slides/content/slide-source-pack.service.ts` | Normaliza insights y claims de fuentes. |
| `apps/web/src/domains/production/slides/content/slide-copy-policy.service.ts` | Presupuestos y validación de copy/idioma. |
| `apps/web/src/domains/production/slides/content/slide-visible-content.service.ts` | Extracción de contenido visible y detección de fuga de narración. |
| `apps/web/src/domains/production/slides/visuals/slide-visual-asset-planning.service.ts` | Planifica fondos y visuales de apoyo con límites. |
| `apps/web/src/domains/production/slides/visuals/slide-visual-asset-generation.service.ts` | Genera imágenes, persiste hashes/jobs/assets y aplica fallback de modelo. |
| `apps/web/src/domains/production/slides/validation/course-deck-qa.service.ts` | QA determinista bloqueante. |

### Persistencia y estados

| Ruta/tabla | Función |
|---|---|
| `supabase/migrations/20260523143000_create_production_jobs_assets.sql` | Crea `production_jobs` y `production_assets`, RLS, estados e índices. |
| `apps/web/src/domains/production/jobs/production-jobs.service.ts` | Contexto obligatorio de componente, idempotencia, creación/completado/fallo. |
| `apps/web/src/domains/production/types/production.types.ts` | Catálogo de job/asset/provider/QA statuses. |
| `apps/web/src/domains/materials/types/materials.types.ts` | `MaterialAssets`, estados de producción, Gamma, slides y animated deck. |
| `material_components.assets` | Copia mutable del último estado de slides y dependencias de producción. |
| `production_jobs` | Trazas de ejecuciones y snapshots. |
| `production_assets` | Specs, HTML, QA, imágenes y metadata. |
| Storage `production-assets` | JSON, HTML, QA, imágenes y animated deck. |

### Skill y plantillas

| Ruta | Función |
|---|---|
| `apps/web/src/domains/production/slides/templates/soflia-deck/soflia-deck.skill.md` | Instrucción de autoría HTML de la plantilla SofLIA. |
| `apps/web/src/domains/production/slides/templates/soflia-deck/soflia-deck.skill-manifest.json` | Triggers/tokens/vocabulario/output del skill. |
| `apps/web/src/domains/production/slides/templates/soflia-deck/soflia-deck.template-manifest.json` | Canvas, inputs, layouts, charts y QA policy de template. |
| `apps/web/src/domains/production/slides/templates/soflia-deck/example.html` | Template HTML de referencia. |
| `items/soflia-deck-SKILL.md` | Copia distribuible del skill. |
| `apps/web/src/domains/production/bundle-agent/slide-template-package.service.ts` | Empaquetado de plantillas de slides. |
| `supabase/migrations/20260707120000_create_soflia_bundle_agent.sql` | Conversaciones, mensajes, specs y runs del bundle agent. |
| `supabase/migrations/20260806165000_scope_bundle_agent_conversations_by_artifact_kind.sql` | Separa conversaciones por tipo de artefacto, incluido `slide_template`. |

### Consumo de video y pruebas

| Ruta | Función |
|---|---|
| `apps/web/src/remotion/components/AnimatedDeckSlide.tsx` | Render de slides animadas en Remotion. |
| `apps/web/src/remotion/components/SlideShow.tsx` | Slideshow para composición. |
| `apps/web/src/remotion/components/slide-timeline-rendering.ts` | Timing de slides. |
| `apps/web/src/domains/production/slides/__tests__/course-deck-renderer.test.ts` | Cobertura del renderer/QA. |
| `apps/web/src/domains/production/validation/__tests__/animated-deck-preprocessor.service.test.ts` | Cobertura del preprocesador animado. |
| `apps/web/src/domains/production/validation/__tests__/open-design-slide-test.service.test.ts` | Cobertura del validador legacy OpenDesign. |

## Pulse Hub (`D:\Pulse Hub\SofLIA-HUB`)

### Documentos y contratos

| Ruta | Función |
|---|---|
| `docs/prompt_maestro.md` | Alias; remite al estándar canónico y no describe slides. |
| `docs/standards/engineering-practices.md` | Reglas generales de arquitectura, seguridad, HITL y QA. |
| `ai-specs/skills/presentaciones-hyperframes-react/SKILL.md` | Guía específica de presentación React/HyperFrames. |
| `src/prompts/skills/presentaciones.ts` | Prompt runtime actual y constante legacy para HTML. |
| `src/shared/presentations/deck-schema.ts` | Schema Zod de `deck.json` y arquetipos. |
| `src/shared/skills/presentaciones-skill.ts` | Manifiesto, surfaces, tools y política de workspace. |
| `src/shared/skills/registry.ts` | Registro versionado de Skills del sistema. |
| `src/shared/skills/system-catalog.ts` | Merge con catálogo remoto y protección del contrato local de Presentaciones. |

### Activación y agente

| Ruta | Función |
|---|---|
| `src/adapters/desktop_ui/chat-ui/useSkillCommands.ts` | Activación por `/presentacion`. |
| `src/services/skills/active-skill.ts` | Crea/reanuda workspace, prepara marca y contexto. |
| `src/adapters/desktop_ui/chat-ui/resolve-turn-skill.ts` | Recupera la Skill para follow-ups de edición. |
| `src/services/gemini-chat/send-message-stream.ts` | Routing, contexto de navegador, visuales fuente y tool loop. |
| `src/services/gemini-chat/agentic-loop.ts` | Loop Gemini y reparación de workspace incompleto. |
| `src/services/openai-chat/send-message-stream.ts` | Loop OpenAI, hasta 20 iteraciones con workspace, budgets y reparación. |
| `src/services/gemini-chat/workspace-completion.ts` | Gate que exige `deck.json` válido. |
| `src/services/gemini-tools/skill-workspace-tools.ts` | Declaración de tools. |
| `src/services/gemini-chat/skill-workspace-tools.ts` | Ejecución renderer de tools con workspace inyectado. |
| `src/shared/soflia-runtime-model.ts` | Modelo runtime Gemini predeterminado (`gemini-3.6-flash`). |

### Fuentes y visuales

| Ruta | Función |
|---|---|
| `src/services/gemini-chat/presentation-source-visuals.ts` | Materializa visuales adjuntos/web y crea manifiesto no confiable. |
| `electron/skill-workspace/fetch-image.ts` | Descarga segura de imágenes HTTPS. |
| `electron/organization-branding/resolve-brand.ts` | Resuelve marca, assets y paleta desde logo. |
| `electron/organization-branding/deck-base-css.ts` | CSS del runtime HTML heredado. |
| `electron/organization-branding/deck-base-js.ts` | JS/QA del runtime HTML heredado. |

### Workspace, IPC y seguridad

| Ruta | Función |
|---|---|
| `electron/skill-workspace/service.ts` | Persistencia local, paths, budgets, edición, readiness y `workspaces.json`. |
| `electron/skill-workspace-handlers.ts` | IPC de workspace, preview, branding, export y fullscreen. |
| `electron/preload/skill-workspace-api.ts` | API preload para renderer. |
| `electron/preload/channel-group-5.ts` | Allowlist de canales relacionados. |
| `electron/skill-workspace/protocol.ts` | URLs locales seguras para archivos/workspaces. |
| `electron/skill-workspace/presentation-runtime-server.ts` | Servidor loopback, tokens opacos, CSP y allowlist de recursos. |

### Runtime, edición y exportación

| Ruta | Función |
|---|---|
| `src/presentation-runtime/PresentationPlayerApp.tsx` | Canvas React, arquetipos, navegación y Framer Motion. |
| `src/presentation-runtime/components/ChartSlide.tsx` | Gráficas Recharts. |
| `src/presentation-runtime/presentation-runtime.css` | Estilos del runtime. |
| `src/components/presentation/PresentationWorkspacePanel.tsx` | Panel de archivos, preview, export y fullscreen. |
| `src/components/presentation/usePresentationWorkspace.ts` | Estado, edición manual y progreso. |
| `src/components/presentation/PresentationPreview.tsx` | Preview sandbox y listener de quality report. |
| `electron/skill-workspace/export-html.ts` | HTML autocontenido para IR React y runtime HTML legacy. |
| `electron/skill-workspace/presentation-view.ts` | Ventana de presentación. |
| `electron/presentation-system-refresh.ts` | Refresh solo para workspaces HTML heredados. |

### Flujos alternativos/legacy

| Ruta | Función |
|---|---|
| `electron/presentation-workflow/types.ts` | Estados durables en memoria del workflow WhatsApp. |
| `electron/presentation-workflow/workflow.ts` | Intake, propuesta, aprobación, generación y completion. |
| `electron/presentation-workflow/steps.ts` | HITL y entrega por WhatsApp. |
| `electron/presentation-workflow/html-generator.ts` | Genera HTML en una ruta que usa la política actual `deck.json`; contradicción documentada. |
| `electron/wa-executor/handlers/create-document/presentation-document.ts` | Genera PDF premium/fallback. |
| `electron/presentation-premium.ts` | Fachada del generador PDF premium. |
| `electron/presentation-pdf.ts` | Fachada PDF fallback. |

### Pruebas relevantes

| Ruta | Función |
|---|---|
| `src/__tests__/shared/presentation-deck-schema.test.ts` | Contrato de la IR. |
| `src/__tests__/presentation-runtime/PresentationPlayerApp.test.tsx` | Runtime React. |
| `src/__tests__/components/PresentationWorkspacePanel.test.tsx` | Panel, edición y señal de calidad. |
| `src/__tests__/services/presentaciones-prompt.test.ts` | Prompt de la Skill. |
| `src/__tests__/services/presentation-source-visuals.test.ts` | Visuales de fuente. |
| `src/__tests__/services/workspace-completion.test.ts` | Gate de completion. |
| `src/__tests__/services/skill-tool-loop.test.ts` | Tool loop de Skills. |
| `electron/__tests__/skill-workspace-service.test.ts` | Contención, budgets y readiness. |
| `electron/__tests__/presentation-runtime-server.test.ts` | Servidor local y contrato. |
| `electron/__tests__/presentation-export-html.test.ts` | Export HTML. |
| `electron/__tests__/whatsapp-workflow-presentacion.test.ts` | Workflow WhatsApp. |
