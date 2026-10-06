# Auditoría de duplicación de herramientas del editor

Fecha: 2026-10-03. Complementa y corrige el [catálogo funcional](SOFLIA_EDITOR_FUNCTIONAL_TOOLS_RESEARCH.md). No introduce capacidades, dependencias ni cambios de aplicación.

## Alcance y criterio

Inspección estática del código actual, incluidos archivos locales en desarrollo. Se revisaron controles de composición, servicios/contratos de producción, HTML editable, derivados de medios y bloques de slides. No se ejecutó QA, ni se verificó disponibilidad por permisos/flags o despliegue. Una función no encontrada en estas superficies no se declara inexistente en todo el producto.

La comparación se realiza por intención, entrada, operación y resultado, no por coincidencia de nombre. Se excluye una propuesta repetida, no la función existente. Una base sin UI tampoco se presenta como herramienta terminada.

## Evidencia y decisión por herramienta

Rutas relativas a la raíz de Courseforge; los nombres siguientes son archivos del sistema, no módulos de los referentes.

| Herramienta investigada | Evidencia local | Decisión y delta real |
|---|---|---|
| Montaje básico | `CompositionTimeline.tsx`, `CompositionSelectionPanel.tsx`, operaciones de `editor-patch.types.ts` | Repetida. Reutilizar trim/split, reorganización y operaciones de selección; no crear un segundo timeline |
| Elementos de slide | `production/composition-editor/html-editing/README.md`, contrato y validación de comandos | En curso. Ya contempla texto, imágenes permitidas y temas. README delimita ausencia de UI, gateway/persistencia y renderer. Continuar ese flujo; gráficos y DOM libre no están cubiertos |
| Flechas/callouts/resaltados | `production/slides/specs/course-deck.schema.ts`, `production/slides/render/html-deck-renderer.service.ts` | Callout de slide repetido. Overlay editable, temporizado y anclado sobre video es otra función; no se identificó su flujo dedicado |
| Zoom didáctico | `composition-motion-preset.service.ts`, `CompositionMotionControls.tsx` | Zoom de entrada/salida ya existe. Ampliar con selección de región y secuencia acercar/sostener/regresar; no implementar otro motor de zoom |
| Freeze de frame elegido | `CompositionVideoFreezeControls.tsx` | Base existente limitada a cola final de video elegible. Elegir un frame interior y extender su tiempo es ampliación, no freeze desde cero |
| Marcadores/pasos | `CompositionNarrativePanel.tsx` | Navegación por escenas y palabras repetida. Marcadores arbitrarios persistidos con política de cuts/ripple no acreditados |
| Dividir/unir captions | `CompositionTextControls.tsx`, `composition-transcript-caption.service.ts` | Edición/importación/generación de cues ya existe. No se identificaron controles dedicados de split/join; limitar propuesta a ese delta |
| Tiempos por palabra | `composition-text-layer.types.ts`, `composition-transcript-caption.service.ts` | Datos y generación temporizados existentes. Proponer corrección fina en UI, no timestamps/segmentación desde cero |
| Buscar/extraer frase | `CompositionNarrativePanel.tsx` | Panel y seek por palabra existen. Ampliar búsqueda, selección de rango y extracción de toma |
| Eliminar frase mediante propuesta | `useCompositionAgentProposalController.ts`, `CompositionAgentConversation.tsx`, operaciones del editor | Revisión de propuestas IA y edición audiovisual existentes. Delta: plan específico de corte asociado a transcripción fiable y sincronización de afectados |
| Acortar pausas | Servicios de mezcla/procesamiento de audio y operaciones actuales | No se identificó detector con revisión de pausas y plan de cortes. No confundir silencio, ducking y denoise |
| Volumen por puntos | `composition-playback-audio-envelope.ts`, `composition-audio-mix.service.ts`, `AudioMixControls.tsx` | Evaluación y envolventes derivadas existentes. Delta: autoría/persistencia/edición de puntos por usuario, coordinada con fades/ducking |
| Grabación de narración | Búsqueda de `getUserMedia`/`MediaRecorder` en `apps/web/src` | No se identificó captura de micrófono en ese alcance. Voz generada no equivale a grabación; función nueva candidata |
| Comparación original/procesado | `AudioProcessingControls.tsx` | Repetida: dos reproductores Original/Procesado. No tiene adopción en ese componente; antes de añadirla hay que seguir el asset por el flujo completo |
| Máscara geométrica | Crop/transformaciones del documento e inspector | Crop existente; elipse/máscara editable no acreditada como equivalente. Mantener distinción geométrica y de render |
| Ocultar datos sensibles | Controles de capas/transformaciones actuales | No se identificó herramienta dedicada de cobertura temporal. No prometer anonimización del asset original ni privacidad solo por preview |
| Marca de curso | `composition-branding.service.ts`, `composition-preset-application.service.ts`, `CompositionPresetPanel.tsx`, controles de texto/fuentes | Intros/outros, presets y estilos existen. No rehacer branding genérico; delta posible: propagación versionada de colores/tipografía entre lecciones con overrides |
| Variante de formato | `NativeCompositionPreview.tsx`: operación `composition.canvas-size` | Cambio de canvas repetido. Delta: variante no destructiva y revisión/adaptación de layout; no asumir auto-reencuadre existente |
| Tira temporal de thumbnails | `production/media-derivatives/thumbnail-derivative.contract.ts`, `thumbnail-plan.service.ts` | En curso: contrato, LOD, presupuesto y planificación por viewport/playhead. No acreditan extracción de frames, storage ni UI. Reutilizar esta base |
| Chroma/denoise/tracking | Procesamiento de voz existente y controles de color | Condicionados a demanda. Corrección de color y normalización/compresión no acreditan estas funciones |

