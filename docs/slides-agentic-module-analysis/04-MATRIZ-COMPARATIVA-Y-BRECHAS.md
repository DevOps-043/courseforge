# Matriz comparativa y análisis de brechas

**Clasificación de esta sección:** las capacidades actuales de la matriz y de los inventarios se consideran **[CÓDIGO]** cuando remiten a implementaciones enumeradas en `06-INVENTARIO-DE-EVIDENCIA.md`; las evaluaciones, selecciones de reutilización y la brecha objetivo son **[RECOMENDACIÓN]**. Las limitaciones que dependen de ejecución están formuladas como no confirmadas o se registran como **[INFERENCIA]** en `07-PREGUNTAS-ABIERTAS-Y-DECISIONES.md`.

## Matriz comparativa

| Dimensión | SofLIA - Engine | Pulse Hub | Evaluación |
|---|---|---|---|
| Unidad de trabajo | `material_component` dentro de artefacto/lección. | Workspace local asociado a conversación. | Pulse Hub es más independiente; ninguno tiene un `SlideProject` de producto. |
| Entrada libre | Texto/JSON manual, pero exige `componentId`. | Brief, conversación, adjunto, Drive/página mediante herramientas. | Ventaja Pulse Hub. |
| Entrada de pipeline | Nativa: script, storyboard, fuentes curadas y producción. | No tiene pipeline educativo. | Ventaja SofLIA - Engine. |
| IR | `course-deck-v1`, pedagógica y rica en trazabilidad. | `deck.json` v1, estricta en arquetipos y movimiento. | Complementarias. |
| Separación agente/runtime | Parcial; IR y renderer existen, pero también HTML/PNG legacy. | Fuerte: el agente no puede escribir runtime. | Patrón de Pulse Hub a adoptar. |
| Agentes | Stages nominales; solo copy usa LLM. | Loop real de herramientas Gemini/OpenAI. | SofLIA - Engine tiene reglas fuertes; Pulse Hub orquestación real. |
| Prompts/modelos | Configurables por organización; varios no gobiernan ejecución. | Prompt en código/versionado; modelo del chat enrutable. | Engine tiene gobernanza de config; necesita honestidad contractual. |
| Evidencia | Fuentes aprobadas, excerpts, refs y hints por slide. | Fuentes en meta/texto y reglas de no invención. | Ventaja SofLIA - Engine. |
| Imágenes | Planificadas, generadas, hasheadas y persistidas; hasta 3+4. | Fuente primero, descarga/generación local con dirección de arte. | Combinar trazabilidad Engine + política visual Pulse Hub. |
| Branding | Tokens en spec/template; templates por organización. | CSS protegido generado por sistema y paleta desde logo. | Pulse Hub tiene frontera más segura. |
| Layout | Layouts deterministas y template HTML. | Arquetipos React probados; sin coordenadas libres. | Ambos útiles; Pulse Hub reduce grados de libertad. |
| Gráficas | SVG declarativo: bar/line/area/proportion, sourceRefs. | Recharts: barras/líneas/área/radar/anillo. | Engine mejor trazabilidad; Pulse Hub más variedad. |
| QA estructural | Amplio y bloqueante. | Zod/readiness. | Ventaja SofLIA - Engine. |
| QA visual | No confirmado por render/captura. | Listener/badge presente, emisor actual no confirmado. | Brecha en ambos. |
| Autorreparación | No. Un FAIL termina el job. | Sí para ausencia/invalidez de `deck.json`, no para calidad. | Patrón Pulse Hub ampliable. |
| HITL | Inicio/regeneración/template manual; sin outline aprobable. | Intake y aprobación prescritos; workflow WA tiene estado explícito. | Pulse Hub más deliberado, pero inconsistente entre runtimes. |
| Persistencia | Supabase + Storage + jobs/assets + multi-org. | Filesystem local + `workspaces.json`. | Ventaja SofLIA - Engine para producto SaaS. |
| Versionado | Historial indirecto de jobs/assets; paths finales sobrescritos. | Sobrescritura local sin versiones. | Brecha común. |
| Edición | Custom input, regeneración completa, uploads. | Chat follow-up y editor de archivos. | Pulse Hub mejor iteración; falta edición semántica en ambos. |
| Preview | HTML público y superficies de materiales. | Preview sandbox, fullscreen y canvas idéntico. | Pulse Hub ofrece mejor experiencia aislada. |
| Exportación | HTML, PNG legacy, adaptador Remotion; Gamma manual. | HTML autocontenido; PDF por flujo separado legacy. | Ninguno tiene cartera coherente desde una IR única. |
| Seguridad | Auth, tenant, RLS, HTML safety, límites de assets. | Workspace containment, CSP, iframe opaco, tool allowlist. | Ambas aportan controles diferentes. |
| Observabilidad | Jobs, snapshots, stages, assets. | Tool calls y progreso de archivos; sin workflow durable. | Ventaja SofLIA - Engine. |
| Extensibilidad | Prompts/model settings/templates, pero acoplado a materiales. | Nuevos arquetipos requieren schema + runtime; tools bien delimitadas. | Futuro módulo debe usar plugins/adapters explícitos. |

## Capacidades equivalentes

- IR declarativa y schema validado.
- Canvas 16:9 1920×1080.
- Templates/layouts predecibles.
- Gráficas declarativas.
- Generación/uso de imágenes.
- HTML interactivo.
- Branding por organización.
- Preview y edición/reintento de alguna forma.
- Límites de texto y estructura.

## Capacidades exclusivas o claramente superiores

### SofLIA - Engine

