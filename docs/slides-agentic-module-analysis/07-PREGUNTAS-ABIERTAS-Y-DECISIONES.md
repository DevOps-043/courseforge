# Preguntas abiertas, contradicciones y decisiones

**Clasificación de esta sección:** D-01–D-10 son **[DISCREPANCIA]** verificadas estáticamente; I-01–I-06 son **[INFERENCIA]** pendientes de prueba dinámica; las preguntas de información son **[PREGUNTA ABIERTA]**; las opciones y recomendaciones iniciales son **[RECOMENDACIÓN]** sujetas a decisión humana.

## Contradicciones confirmadas

| ID | Evidencia A | Evidencia B | Tratamiento recomendado |
|---|---|---|---|
| D-01 | El encargo y referencias históricas llaman a `prompt_maestro.md` fuente principal. | El archivo se declara alias de `engineering-practices.md` y no describe slides. | Mantener el alias, pero documentar una fuente canónica específica de Presentaciones. |
| D-02 | SofLIA - Engine registra prompts/modelos para varios “agentes”. | Sus servicios homónimos son deterministas y no consumen esos prompts en llamadas LLM. | Renombrar como planners/validators o conectar explícitamente el modelo con criterios verificables. |
| D-03 | AGENTS/documentación histórica menciona Gamma API. | La UI copia contenido y abre Gamma manualmente. | Declarar Gamma como integración manual/legacy hasta que exista API confirmada. |
| D-04 | Endpoint y IDs usan `open-design`. | `/open-design/export` genera HTML/PNG local sin OpenDesign. | Renombrar o aislar como legacy renderer. |
| D-05 | `/admin/slides` parece módulo independiente. | La API exige `material_component` y artifact. | No usarlo como frontera del módulo futuro. |
| D-06 | Pulse Hub declara Presentaciones en chat/WhatsApp/Telegram con `deck.json`. | El workflow WhatsApp genera HTML y lo escribe usando la política actual de entry file. | Separar políticas por superficie o unificar toda superficie en la IR. |
| D-07 | Comentarios WhatsApp mencionan PDF. | El flujo envía HTML para conservar animaciones. | Corregir documentación y decidir formato oficial. |
| D-08 | `create_document` acepta `pptx/powerpoint`. | La implementación produce `.pdf`. | Cambiar nombre/contrato o implementar PPTX real fuera de este diagnóstico. |
| D-09 | Preview React muestra un badge de quality report. | El emisor encontrado pertenece al JS HTML heredado, no al runtime React. | Implementar QA en el runtime actual o retirar el indicador hasta tener evidencia. |
| D-10 | Manifiesto `soflia-deck` exige audience/learningObjective. | La API principal no acepta esos campos. | Alinear IR e intake del futuro módulo. |

## Información que falta

### SofLIA - Engine

1. ¿Qué rutas legacy están activas para usuarios reales: Gamma, OpenDesign PNG, skill HTML y generador principal?
2. ¿Existe fuera del repositorio un worker/servicio que aprueba `production_assets` de slides?
3. ¿Los buckets `production-assets` son públicos por decisión o por conveniencia histórica?
4. ¿Qué templates `slide_template` están desplegados y qué porcentaje de decks los usa?
5. ¿Se consumen realmente los prompts de brief/evidence/strategy/visual/QA desde alguna función no localizada?
6. ¿Qué modelo y coste reales se usan por organización para copy e imágenes?
7. ¿Cuál es la fuente efectiva de `prepared_slide_count`, que la UI lee pero la ruta principal no guarda en el fragmento revisado?
8. ¿Qué representación usa producción final: PNG, HTML, animated deck o spec?
9. ¿Hay requisitos contractuales de Gamma o compatibilidad que impidan retirarlo?
10. ¿Debe un deck independiente ser visible a builders/architects o solo admins?

### Pulse Hub

1. ¿El workflow `presentation-workflow` se alcanza actualmente o es una ruta legacy sin tráfico?
2. ¿La fila remota de la Skill cambia surfaces/tools sin cambiar el contrato `deck.json`?
3. ¿Cómo se espera que funcione Presentaciones en Telegram si el workspace es una capacidad de escritorio?
4. ¿Existe un emisor de `pulse-presentacion-calidad` generado en build o fuera de las rutas revisadas?
5. ¿Los workspaces se respaldan, migran o eliminan por política de retención?
6. ¿Qué proveedor/modelo se selecciona normalmente para la Skill en producción?
7. ¿La investigación web persiste snapshots y citas o solo texto del modelo?
8. ¿El usuario puede compartir un workspace con otro usuario u organización?

