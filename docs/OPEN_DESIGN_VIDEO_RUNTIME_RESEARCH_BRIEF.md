# Open Design Video Runtime Research Brief

## Proposito

Este documento sirve como brief de investigacion para integrar, en una fase posterior, una automatizacion de produccion visual y video dentro de Courseforge/CourseEngine. No es un plan de implementacion cerrado. Su objetivo es dejar preparada la informacion que una IA o el equipo tecnico deben extraer del repositorio local de `open-design` antes de tomar decisiones de arquitectura.

Fuente de verdad de calidad: `prompt_maestro.md`. Cualquier decision futura debe priorizar correctitud, seguridad, legibilidad, mantenibilidad, modularidad, escalabilidad, performance, testabilidad, observabilidad y documentacion clara, en ese orden.

## Repositorios y documentos base

- Courseforge: `D:\Pulse Hub\courseforge`
- Open Design local: `D:\Pulse Hub\open-design`
- Documento de propuesta inicial: `Produccion Visual y Video IA para CourseEngine _ Courseforge.md`
- Prompt maestro: `prompt_maestro.md`
- Paso 6 actual: `docs/DOCUMENTACION_PASO_6_PRODUCCION_VISUAL.md`
- Open Design arquitectura: `D:\Pulse Hub\open-design\docs\architecture.md`
- Open Design skills: `D:\Pulse Hub\open-design\docs\skills-protocol.md`
- Open Design agent adapters: `D:\Pulse Hub\open-design\docs\agent-adapters.md`
- Open Design runtime adapter actual: `D:\Pulse Hub\open-design\specs\current\runtime-adapter.md`
- Open Design media contract: `D:\Pulse Hub\open-design\apps\daemon\src\prompts\media-contract.ts`
- Open Design media dispatcher: `D:\Pulse Hub\open-design\apps\daemon\src\media.ts`
- Open Design media models: `D:\Pulse Hub\open-design\apps\daemon\src\media-models.ts`
- Skills relevantes: `D:\Pulse Hub\open-design\design-templates\hyperframes\SKILL.md`, `D:\Pulse Hub\open-design\design-templates\video-shortform\SKILL.md`, `D:\Pulse Hub\open-design\design-templates\html-ppt-course-module\SKILL.md`, `D:\Pulse Hub\open-design\design-templates\html-ppt\SKILL.md`, `D:\Pulse Hub\open-design\skills\video-hyperframes\SKILL.md`

## Hallazgos confirmados de Open Design

### Runtime principal

El runtime principal de Open Design no es Remotion. El nucleo operativo es un daemon local en Node que:

- escucha por defecto en `http://localhost:7456`
- expone rutas HTTP/SSE bajo `/api/*`
- detecta y ejecuta agentes CLI locales
- compone prompts con `SKILL.md`, `DESIGN.md` y referencias craft
- crea artefactos en un workspace local `.od`
- renderiza previews sandboxed en iframe
- despacha generacion de media mediante `od media generate`

El paquete raiz declara:

- `packageManager`: `pnpm@10.33.2`
- `engines.node`: `~24`
- binario CLI: `od`, apuntando a `apps/daemon/dist/cli.js`

### Stack relevante de Open Design

- Monorepo con pnpm workspaces.
- Web app: Next.js 16, React 18, Tailwind 4.
- Daemon: Node 24, TypeScript, Express, SSE, child process spawning.
- Desktop/packaged: Electron en paquetes separados.
- Persistencia local: archivos bajo `.od` y algunos usos internos de `better-sqlite3`.
- Export/media: `jszip`, procesos locales, `npx`, y providers externos.

### Agentes y adapters

Open Design delega el loop de IA a CLIs de agentes, no reimplementa un agente completo. La capa adapter:

- detecta binarios en PATH
- construye argumentos por runtime
- ejecuta procesos con `spawn()`
- normaliza stdout/stderr a eventos de UI
- maneja formatos como Claude JSONL, JSON event stream, ACP JSON-RPC y plain text

Runtimes documentados o actuales incluyen Claude Code, Codex, Gemini CLI, OpenCode, Cursor Agent, Hermes, Kimi, Qwen y otros. Para Courseforge, esta arquitectura es util como patron, pero no como dependencia directa de produccion, porque Courseforge es SaaS multi-tenant y serverless/Next/Netlify, no una app local-first por usuario.

### Modelo de skills