Prefijos: componentes citados están en `apps/web/src/domains/materials/components/composition-editor/`; archivos `composition-*` y `editor-patch.types.ts` en `apps/web/src/domains/production/composition-editor/`; rutas `production/*` bajo `apps/web/src/domains/`.

## Otras bases que no deben reaparecer como nuevas herramientas

- Selección múltiple, grupos, bloqueo, alineación/distribución, posición/tamaño/rotación/opacidad y crop: conservar controles y contratos actuales.
- Biblioteca de medios, reemplazo de assets, presets de composición y fuentes: ampliar solo necesidades demostradas, no reconstruir bibliotecas.
- Waveforms, medidores, volumen, fades y ducking: bases existentes; una curva editable no justifica sustituirlas.
- Historial/recuperación y validación de operaciones: infraestructura transversal existente. Una nueva herramienta debe incorporarse al mismo sistema.
- Texto/captions nativos, importación SRT/VTT y segmentación desde palabras: conservar; un editor de subtítulos nuevo sería redundante.

## Cambio de prioridad derivado de la auditoría

HTML editable y thumbnails siguen en sus implementaciones actuales; se retiran de la lista de iniciativas nuevas. Comparación A/B, navegación por palabra, cambio de canvas y callouts de slides se descartan como propuestas nuevas en su alcance ya cubierto.

La investigación nueva se concentra en señalización temporal sobre demos y extensiones específicas del editor de captions. Zoom por región, freeze interior, transcripción operable, pausas y autoría de volumen requieren definir su delta antes de implementar. Marca compartida y adopción/reversión de audio necesitan comprobar el flujo completo antes de declarar una brecha.

## Validación y límites

Validado por lectura: presencia de controles, operaciones y alcance declarado de módulos en desarrollo. No validado: funcionamiento extremo a extremo, seguridad efectiva de integración, paridad preview/export, rendimiento ni QA de usuario. La fuente externa demuestra una interacción de referencia, no ausencia local ni prioridad de producto.

Actualizar esta matriz antes de cada propuesta nueva: localizar UI y operación, comprobar flags/permisos, seguir persistencia y compilación, y registrar solo el delta. Esto evita convertir investigación en trabajo duplicado mientras el sistema continúa evolucionando.