- contexto pedagógico de artefacto, lección, objetivo, guion y storyboard;
- ingesta de fuentes curadas y aprobadas;
- claim/source refs por slide y gráficos con source refs;
- jobs idempotentes y estados de proveedor;
- assets con checksum, metadata, QA y storage;
- conexión directa a video/Remotion;
- configuración de modelos/prompts por tenant;
- templates persistidos y empaquetables.

### Pulse Hub

- workspace independiente y reanudable;
- loop de herramientas realmente agéntico;
- condición de salida basada en filesystem real;
- edición exacta de archivos por follow-up;
- runtime completamente fuera del control del modelo;
- branding protegido;
- importación anticipada de visuales de la fuente;
- preview sandbox y export HTML autocontenido;
- vocabulario explícito de continuidad/movimiento.

## Duplicaciones en SofLIA - Engine

1. **Generación de contenido:** prepared spec de B-roll, generador principal y exportador `/open-design/export` producen slides por reglas distintas.
2. **Render:** HTML SofLIA, PNG SVG legacy y conversión a animated deck.
3. **Estado:** `production_jobs`, `production_assets.qa_status`, `material_components.assets.production_status` y estados internos de `animated_deck`.
4. **Plantillas:** skill estático, template manifest y bundle-agent de plantillas.
5. **Persistencia:** IR en fila `production_assets.content`, archivo JSON de storage y copia en `material_components.assets.slides.prepared_spec`.
6. **Proveedores/branding:** Gamma legacy, tokens default, skill SofLIA y templates generados.

## Vacíos funcionales de SofLIA - Engine

- entidad de deck independiente;
- fuente canónica versionada;
- intake de brief/audiencia/objetivo/fuentes fuera del curso;
- outline aprobable;
- agente supervisor con tools y bucle de reparación;
- edición estructurada slide por slide;
- regeneración localizada con conservación del resto;
- QA visual basado en render real;
- aprobación humana durable del deck/version;
- exportadores coherentes desde la misma IR;
- budgets de coste/tiempo y cancelación;
- comparación/diff entre versiones;
- lineage explícito pipeline → proyecto → versión → builds.

## Qué reutilizar de SofLIA - Engine

### Reutilización directa o casi directa

- `course-deck.schema.ts` como punto de partida de IR.
- `course-deck-qa.service.ts` como validador determinista.
- render HTML y SVG chart renderer.
- `slide-source-pack-loader.service.ts` detrás de un adapter de fuentes del curso.
- copy budgets y detección de narration leakage.
- `production_jobs`/`production_assets` como patrones, no necesariamente como tablas finales sin cambios.
- idempotency keys, snapshots y providers.
- planificación/persistencia de imágenes con hash y source refs.
- template blueprint y empaquetado de Slide Template Studio.

### Adaptación necesaria

- remover `artifactId`/`materialComponentId` obligatorios del core y llevarlos a vínculos externos;
- cambiar paths basados en `componentId` por `slideProjectId/versionId/buildId`;
- convertir el orquestador actual en tools invocables por un supervisor;
- separar estados de autoría, QA, aprobación y builds;
- hacer que prompts configurados gobiernen llamadas reales o dejar de presentarlos como agentes;
- derivar todos los exports de una IR versionada.

## Qué aprovechar de Pulse Hub

### Reutilizable como patrón

- `workspace + tools + completion guard`;
- escritura de plan antes de IR;
- edición por read/replace exacto;
- source visuals first;
- arquetipos y vocabulario de movimiento limitados;
- runtime que controla layout y accesibilidad;
- branding protegido;
- preview sandbox y HTML autocontenido;
- recuperación del contexto desde la conversación/proyecto.

### Requiere adaptación

- filesystem local → persistencia multi-tenant y storage del Engine;
- conversación como owner → `SlideProject` con conversaciones vinculadas;
- deck ejecutivo → deck educativo/general con perfiles de audiencia;
- `meta.fuentes` → evidence graph fuerte;
- Zod readiness → gates de contenido, visual, seguridad y aprobación;
- React/Electron loopback → preview web seguro o renderer worker;
- tools del renderer → tools server-side autorizadas e idempotentes.

## Qué no conviene trasladar

1. **No trasladar HTML libre generado por modelo.** Contradice la frontera segura del runtime moderno.
2. **No trasladar el workspace local como persistencia final.** No resuelve colaboración, multi-tenancy, backups ni consumo por pipeline.
3. **No trasladar la asociación uno-a-uno conversación/workspace.** El proyecto debe sobrevivir y permitir varias conversaciones.
4. **No trasladar los flujos WhatsApp legacy tal como están.** Mezclan contratos incompatibles.
5. **No adoptar el badge visual sin emisor/gate verificado.** Debe rediseñarse como reporte durable.
6. **No reducir evidencia a texto libre en el footer.** El Engine necesita trazabilidad pedagógica y factual.
7. **No permitir 20 iteraciones sin presupuesto.** Iteración, tokens, imágenes, tiempo y coste deben ser políticas del proyecto.

## Fortalezas y debilidades resumidas

| Sistema | Fortaleza dominante | Debilidad dominante |
|---|---|---|
| SofLIA - Engine | Producción auditable y contexto educativo. | El deck no es una entidad autónoma y conviven demasiados caminos. |
| Pulse Hub | Autoría agéntica desacoplada del runtime. | Persistencia/QA/lineage insuficientes y rutas legacy inconsistentes. |

## Brecha objetivo

El módulo futuro debe ocupar el espacio que ninguno cubre hoy:

> Un proyecto de slides independiente, multi-tenant y versionado, autorable por humano o agente, con evidencia trazable, runtime controlado, QA automático reparable y adaptadores de entrada/salida —incluido el pipeline educativo— sin que ninguno sea propietario del core.