Open Design usa `SKILL.md` como unidad atomica de capacidad. Un skill puede contener:

- frontmatter YAML
- instrucciones de workflow
- `assets/`
- `references/`
- extension `od:` para preview, inputs, parametros, outputs, surface, mode y design system

El `DESIGN.md` funciona como contrato visual. El formato documentado de 9 secciones incluye tema visual, paleta, tipografia, componentes, layout, elevacion, do/don'ts, responsive behavior y agent prompt guide.

Para Courseforge conviene adoptar el concepto, no copiar el mecanismo local:

- `visual_skills` como registros versionados
- `organization_design_systems` como contratos de marca por tenant
- referencias y assets controlados por app, no por filesystem arbitrario
- prompt composer propio con filtros de contexto educativo

### Preview y sandbox

Open Design renderiza artefactos en iframe con:

- `sandbox="allow-scripts"`
- sin `allow-same-origin`
- `srcdoc` para HTML
- transformacion para JSX cuando aplica

Este patron si es transferible a Courseforge para previsualizar HTML generado, siempre que se agregue sanitizacion, CSP y controles de storage por tenant.

### Export

Open Design documenta una export pipeline con:

- HTML autocontenido
- PDF via navegador/headless
- PPTX mediante salida intermedia `slides.json` y `pptxgenjs` para skills deck
- ZIP del folder del artefacto
- Markdown directo o definido por skill

Para Courseforge, el flujo debe adaptarse a Supabase Storage y a estados QA, no a carpetas locales `.od`.

## Hallazgos confirmados sobre video

### Remotion no es el runtime operativo principal

La referencia a Remotion aparece como compatibilidad o salida conceptual en `skills\video-hyperframes\SKILL.md`, pero el renderer local real que aparece integrado en Open Design es `hyperframes-html`.

El flujo real de video HTML en Open Design es:

1. El agente crea una composicion HyperFrames en una carpeta oculta.
2. La composicion contiene `hyperframes.json`, `meta.json`, `index.html`, GSAP timeline y atributos `data-*`.
3. El daemon ejecuta `npx hyperframes render`.
4. El resultado final es un MP4.

La razon tecnica de ejecutar el render desde el daemon es que HyperFrames usa Chrome/Puppeteer para capturar frames, y algunos shells de agentes quedan limitados por sandboxes que rompen procesos de Chrome.

### Media dispatcher

Open Design unifica image/video/audio mediante:

```bash
"$OD_NODE_BIN" "$OD_BIN" media generate \
  --project "$OD_PROJECT_ID" \
  --surface video \
  --model <model-id> \
  --output <filename> \
  --prompt "<prompt>"
```

Para renders largos usa tareas asincronas con:

```bash
"$OD_NODE_BIN" "$OD_BIN" media wait <taskId> --since <n>
```

Este patron es muy relevante para Courseforge: la automatizacion de video no deberia bloquear requests HTTP. Debe despachar jobs, guardar estado, permitir polling/webhooks y actualizar UI/QA.

### Providers de video registrados en Open Design

Modelos o providers relevantes encontrados:

- `hyperframes-html`: renderer local HTML a MP4.
- `doubao-seedance-*`: Volcengine/Seedance.
- `grok-imagine-video`: xAI.
- `xAI/grok-imagine-video`, `bytedance/seedance-1.5-pro`, `google/veo-3.1-lite`: via ImageRouter.
- `kling-*`, `veo-*`, `sora-*`, `minimax-video-01`: registrados, pero no todos integrados como provider real.

Esto confirma que Open Design separa catalogo de modelos, provider config, dispatcher, storage y render result. Courseforge deberia hacer lo mismo para Gamma, HeyGen, Kaiber, Jitter, Veo y un renderer HTML/video local.

## Estado actual de Courseforge relacionado

### Stack actual

- Next.js 16, React 19, TypeScript, Tailwind 4, Zustand.
- Netlify Functions para jobs background.
- Supabase PostgreSQL/Auth/Storage.
- Gemini como IA primaria, OpenAI fallback.
- Fase 6 parcialmente implementada como produccion visual manual asistida.

### Datos actuales de produccion

`MaterialAssets` vive en `material_components.assets` y ya contiene:

- `slides_url`
- `b_roll_prompts`
- `video_url`
- `screencast_url`
- `final_video_url`
- `final_video_source`
- `video_duration`
- `production_status`
- `gamma_deck_id`
- `png_export_path`
- `dod_checklist`

Estados actuales:

- `PENDING`
- `IN_PROGRESS`
- `DECK_READY`
- `EXPORTED`
- `COMPLETED`

Checklist actual:

- `has_slides_url`
- `has_video_url`
- `has_screencast_url`
- `has_b_roll_prompts`
- `has_final_video_url`

### Flujo actual de Fase 6

Archivos clave:

- `apps/web/src/domains/materials/components/VisualProductionContainer.tsx`
- `apps/web/src/domains/materials/components/ProductionAssetCard.tsx`
- `apps/web/src/domains/materials/actions/production.actions.ts`
- `apps/web/netlify/functions/video-prompts-generation.ts`

El sistema actual:

- filtra componentes `VIDEO_*` y `DEMO_GUIDE`
- permite guardar URLs/manual assets
- genera prompts B-roll con Gemini usando `VIDEO_BROLL_PROMPTS`
- sincroniza `final_video_url` hacia `publication_requests.lesson_videos`
- registra eventos `GO-OP-06_ASSET_UPDATED` y `GO-OP-06_ASSET_COMPLETED`

## Implicaciones para la investigacion futura

### Lo que si conviene importar como concepto

- Skill contract estilo `SKILL.md`.
- Design system contract estilo `DESIGN.md`.
- Preview en iframe sandboxed.
- Separacion entre catalogo de modelos/proveedores y ejecucion.
- Dispatcher uniforme para media.
- Jobs asincronos para renders largos.
- Validacion estricta de inputs, rutas y outputs.
- Salida final como asset versionado y auditable.
- Progreso observable por tarea.

### Lo que no conviene copiar directamente

- Daemon local como dependencia de produccion SaaS.
- Ejecucion de agentes CLI en servidores multi-tenant.
- Filesystem `.od` como fuente de verdad.
- BYOK local/browser para usuarios finales sin estrategia enterprise.
- Dependencia directa de `npx hyperframes` dentro de una request serverless.
- Skills instalables desde rutas arbitrarias sin firma/revision.

### Decision preliminar importante

Para Courseforge, Remotion debe tratarse como una posible opcion de render programatico, no como una conclusion obligatoria. La investigacion debe comparar:

- HyperFrames como runtime HTML->MP4 inspirado en Open Design.
- Remotion como runtime React->video con composiciones versionables.
- Browser/headless HTML capture para decks o storyboards.
- Providers externos como HeyGen, Gamma, Kaiber, Jitter y Veo.

La decision debe basarse en duracion de render, costo, calidad, seguridad, compatibilidad con Netlify, necesidad de workers externos, storage, observabilidad y QA.

## Preguntas que debe responder la siguiente investigacion

### Runtime y ejecucion

1. Que runtime conviene para Courseforge: Remotion, HyperFrames, browser capture, provider externo o combinacion?
2. Donde debe ejecutarse el render: Netlify Background Functions, worker dedicado, queue externa, Supabase Edge, servidor Node propio, o proveedor gestionado?
3. Que limites existen para Chrome/Puppeteer/FFmpeg en el entorno actual?
4. Que partes deben ser asincronas y que partes pueden ser server actions?
5. Como se reintentan renders fallidos sin duplicar costo ni publicar assets incompletos?

### Arquitectura Courseforge

1. Que nuevas entidades son necesarias ademas de `material_components.assets`?
2. Conviene mantener assets simples en JSONB o crear tablas normalizadas para `production_jobs`, `production_assets`, `visual_artifacts` y `video_renders`?
3. Como se mapea cada asset con `artifact_id`, `organization_id`, `material_lesson_id`, `component_id`, `lesson_id`, `module_id` y proveedor?
4. Que estados nuevos hacen falta para QA visual y QA video?
5. Como se conecta con `publication_requests.lesson_videos` sin acoplar publicacion a un provider especifico?

### Seguridad y multi-tenancy

1. Como se garantiza que todas las queries filtren por `organization_id`?
2. Como se almacenan API keys por organizacion o usuario?
3. Como se evita SSRF al descargar videos o imagenes generados por providers?
4. Como se valida y sanitiza HTML generado antes de preview/export?
5. Que limites de payload, duracion y costo se aplican por tenant?
6. Como se firman o validan webhooks de HeyGen/Kaiber/Jitter/etc.?
7. Que informacion pedagogica o sensible se envia a cada proveedor y que debe excluirse?

### Skills, prompts y QA

