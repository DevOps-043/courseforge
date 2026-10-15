# Herramientas explícitas del editor web: propósito, comparación y backlog

Fecha de investigación: 2026-10-02. Complemento del benchmark, no sustitución de su corte histórico.

## 1. Objetivo y alcance

El propósito original era convertir la producción audiovisual de Courseforge en un **editor educativo web completo, estructurado y ampliable**, donde un usuario pueda corregir y terminar los materiales generados sin reconstruirlos en una herramienta externa. No era clonar Premiere, construir otro motor ni acumular efectos populares.

El [prompt original](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_RESEARCH_PROMPT.md) exige utilidad educativa, integración arquitectónica, seguridad, factibilidad web y automatización, en ese orden. Incluye herramientas de timeline, canvas, audio, texto, captions, movimiento y HTML; no se limita a undo o conformidad. La [investigación](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_RESEARCH.md) y el [roadmap](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md) priorizaron correctamente sus cimientos, pero los CAP son familias de capacidades, no especificaciones suficientes de cada herramienta visible.

El resultado esperado debe describirse con tareas del usuario: corregir un título de slide; reemplazar una imagen; señalar un botón de una demostración; eliminar una toma equivocada; mejorar la narración; corregir y sincronizar captions; mantener la marca del curso; exportar lo que realmente se vio.

### Precisión sobre los «25 editores»

El benchmark existente tiene **25 fuentes externas**, incluyendo documentación de estándares, infraestructura y librerías: no acredita una comparación funcional profunda de 25 editores. El prompt nombra 22 entradas de referencia si CapCut Web y Desktop se cuentan separadamente. Remotion es además un referente tecnológico del benchmark. Varios productos quedaron explícitamente como `No verificada`.

Este complemento revisa ese universo sin inventar tres competidores para completar un número. Tampoco deduce que una función desktop existe en la versión web.

### Método y límites

- Fuentes locales: prompt, investigación, benchmark, auditoría, roadmap y hoja de seguimiento, contrastados con componentes UI, esquema y servicios actuales.
- Código observado: rama `staging`, HEAD `7e16e8c350b1b8c5453875bc26e67be4ab5b03b1`, con cambios locales existentes. El HEAD solo no reproduce todo el estado observado.
- Fuentes externas: documentación oficial abierta y consultada el 2026-10-02. No se ejecutaron sesiones autenticadas ni se comprobaron funciones de pago.
- `Presente` significa controles/contratos identificados, no certificación de funcionamiento en producción. `No localizada` expresa el límite de esta inspección, no prueba absoluta de inexistencia en otros módulos.
- No se ejecutó QA formal, no se aplicaron migraciones, no se desplegó y no se modificó código del editor.

## 2. Diagnóstico: cimientos y herramientas son dos entregables distintos

Undo, recuperación, operaciones comunes y conformidad son infraestructura editorial necesaria. **No reemplazan el catálogo de herramientas**. Un editor puede tener un documento muy robusto y seguir obligando al usuario a salir del sistema para corregir un elemento de una slide o explicar visualmente una demostración.

La carencia documental principal es la granularidad: `CAP-020 — efectos` no especifica si se entrega una máscara rectangular, chroma, blur localizado o tracking; `CAP-029 — HTML editable` no dice qué elemento puede seleccionar el usuario y qué propiedades puede cambiar. Cerrar una subfunción no cierra automáticamente toda la familia.

La falta de QA afecta la confianza y la habilitación, pero **no explica por sí sola la falta de herramientas especificadas**. También hacen falta decisiones de producto y contratos por herramienta. No conviene ampliar indefinidamente CAP-027 para cubrir todo el benchmark.

### Estado actual frente al benchmark histórico