## Inferencias que requieren validación dinámica

- **I-01:** el quality badge de Pulse Hub no recibe informes en el runtime React.
- **I-02:** el workflow WhatsApp que escribe HTML en `deck.json` queda `ready: false` o falla al usar el exportador moderno.
- **I-03:** regeneraciones de SofLIA - Engine dejan filas históricas, pero sobrescriben los objetos canónicos de Storage.
- **I-04:** `production_assets` puede acumular specs/HTML/QA duplicados sin una relación explícita de versión vigente.
- **I-05:** una URL pública del bucket permite compartir el HTML fuera de auth; el impacto depende de configuración real de Storage.
- **I-06:** la UI de SofLIA - Engine no ofrece aprobación/rechazo de decks aunque el schema de assets lo soporte.

Ninguna de estas inferencias debe convertirse en requisito o incidente sin una prueba dinámica o consulta a owners.

## Decisiones de producto

| ID | Decisión | Opciones principales | Recomendación inicial |
|---|---|---|---|
| P-01 | Audiencia del módulo | Educativo / ejecutivo / multi-perfil | Multi-perfil sobre una IR común, empezando por educativo. |
| P-02 | Outputs de primera clase | HTML / PNG / PDF / PPTX / video | HTML + frames/Remotion inicialmente; validar demanda de PPTX/PDF. |
| P-03 | Owner del deck | Pipeline / conversación / proyecto independiente | Proyecto independiente. |
| P-04 | Aprobación | Automática / humana final / por gates | Humana para versión final y efectos externos. |
| P-05 | Investigación | Siempre / opcional / solo fuentes aportadas | Opcional y explícita, con outline aprobado si agrega claims. |
| P-06 | Edición | Chat / formulario / editor visual | Chat + editor estructurado; WYSIWYG después. |
| P-07 | Colaboración | Individual / organización / roles | Organización con roles de autor, reviewer y approver. |
| P-08 | Retención | Todas las versiones / ventana / pinning | Todas las aprobadas; drafts según política. |

## Decisiones de arquitectura

| ID | Decisión | Pregunta |
|---|---|---|
| A-01 | IR canónica | ¿Evolucionar `course-deck-v1` o crear v2 con migradores? |
| A-02 | Renderer | ¿Consolidar el renderer HTML Engine, portar el runtime React o soportar ambos desde la misma IR? |
| A-03 | Persistencia | ¿Nuevas entidades o generalización segura de `production_jobs/assets`? |
| A-04 | Versionado | ¿Cada patch crea versión o existe un draft mutable con commits? |
| A-05 | Agent runs | ¿Qué partes usan LLM y cuáles quedan deterministas? |
| A-06 | QA visual | ¿DOM metrics, screenshot/visión o ambas? |
| A-07 | Assets | ¿Cómo registrar licencia, provenance y reutilización entre proyectos? |
| A-08 | Seguridad | ¿HTML público, URLs firmadas o proxy autenticado? |
| A-09 | Templates | ¿Blueprint común o plugins de renderer versionados? |
| A-10 | Legacy | ¿Migrar, envolver o retirar Gamma/OpenDesign/skills HTML? |

## Decisiones de operación

- presupuesto máximo de tokens, imágenes, iteraciones y tiempo;
- cancelación y reanudación;
- concurrencia por organización;
- idempotencia de tools externas;
- métricas de calidad y aceptación;
- observabilidad sin persistir prompts o fuentes sensibles innecesariamente;
- fallback de modelos y conducta ante claves ausentes;
- política de reintento y recuperación parcial;
- SLO de preview/render/export;
- ownership de soporte cuando un build ya fue consumido por video.

## Validaciones humanas recomendadas antes de diseñar

1. Confirmar qué flujos legacy tienen usuarios activos.
2. Elegir audiencia y exports de la primera versión.
3. Aprobar `SlideProject` como owner independiente.
4. Elegir la IR canónica y el renderer objetivo.
5. Definir el gate de aprobación final.
6. Definir presupuesto y fuentes permitidas para el agente.
7. Decidir política de storage y sharing.
8. Validar si el pipeline necesita sincronización bidireccional o solo vínculo/consumo.

## Criterio de cierre de estas preguntas

Cada decisión debe registrar owner, fecha, alternativa elegida, motivo, impacto en compatibilidad y evidencia. Hasta entonces, este diagnóstico las mantiene como preguntas y no las presenta como comportamiento acordado.