1. Que forma debe tener un `VisualSkill` de Courseforge?
2. Como se versiona un skill y su prompt snapshot por asset generado?
3. Que partes de `DESIGN.md` se inyectan para reducir tokens?
4. Como se evita que el modelo invente fuentes, claims o contenido no aprobado?
5. Que validadores automaticos se necesitan para HTML, video script, storyboard, captions y metadata?
6. Que checklist humana debe bloquear export/publicacion?

### Video educativo

1. Como transformar `VideoScript` y `StoryboardItem` actuales en escenas renderizables?
2. Como sincronizar narracion, on-screen text, B-roll, slides, avatar y subtitulos?
3. Cuando usar HeyGen avatar vs video HTML/Remotion vs B-roll provider?
4. Como manejar `VIDEO_THEORETICAL`, `VIDEO_DEMO`, `VIDEO_GUIDE` y `DEMO_GUIDE` como flujos distintos?
5. Que salidas minimas requiere SofLIA: MP4, subtitles, thumbnail, transcript, duration, provider id?

## Prompt operativo para la siguiente pasada

Usa este prompt cuando se quiera profundizar la implementacion despues de este brief:

```markdown
Actua como Staff Engineer / Software Architect siguiendo `prompt_maestro.md`.

Objetivo: analizar como integrar una automatizacion de produccion visual y video en Courseforge, usando como referencia el repositorio local `D:\Pulse Hub\open-design`, sin copiar su daemon local-first directamente.

Contexto Courseforge:
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Netlify Functions, Supabase, Gemini/OpenAI.
- Fase 6 actual: produccion visual manual asistida sobre `material_components.assets`.
- Componentes producibles: `VIDEO_THEORETICAL`, `VIDEO_DEMO`, `VIDEO_GUIDE`, `DEMO_GUIDE`.
- Archivos actuales: `VisualProductionContainer.tsx`, `ProductionAssetCard.tsx`, `production.actions.ts`, `video-prompts-generation.ts`, `materials.types.ts`.
- Fuente de verdad pedagogica: materiales aprobados, fuentes curadas, scripts y storyboards aprobados.

Investiga Open Design local:
- `docs/architecture.md`
- `docs/skills-protocol.md`
- `docs/agent-adapters.md`
- `specs/current/runtime-adapter.md`
- `apps/daemon/src/media.ts`
- `apps/daemon/src/media-models.ts`
- `apps/daemon/src/prompts/media-contract.ts`
- `design-templates/hyperframes/SKILL.md`
- `design-templates/video-shortform/SKILL.md`
- `design-templates/html-ppt-course-module/SKILL.md`
- `skills/video-hyperframes/SKILL.md`

Entregable esperado:
1. Diagnostico tecnico de que piezas de Open Design son transferibles.
2. Comparativa Remotion vs HyperFrames vs provider externo vs Gamma/HeyGen/Kaiber/Jitter.
3. Arquitectura recomendada para Courseforge con modulos, tablas, estados, jobs y storage.
4. Riesgos de seguridad, multi-tenancy, costo, render y QA.
5. Plan de implementacion incremental con MVP, no codigo todavia.
6. Validaciones automaticas y humanas necesarias.

Restricciones:
- No asumir que Remotion es obligatorio.
- No ejecutar agentes CLI dentro de produccion multi-tenant.
- No depender de filesystem local como fuente de verdad.
- No publicar ni exportar assets sin QA aprobada.
- No enviar dumps de Supabase ni datos sensibles a proveedores externos.
- Mantener Gamma como provider paralelo si aporta valor.
- Priorizar jobs asincronos, idempotencia, observabilidad y rollback.
```

## Criterios de aceptacion para la siguiente fase de analisis

El analisis futuro se considera suficientemente bueno si:

- distingue claramente conceptos reutilizables de codigo reutilizable
- identifica el runtime real de Open Design y no confunde Remotion con el nucleo
- propone una arquitectura compatible con Courseforge y Supabase
- define limites de seguridad y multi-tenancy desde el inicio
- modela jobs asincronos e idempotentes
- contempla QA humana antes de exportar/publicar
- conserva trazabilidad por `artifact_id`, `organization_id`, `component_id`, provider y version
- explica ventajas, desventajas y costos de cada alternativa

## Nota de no implementacion

Este documento no introduce cambios de codigo, tablas ni endpoints. Es una base de investigacion para que el siguiente paso pueda decidir con evidencia que implementar y en que orden.