| Familia | Evidencia actual identificada | Límite que debe conservarse |
|---|---|---|
| Timeline | Trim/split/rangos; selección, copy/paste, duplicación, ripple delete, grupos; inserción y sobrescritura; roll y slide | No equiparar estos controles con un NLE profesional completo; slip dedicado y marcadores requieren definición/confirmación |
| Canvas | Transformaciones, recorte/fit; alineación y distribución de selección; overlay de áreas seguras | No volver a proponer alineación como ausente; guías persistentes, reglas y herramientas de dibujo son alcance diferente |
| Texto/captions | Texto nativo, estilos, cues editables, importación SRT/VTT, presets visuales; esquema con tiempos por palabra | Los tiempos por palabra en el modelo no prueban un editor gráfico de cada palabra; no confundir edición de captions con edición del video por transcripción |
| Audio | Ganancia, fades y ducking; componentes de waveform, medidores y diagnóstico; botón de tratamiento de voz | El perfil de voz no equivale a denoise IA, EQ libre o automatización de volumen. El resultado del procesamiento pide comparación antes de uso |
| Movimiento | Presets/keyframes y rutas simples acotadas | Rutas simples experimentales no son curvas Bézier, graph editor ni tracking |
| Video | Controles de velocidad y congelación de cola bajo flags | Velocidades 0.5/1.5/2x para B-roll silencioso elegible; freeze solo cola final acotada. No es retiming general ni freeze arbitrario |
| Medios | Biblioteca y modos de inserción/reemplazo | No implica proxies o sprites de thumbnails implementados |
| HTML | Render/composición de slides y trabajo de conformidad de texto | Medir o renderizar texto de un deck no entrega selección y edición de sus elementos |

Evidencia local principal:

- [Selección y edición múltiple](../../apps/web/src/domains/materials/components/composition-editor/CompositionSelectionPanel.tsx), [operaciones de timeline](../../apps/web/src/domains/production/composition-editor/composition-timeline-edit.service.ts), [biblioteca e inserción](../../apps/web/src/domains/materials/components/composition-editor/CompositionStudioLibrary.tsx).
- [Inspector](../../apps/web/src/domains/materials/components/composition-editor/CompositionInspector.tsx), [viewport y áreas seguras](../../apps/web/src/domains/materials/components/composition-editor/CompositionPreviewViewport.tsx), [controles de pista](../../apps/web/src/domains/materials/components/composition-editor/TrackControls.tsx).
- [Texto/captions](../../apps/web/src/domains/materials/components/composition-editor/CompositionTextControls.tsx), [contrato de texto/palabras](../../apps/web/src/domains/production/composition-editor/composition-text-layer.types.ts), [presets de captions](../../apps/web/src/domains/production/composition-editor/composition-caption-preset.service.ts).
- [Mezcla](../../apps/web/src/domains/materials/components/composition-editor/AudioMixControls.tsx), [tratamiento de voz](../../apps/web/src/domains/materials/components/composition-editor/AudioProcessingControls.tsx), [velocidad](../../apps/web/src/domains/materials/components/composition-editor/CompositionVideoRateControls.tsx), [freeze](../../apps/web/src/domains/materials/components/composition-editor/CompositionVideoFreezeControls.tsx).

Los enlaces de código se resuelven desde `docs/architecture` al repositorio. La [hoja de seguimiento](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_DELIVERY_TRACKER.md) mantiene CAP-004/009/010/017/023/026 como **Completada; falta QA**, y CAP-027 **Parcial, 80.25%**. Este estudio no cambia esos estados ni porcentajes. Esa muestra de siete CAP tampoco mide la cobertura de todas las herramientas del editor.

## 3. Comparación del universo original

`Alta` indica documentación técnica/help específica; `Media` material oficial comercial/tutorial o evidencia de plataforma incompleta. Se verifica la afirmación indicada, no todas las funciones del producto. Las recomendaciones de adopción son inferencias de producto para Courseforge.

| Referente | Función/documentación contrastada | Qué tomar para Courseforge | Plataforma y confianza |
|---|---|---|---|
| HyperFrames | [Composiciones HTML](https://hyperframes.app/docs/1-startup/1-introduction) | Conservar el motor; el editor es una capa de autoría | Framework/render, Alta; no un sustituto UI listo |
| Canva | [Captions como capa editable y paquetes de estilo](https://www.canva.com/help/generate-edit-captions-on-videos/) | Estilo consistente y corrección accesible | Editor documentado, Alta; disponibilidad/rollout pueden variar |
| CapCut Web | [Keyframes](https://www.capcut.com/tools/keyframe-animation) y [chroma online](https://www.capcut.com/resource/chroma-key-online) | Controles contextuales de movimiento y efectos acotados | Guías oficiales web, Media; no trasladar todo el catálogo desktop |
| Adobe Express | [Edición web de video](https://helpx.adobe.com/sg/express/web/video-creation-and-editing/create-videos/video.html) | Alternar escenas/capas y controles simples | Web, Alta; vista de todas las capas documentada como beta |
| VEED | [Edit by Script](https://support.veed.io/en/articles/11137955-how-to-use-our-edit-by-script-tool) | Cortes reversibles desde palabras y pausas | Web/help, Alta; no admite reordenar footage arrastrando texto |
| Descript | [Tutorial oficial de edición basada en texto](https://www.descript.com/blog/article/descript-tutorial-for-beginners-6-steps-to-get-started) | Selección semántica de narración y revisión de limpieza | Media; paridad de estas funciones en navegador no verificada aquí |
| Clipchamp | [Autocaptions, transcripción y procesamiento de audio](https://support.microsoft.com/en-au/clipchamp/how-to-use-autocaptions-in-clipchamp) | Texto revisable y navegación por narración | Alta; documentación explicita procesamiento con Azure, no todo es local |
| Kapwing | [Smart Cut y Find Scenes](https://www.kapwing.com/help/how-to-use-smart-cut/) | Sugerencias de silencios/cortes con revisión | Herramienta web documentada, Alta |
| Runway | [Recorte y ensamblaje actual en Studio](https://help.runwayml.com/hc/en-us/articles/52685547867667-Trimming-and-Assembling-Clips-in-Studio) | Edición asistida que conserva controles manuales | Web/help, Alta; guía actual dice que imágenes no están soportadas en esa timeline |
| Photopea | [Máscaras raster/vector y edición no destructiva](https://www.photopea.com/learn/masks) | Máscaras simples antes de herramientas cinematográficas | Web, Alta; referencia de imagen, no evidencia de timeline audiovisual |
| Premiere | [Slip preservando la posición del clip](https://helpx.adobe.com/premiere/desktop/edit-projects/trim-clips/perform-slip-edits.html) | Semántica precisa de herramientas de montaje | Desktop, Alta; no adoptar su complejidad de interfaz |
| After Effects | [Keyframes y Graph Editor](https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animation-basics/animation-basics.html) | Evolución de easing controlado, no expressions arbitrarias | Desktop, Alta |
| DaVinci Resolve/Fairlight | [Edición](https://www.blackmagicdesign.com/products/davinciresolve/edit) y [EQ/dinámica/mezcla](https://www.blackmagicdesign.com/products/davinciresolve/fairlight) | Audio inteligible y control de montaje; no una DAW completa | Desktop, Alta sobre funciones documentadas |
| Final Cut Pro | [Herramienta slip](https://support.apple.com/en-am/guide/final-cut-pro/ver1632d8e4/mac) | Operaciones de tiempo con invariantes explícitas | Desktop, Alta |
| CapCut Desktop | [Guía oficial PC](https://www.capcut.com/resource/pc-professional-video-editor) | Techo de referencia, separar funciones de la versión web | Desktop, Media |
| Blender VSE | [Manual de transiciones](https://docs.blender.org/manual/en/5.3/video_editing/edit/montage/strips/transitions/index.html) | Referente pendiente, no requisito automático | No verificada: lectura del manual falló; no se usan snippets como prueba |
| Figma | [Alineación, dimensiones y distribución](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions) | Manipulación visual consistente; extender lo ya presente | Diseño visual, Alta; no referente de audio/video |
| Photoshop | [Edición no destructiva](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html) | Original inmutable y ajustes reversibles | Documento general, Alta; no acredita equivalencia de funciones web |
| Affinity | [Centro oficial de máscaras](https://www.affinity.studio/help/layers-layer-masks/) | Referencia pendiente para máscaras | No verificada: página no expuso contenido suficiente para contrastar la función |
| Webflow | [Propiedades de componentes](https://help.webflow.com/hc/en-us/articles/33961219350547-Component-properties) | Exponer texto/imagen/opciones sin romper la estructura | Autoría visual web, Alta |
| Framer | [Property Controls tipados](https://www.framer.com/developers/property-controls) | Inspector generado desde propiedades permitidas | Autoría visual, Alta |
| GrapesJS | [Traits de componentes](https://grapesjs.com/docs/modules/Traits.html) | Modelo editable independiente del DOM observado | Framework web, Alta; no implica instalarlo ni seguridad automática |

Referente tecnológico adicional: [Remotion: construcción de editor con timeline](https://www.remotion.dev/docs/building-a-timeline). Ayuda a separar documento, controles y reproducción; no justifica cambiar el framework actual.

Advertencia de vigencia: Runway [retiró su editor de proyectos anterior el 30 de julio de 2026](https://help.runwayml.com/hc/en-us/articles/19155664495379-Inpainting). Sus guías antiguas de inpainting no deben usarse para afirmar que ese editor sigue disponible. Ninguna matriz histórica debe actualizarse mediante copia indiscriminada de marketing.

## 4. Catálogo explícito: qué haría el usuario en nuestra web

IDs `WEB-Txx` son etiquetas de este catálogo, **no nuevos CAP**. El mapeo es una propuesta de adscripción, no una afirmación de que el alcance ya esté aprobado. `Presente` requiere QA; `Ampliar` conserva la base; `Propuesta` necesita implementación; `Confirmar` necesita auditoría específica.

Prioridades: A = siguiente valor educativo; B = segunda entrega; C = demanda/evidencia antes de invertir. No son puntajes empíricos de uso.

| ID | Herramienta/control explícito | Uso educativo | Estado observado / CAP propuesto | Prioridad y ejecución |
|---|---|---|---|---|
| WEB-T01 | Seleccionar, mover, trim y cuchilla/split | Quitar una toma equivocada | Presente; CAP-002/003 | Mantener; UI + operaciones |
| WEB-T02 | Eliminar intervalo y cerrar hueco | Acortar una explicación | Presente; CAP-002/004 | Mantener; operación atómica |
| WEB-T03 | Copy/paste, duplicar y grupos | Reutilizar una secuencia | Presente; CAP-004 | Mantener |
| WEB-T04 | Insertar desplazando / sobrescribir | Cambiar B-roll sin reconstruir timeline | Presente; CAP-002/023 | Mantener |
| WEB-T05 | Roll y slide con ajuste por frames | Corregir el punto de corte | Presente; CAP-002 | Mantener; revisar handles/sincronía |
| WEB-T06 | Slip dedicado y comparación de frames de entrada/salida | Cambiar la parte visible sin mover el clip | No localizado como herramienta dedicada; CAP-002 | B; no duplicar el inspector de offset |
| WEB-T07 | Marcador, capítulo y notas temporales | Identificar pasos de una lección | Propuesta; extensión de CAP-003 | A; metadata, exportar solo si contrato lo define |
| WEB-T08 | Mover/redimensionar/rotar; crop y contain/cover | Encuadrar instructor o captura | Presente; CAP-005/006 | Mantener |
| WEB-T09 | Alinear/distribuir y áreas seguras | Títulos y composiciones consistentes | Presente; CAP-004/005/008 | Mantener; no reconstruir |
| WEB-T10 | Reglas y guías persistentes; zoom/pan de edición | Ajustar elementos pequeños | Confirmar superficie completa; CAP-005/008 | B; guías de editor no se queman en el video |
| WEB-T11 | Flecha, rectángulo, círculo, resaltado y callout | Señalar un botón o código relevante | Propuesta como primitivas nativas; CAP-005/020/024, extensión a precisar | A; propiedades tipadas + render compartido |
| WEB-T12 | Zoom de demostración: elegir región, entrar, sostener y volver | Mostrar un detalle de pantalla | Ampliar presets/keyframes; CAP-012/024 | A; macro de operaciones, no motor nuevo |
| WEB-T13 | Congelar un frame elegido y continuar | Explicar un resultado sin que avance | Ampliar freeze de cola experimental; CAP-021 | B; captura/identidad de frame y audio explícitos |
| WEB-T14 | Velocidad con audio y preservar tono; reverse | Resumir pasos repetitivos | Ampliar: solo rate silencioso acotado hoy; CAP-021 | B velocidad, C reverse; backend para derivados pesados |
| WEB-T15 | Editar texto y estilos nativos | Corregir títulos y conceptos | Presente; CAP-014 | Mantener |
| WEB-T16 | Corregir captions, tiempos y SRT/VTT | Subtítulos precisos y accesibles | Presente; CAP-015 | Mantener; incluye revisión lingüística |
| WEB-T17 | Retiming visual de palabras, dividir/unir cues, aplicar estilo de curso | Ajustar términos técnicos y evitar desbordamiento | Ampliar UI; modelo ya admite palabras; CAP-014/015/024 | A; no generar de nuevo todo el contenido |
| WEB-T18 | Kit de marca del curso/organización y aplicar a selección | Unificar tipografía, colores y rótulos | Ampliar presets; CAP-014/024 | A; versiones y permisos por organización |
| WEB-T19 | Gain/fades, mute y ducking | Oír narración sobre música | Presente; CAP-007/016 | Mantener |
| WEB-T20 | Solo temporal y envolvente de volumen | Revisar una voz y ajustar una frase | Ampliar; solo no localizado en controles revisados; CAP-007/016 | B; distinguir monitor temporal de edición exportable |
| WEB-T21 | Waveform, medidores, diagnóstico de loudness/clipping | Localizar pausas y prevenir audio saturado | Implementación registrada pendiente QA; CAP-017 | Mantener; no confundir estimaciones con LUFS certificado |
| WEB-T22 | Procesar voz y comparar original/procesado | Mejorar inteligibilidad | Perfil existente de graves/compresión/limitador/normalización; CAP-018 | Completar adopción/reversión y operación del worker, no reconstruir |
| WEB-T23 | Denoise y presets de EQ revisables | Limpiar grabaciones reales | Extensión, no atribuida al perfil actual; CAP-018 | B; job acotado + derivado inmutable |
| WEB-T24 | Editar narración seleccionando palabras de transcripción | Eliminar una frase errónea con su video/audio | Propuesta; CAP-002/015/025 | A; tiempos reales, propuesta de cortes y confirmación |
| WEB-T25 | Detectar silencios/muletillas y revisar cortes sugeridos | Reducir pausas sin borrar una explicación | Propuesta; CAP-017/025 y operaciones CAP-002 | A; primero detector de pausas, no borrado automático |
| WEB-T26 | Separar audio y vincular/revincular con video | Corregir narración conservando sincronía | Separar presente; vincular general a confirmar; CAP-004/016/023 | B; offset y ownership explícitos |
| WEB-T27 | Corrección básica de color | Homogeneizar medios | Experimental según controles/flag; CAP-019 | Completar alcance ya definido |
| WEB-T28 | Máscara rectangular/circular con borde suave | Picture-in-picture y enfoque visual | Propuesta; CAP-020 | B; no empezar por máscaras libres complejas |
| WEB-T29 | Blur localizado o cobertura opaca de información sensible | Ocultar datos de una captura | Propuesta; CAP-020 | A cobertura opaca; B blur; evaluar privacidad del original |
| WEB-T30 | Chroma / remoción de fondo | Integrar instructor sobre slides | Propuesta; CAP-020 | B chroma; C segmentación IA, costo/consentimiento |
| WEB-T31 | LUT, estabilización y tracking | Casos avanzados específicos | Sin herramienta validada aquí; CAP-020 | C; demanda + corpus + costo antes de comprometer |
| WEB-T32 | Presets/transiciones/keyframes; easing editable acotado | Presentar conceptos progresivamente | Base presente/flag; ampliar curvas; CAP-012/013/024 | B curvas; mantener catálogo cerrado inicialmente |
| WEB-T33 | Seleccionar elemento de slide/HTML y editar su texto/imagen | Corregir material generado sin regenerar el deck | Propuesta; CAP-029 | A, primera prioridad de implementación |
| WEB-T34 | Editar tema, valores de gráfico y orden de bloques declarados | Actualizar números/contenido de una slide | Propuesta; CAP-029/024 | A texto/imagen/tema; B gráficos/bloques |
| WEB-T35 | Thumbnails en timeline, preview ligero/proxy y calidad de reproducción | Buscar una toma con rapidez | Propuesta; waveform/cache no cubre todo; CAP-022 | B, adelantar si medición demuestra cuello de botella |
| WEB-T36 | Reemplazar/relocalizar medios manteniendo edits | Actualizar una imagen o toma | Base presente; CAP-023 | Mantener; validar compatibilidad de duración/fuente |
| WEB-T37 | Grabar pantalla + micrófono/cámara desde navegador | Crear una demostración sin app externa | No localizado en búsqueda de APIs de captura en `apps/web/src`; frontera captura/edición a acordar | B; adquisición separada, permisos y soporte navegador |
| WEB-T38 | Adaptar composición a otro formato manteniendo legibilidad | Reutilizar una lección en otro canal | Canvas-size no equivale a adaptación automática; CAP-006/014/024 | B; reglas/presets, no recorte ciego |

Este catálogo corrige el nivel de detalle, no autoriza instalar proveedores o librerías ni iniciar todas las herramientas. Las anotaciones, capítulos y captura necesitan delimitar explícitamente su alcance antes de adscribirlas definitivamente a un CAP existente. No se añaden nuevos CAP solo para incrementar el inventario.

## 5. Ruta recomendada y organización de la interfaz

### Entrega A: editar lo que Courseforge ya genera

1. **CAP-029 V1**: slides/componentes instrumentados; selección de elementos declarados, texto, imagen y tema. No edición libre de todo HTML.
2. **Herramientas didácticas**: callouts/flechas/resaltados y zoom de demostración como primitivas o presets compartidos.
3. **Captions y marca**: completar corrección por palabra, segmentación y estilo de curso sobre contratos existentes.
4. **Montaje asistido**: silencios con sugerencias revisables; después cortes por transcripción sincronizada, reutilizando operaciones existentes y CAP-025.

Se puede diseñar e implementar un bloque independiente mientras se termina la base, con flags y límites de alcance. Habilitarlo para usuarios requiere su validación preview/render; no hace falta que cada extensión reabra todas las decisiones del motor.

### Entrega B: eficiencia de producción

Thumbnails/proxies según mediciones, voz procesada adoptable y reversible, solo/envolventes, máscaras simples, freeze arbitrario, formatos alternos y grabación de demostraciones si se aprueba esa frontera. Prioridad de CAP-022 sube si los medios reales hacen inviable el flujo; no se presume por cantidad de archivos.

### Entrega C: efectos selectivos, no paridad cinematográfica

Chroma avanzado/segmentación, LUT, tracking, estabilización, curvas libres o retiming general solo con demanda y presupuesto demostrados. Colaboración en tiempo real, 3D y expressions libres no son requisitos para completar una lección web.

### Ubicación de herramientas

- Biblioteca lateral: medios, texto, captions, elementos didácticos, slides/HTML, templates y efectos.
- Barra contextual: seleccionar, cortar, ajustar corte, alinear y acciones compatibles con la selección.
- Timeline: tracks, waveform/thumbnails, marcadores, grupos y diagnóstico de sincronía.
- Inspector: propiedades tipadas, estilos, voz, movimiento, máscaras y elemento HTML seleccionado.
- Panel de narración: transcripción sincronizada y cortes propuestos; no confundirlo con el guion escrito original.

La interfaz no debe mostrar herramientas incompatibles como si funcionaran: explicar restricciones y permitir revertir documentos existentes aunque una flag se desactive.

## 6. Arquitectura y factibilidad web

**Operar desde la web no significa procesar todo en el navegador.** Selección, overlays, edición y previsualización son UI web; análisis pesado, procesamiento de voz, derivados y render pueden ser jobs backend.

| Lugar | Responsabilidades propuestas | Restricciones |
|---|---|---|
| Navegador | Canvas/timeline, inspector, selección semántica, visualización de waveform y transcripción, captura autorizada | RAM/GPU, codecs, permisos y cancelación; no garantizar soporte universal |
| Servicios compartidos | Validación, operaciones atómicas, inversas, selección/grupos, cuantización y reglas de sincronía | No incrustar reglas en botones; UI e IA usan el mismo gateway |
| Backend/jobs | STT/denoise, perfiles de voz, thumbnails/proxies, freeze derivado y render pesado | Cuotas, límites, idempotencia, ownership, retries acotados y cancelación |
| Documento/compilador | Propiedades declarativas, referencias inmutables, proyección idéntica al preview/render | Versionado, hashes de fuentes/derivados, fonts y colores controlados |

La [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture) requiere autorización del usuario; el audio de sistema depende del entorno. [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) ofrece primitivas de codec, no un editor ni pipeline completo de exportación. La documentación de [Clipchamp](https://support.microsoft.com/en-au/clipchamp/how-to-use-autocaptions-in-clipchamp) muestra por qué «editor web» tampoco implica transcripción completamente local.

### Contrato obligatorio por herramienta

Antes de declararla terminada, cada herramienta debe tener una ficha:

1. Acción visible, ejemplo educativo, shortcut y estados de disponibilidad.
2. Tipos de elementos/fuentes compatibles; límites de tamaño, duración y cantidad.
3. Operación(es) tipadas, validación de negocio y lote atómico; nunca comandos del modelo ejecutados libremente.
4. Inversa/undo, autosave, recuperación y comportamiento ante concurrencia.
5. Semántica temporal: frames, source offsets, audio/captions/grupos afectados.
6. Representación persistida y reglas de preview y render; versión de contrato.
7. Autorización/organización, aislamiento y referencia inmutable al original.
8. Costo/latencia, cancelación, mensajes seguros y diagnóstico sin contenido sensible.
9. Criterios de aceptación y casos límite verificables.

### CAP-029: primera ficha de producto propuesta

**Acción:** seleccionar el título de una slide, corregirlo en el inspector y ver el resultado sin regenerar todo el deck.

**Alcance V1:** manifiesto versionado de elementos con IDs estables; texto plano, referencia de imagen aprobada y tokens de tema. Las plantillas declaran qué campos se pueden editar y sus límites. HTML no instrumentado permanece como recurso opaco/no editable, con mensaje explícito.

**Modelo:** fuente original inmutable + overrides tipados ligados al ID y versión/hash del manifiesto. No selectores CSS frágiles ni escritura libre de `innerHTML`. El puente informa selección/geometría; el modelo determina el contenido. El compilador aplica los mismos overrides a preview y render.

**Seguridad:** autorización por componente/organización, sandbox, CSP, mensajes con identidad/origen validado, allowlist de propiedades/URLs y límites de texto/imagen. No JavaScript, CSS o URLs arbitrarias aportadas por el usuario. Sanitización de entrada no sustituye aislamiento.

**Aceptación:** seleccionar/cambiar/restaurar; undo/redo; persistir/recuperar; rechazo de nodo obsoleto/ajeno; textos largos y fonts; imagen autorizada; ninguna ejecución de payloads; correspondencia del elemento editado en preview/export. Reordenar bloques, gráficos y DOM libre quedan fuera de V1.

El patrón de propiedades expuestas se apoya en [Webflow](https://help.webflow.com/hc/en-us/articles/33961219350547-Component-properties), [Framer](https://www.framer.com/developers/property-controls) y [GrapesJS](https://grapesjs.com/docs/modules/Traits.html), pero esta arquitectura es una recomendación nuestra, no una garantía de seguridad de esos productos.

## 7. Riesgos y validación posterior

No convertir `Completada; falta QA` en `Operativa` ni contar porcentaje de infraestructura como porcentaje de herramientas. Esta investigación no confirma todos los flujos end-to-end del código encontrado.

| Riesgo | Validación requerida cuando se habilite QA |
|---|---|
| Cortes desincronizan voz/avatar/captions | Operaciones atómicas, offsets, grupos, undo y render de bordes a distintos FPS |
| Texto HTML editable pero export diferente | Misma identidad de manifiesto, overrides y fuentes; corpus de títulos largos, imágenes y slides |
| Limpieza elimina pausas pedagógicas o palabras técnicas | Sugerencia revisable, umbral configurable, restore, comparación de transcripción y audio |
| Procesamiento altera la voz o se usa sin confirmar | A/B original/derivado, clipping/loudness, adopción explícita y rollback |
| Anotación o blur oculta solo en preview | Inspección de MP4; privacidad del original y derivados, no prometer anonimización irreversible |
| Proxy equivocado termina en export | Fuente original autoritativa, identidad del derivado, invalidación y fallbacks |
| Captura registra datos ajenos | Permisos explícitos, indicador visible, parada/cancelación y política de almacenamiento |
| Herramientas inaccesibles | Teclado/foco, nombres accesibles, contraste, alternativas al drag y errores comprensibles |

Medir con tareas reales: tiempo para corregir una slide, errores de sincronía tras un corte, tiempo para corregir captions, latencia de scrub/primer frame y frecuencia de tener que abrir un editor externo. No inventar metas de rendimiento o ROI sin baseline.

## 8. Decisión recomendada

Conservar el trabajo de estructura y conformidad. Añadir **una capa de backlog por herramientas y tareas educativas**, conectada a los CAP existentes, con cierre individual y límite explícito de cada versión.

La siguiente implementación recomendada sigue siendo **CAP-029 V1**, acompañada por especificaciones de herramientas didácticas y captions; CAP-022 se adelanta si las mediciones lo justifican y CAP-025 permite propuestas de montaje seguras. No ampliar todo a la vez ni declarar que estas propuestas ya están implementadas.

No se requiere reiniciar el roadmap. Se requiere distinguir y seguir separadamente: **base fiable, herramientas visibles, habilitación y QA**.
