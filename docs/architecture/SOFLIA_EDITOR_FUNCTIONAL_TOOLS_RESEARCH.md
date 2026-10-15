# Investigación funcional de herramientas para el editor educativo web

Fecha: 2026-10-03. Documento rector de esta línea de investigación, independiente del seguimiento de capacidades previo.

## 1. Objetivo corregido

Identificar herramientas útiles, comprender su comportamiento observable y especificar una implementación propia en Courseforge. **No copiar código, extraer módulos, portar algoritmos ni decidir librerías a instalar.** Los repositorios sirven como evidencia de funcionamiento y casos límite, no como proveedores de implementación.

La salida de esta investigación es un catálogo de tareas, reglas e interacciones que el producto necesita. La tecnología interna de un referente no es un requisito nuestro. Un editor desktop puede enseñar una buena operación aunque su implementación no sirva para navegador.

Los informes anteriores conservaron evidencia útil, pero mezclaron este propósito con candidatos de dependencias/adaptadores. Este documento sustituye esa orientación para esta conversación; no borra los registros históricos ni modifica código existente.

## 2. Método y cobertura real

Para cada herramienta se responde: problema educativo, entrada del usuario, controles, resultado, qué ocurre al mover/cortar/restaurar, diferencia respecto a lo existente y validación necesaria. Se distingue:

- **Hecho de referencia:** documentación oficial o comportamiento deducible de una ruta de código concreta.
- **Propuesta Courseforge:** decisión propia sugerida, no función atribuida al referente.
- **Estado local:** presencia encontrada en el código de Courseforge, sin asumir habilitación ni QA.

La lectura de fuente permite inferir reglas de una ruta, no certificar toda la interfaz del producto. No se ejecutaron demos externas ni se probaron herramientas comerciales autenticadas. Las funciones propuestas no están implementadas por crear este documento.

### Referentes existentes

| Referente | Qué estudiar | Qué NO tomar como objetivo |
|---|---|---|
| GrapesJS | Selección de elementos e inspector de propiedades | Editor libre de scripts/CSS/DOM |
| Moveable | Gestos de mover, rotar, redimensionar y delimitar regiones | Instalar su interacción ni copiar geometría |
| OpenCut Classic | Montaje, máscaras, captions y efectos parametrizados | Su renderer, historial o aplicación completa |
| WaveSurfer | Selección de regiones, puntos de volumen y grabación de voz | Un segundo reproductor o transporte |
| Twick | Capítulos y organización de herramientas | Código o SDK; su licencia no bloquea estudiar ideas generales |

Los commits y rutas de los cinco repositorios constan en el [registro local](SOFLIA_EDITOR_REPOSITORY_TOOL_ADOPTION_PLAN.md). Se mantiene la restricción de no reutilizar su implementación; no hay dependencia nueva por esta investigación.

### Referentes añadidos por una necesidad concreta

| Referente | Necesidad que cubre | Evidencia consultada |
|---|---|---|
| Kdenlive | Seleccionar fragmentos desde transcripción; editar captions; rótulos y formas | [Speech to Text](https://docs.kdenlive.org/en/effects_and_filters/speech_to_text.html), [Subtitles](https://docs.kdenlive.org/en/effects_and_filters/subtitles.html), [Title Clips](https://docs.kdenlive.org/en/titles_and_graphics/titles/titles.html), fuente selectiva |
| Audacity | Distinguir detección/reducción de pausas, control temporal del volumen y limpieza | [Truncate Silence](https://manual.audacityteam.org/man/truncate_silence.html), [Envelope Tool](https://manual.audacityteam.org/man/envelope_tool.html), fuente selectiva |
| Penpot | Consistencia de estilos y componentes con variaciones locales | [Components](https://help.penpot.dev/user-guide/design-systems/components/), [Design Tokens](https://help.penpot.dev/user-guide/design-systems/design-tokens/) |

Se descargaron **solo fuentes selectivas** de Kdenlive y Audacity en `.tmp/editor-behavior-research/2026-10-03/`, sin instalar o ejecutar aplicaciones. Penpot se investigó mediante documentación oficial y su [repositorio](https://github.com/penpot/penpot); no se descargó ni se atribuye una auditoría de su código.

Snapshots adicionales:

- Kdenlive, [repositorio](https://github.com/KDE/kdenlive), commit `2d1af355df26261764eb2761a84adf6fad432a64`; ruta `src/dialogs/textbasededit.cpp`. La ruta mantiene zonas temporales y procesa selecciones/cortes. Esto no acredita edición semántica perfecta ni equivalencia con el timeline de Courseforge.
- Audacity, [repositorio](https://github.com/audacity/audacity), commit `8de3891657f6348916a466239b01301d16399747`; ruta `au3/libraries/au3-builtin-effects/TruncSilenceBase.cpp`. Se inspeccionaron detección, coordinación de intervalos y opciones de reducción, no se trasladó su implementación.

Los clones son shallow/sparse y omiten submódulos. No constituyen una copia completa para compilar. Ninguna licencia se interpreta como permiso para copiar código en esta línea; si en el futuro cambiara ese alcance, requiere revisión separada.

## 3. Conclusiones funcionales que cambian el diseño

1. **Texto de slide, captions, guion y transcripción son objetos distintos.** Editar una palabra en un subtítulo no cambia lo pronunciado. Para cortar una frase se necesitan tiempos asociados a la fuente real y una operación audiovisual coordinada.
2. **Una región silenciosa no siempre debe eliminarse.** Puede contener una pausa para pensar o una acción visual sin voz. Se necesita audición, contexto visual y aceptación, no un botón destructivo universal.
3. **Máscara, resaltado y ocultación son funciones diferentes.** La máscara define qué parte del medio se ve; el resaltado añade una señal; la ocultación cubre información. Compartir una forma no implica compartir intención ni seguridad.
4. **Zoom de edición y zoom exportable son distintos.** Acercar el canvas para trabajar no debe afectar el video. Un zoom didáctico sí debe quedar temporizado en el documento.
5. **Estilo compartido y contenido reutilizado requieren una decisión de propagación.** Cambiar el aspecto de un curso no debería sobrescribir las correcciones locales de una lección sin avisar.
6. **La biblioteca de herramientas debe partir de lo que ya existe.** No reconstruir trim, split, grupos, alineación, captions básicos, waveform, ducking ni biblioteca de medios.

## 4. Catálogo de tareas y brechas

Revisión contra el código local: 2026-10-03, incluyendo implementaciones no comprometidas del flujo paralelo. La [auditoría de duplicación](SOFLIA_EDITOR_TOOL_DUPLICATION_AUDIT.md) contiene las rutas y límites de la evidencia. `Repetida` = excluir como iniciativa nueva; `En curso` = continuar el trabajo existente, sin abrir otra implementación; `Ampliar` = conservar la base y diseñar únicamente el delta; `Diseñar` = no se identificó un equivalente en el alcance inspeccionado; `Condicionar` = estudiar solo ante necesidad demostrada. Ninguna etiqueta certifica QA ni despliegue.

| Herramienta | Lo que logra el usuario | Estado y decisión propia |
|---|---|---|
| Montaje básico | Cortar, mover, insertar, sobrescribir y reorganizar tomas | Repetida; conservar operaciones y controles actuales |
| Edición de elemento de slide | Corregir texto o imagen sin regenerar todo | En curso en HTML editable; contratos existentes, integración e inspector pendientes. No abrir un editor paralelo ni asumir edición de gráficos/datos en V1 |
| Flecha/callout/resaltado | Señalar un botón, código o resultado | Diseñar overlay temporal sobre demos; el bloque callout de slides ya existe y no debe reconstruirse |
| Zoom didáctico | Acercar una región, sostenerla y volver | Ampliar movimiento con un flujo guiado |
| Congelar frame elegido | Detener una demostración para explicarla | Ampliar freeze; hoy se identifica cola final acotada |
| Marcadores y pasos | Nombrar puntos relevantes y saltar entre ellos | Diseñar marcadores arbitrarios persistidos; navegación por escenas y palabras ya existe |
| Dividir/unir captions | Mejorar lectura sin alterar la voz | Ampliar editor de cues existente |
| Ajustar tiempos de palabras | Corregir sincronía fina y resalte | Ampliar UI sobre tiempos por palabra existentes |
| Buscar y extraer una frase | Crear una toma desde lo realmente dicho | Ampliar panel narrativo existente con búsqueda, selección de rango y extracción; no crear otro panel sincronizado |
| Proponer eliminación de una frase | Quitar error y coordinar audio/video/captions | Ampliar propuestas y operaciones existentes con un plan específico ligado a transcripción; no reconstruir revisión de propuestas IA |
| Revisar/acortar pausas | Agilizar narración sin perder sentido | Diseñar detección + plan revisable |
| Volumen por puntos | Corregir una parte de la voz o música | Ampliar autoría/persistencia de puntos; las envolventes de reproducción para fades/ducking/crossfade ya existen |
| Grabar narración | Regrabar una explicación y preescucharla | Diseñar captura de audio separada |
| Comparar voz original/procesada | Escuchar ambas versiones | Repetida: la UI ya reproduce ambas. Evaluar adopción/reversión como delta separado, sin declarar ausente un flujo global no auditado |
| Máscara geométrica | Mostrar instructor en círculo o región recortada | Diseñar; distinguir del crop rectangular actual |
| Cubrir datos sensibles | Evitar exposición de un dato en el export | Diseñar cobertura opaca inicial; no prometer anonimizar originales |
| Marca del curso | Unificar colores/tipografía sin editar cada capa | Ampliar propagación de estilo compartido; intros/outros, fuentes y presets ya existen |
| Variante de formato | Adaptar posición y legibilidad al nuevo canvas | Ampliar canvas-size con revisión, no recorte automático ciego |
| Tira de thumbnails | Encontrar visualmente una toma | En curso: contrato y planificación por viewport/LOD existentes; extracción, almacenamiento e integración visual no acreditados |
| Chroma/denoise/tracking | Resolver material específico difícil | Condicionar; no primera entrega general |

Evidencia local de no duplicación: `CompositionSelectionPanel.tsx`, `CompositionStudioLibrary.tsx`, `CompositionInspector.tsx`, `CompositionTextControls.tsx`, `CompositionMotionControls.tsx`, `CompositionVideoFreezeControls.tsx`, `AudioMixControls.tsx`; servicios y schemas en `apps/web/src/domains/production/composition-editor/`.

La ruta `composition-transcript-caption.service.ts` ya utiliza palabras temporizadas y agrupa por longitud, pausa y frase. No hace falta copiar un segmentador de otro editor. El cambio útil es permitir corrección gráfica/segmentación y mantener trazabilidad, no sustituir la generación existente.

## 5. Fichas funcionales para implementación propia

Todas las reglas de esta sección son **propuestas nuestras**. Los referentes ayudan a precisar el problema, no definen el comportamiento que Courseforge deba copiar exactamente.

### A. Editar un elemento de slide

Esta ficha describe el resultado esperado del trabajo existente de HTML editable, no una herramienta nueva. Su V1 ya valida texto plano, imágenes autorizadas y temas simbólicos. No se acreditan todavía inspector, persistencia/gateway ni conexión al renderer; no ampliar su alcance a gráficos o HTML libre por esta ficha.

- **Acción:** seleccionar título o imagen de una slide y corregirlo en un inspector contextual.
- **Controles:** texto, recurso de imagen aprobado, ajuste permitido y restablecer; solo propiedades declaradas por la plantilla.
- **Resultado:** cambia esa instancia sin regenerar el deck ni modificar otras slides.
- **Reglas:** selección basada en identidad estable; no edición de un texto incrustado dentro de PNG. Si la slide carece de elementos declarados, mostrar que no permite edición por elemento.
- **Sincronía:** persistir la modificación y usarla tanto en preview como en export; cambio de fuente/plantilla invalida o reconcilia overrides con aviso.
- **Aceptación:** cambiar, deshacer, recargar y exportar conserva el contenido; nodo ajeno/obsoleto se rechaza; textos largos no se recortan silenciosamente.

### B. Señalización didáctica

- **Acción:** escoger flecha, caja, círculo o callout y situarlo sobre la demostración.
- **Controles:** texto opcional, color de tema, tamaño, orientación, inicio/fin y anclaje.
- **Resultado:** una capa temporal editable, no una modificación irreversible del video original.
- **Reglas:** elegir anclaje al canvas o a un clip. En V1 no hay seguimiento automático: si el objetivo se mueve, el usuario debe temporizar o animar la señal.
- **Sincronía:** mover/cortar el clip anclado requiere una política explícita de desplazamiento y recorte de la anotación.
- **Aceptación:** aparece solo en el intervalo elegido; undo restaura geometría y tiempo; export reproduce la señal; teclado permite ajustes sin drag.

### C. Zoom de demostración

- **Acción:** elegir región de interés y aplicar «acercar, explicar, volver».
- **Controles:** región, inicio, tiempo de entrada, sostén y regreso; preview del efecto antes de confirmar.
- **Resultado:** una animación exportable sobre el medio elegido. El zoom de trabajo del editor queda intacto.
- **Reglas:** regiones fuera del medio se rechazan o ajustan con aviso; crop previo y transformaciones se componen en un orden definido. No asumir que las coordenadas del canvas corresponden directamente a la fuente.
- **Aceptación:** reversión completa, reproducción hacia atrás/seek estable y texto/overlays conservados según el anclaje.

### D. Captions: dividir, unir y sincronizar

- **Acción:** situar cursor entre palabras y dividir un cue; seleccionar cues consecutivos y unirlos; arrastrar límites o editar tiempos.
- **Controles:** texto, tiempo, salto de línea, estilo y reproducción del fragmento.
- **Resultado:** cambia presentación/tiempos del caption, no la voz ni la duración del video.
- **Reglas:** conservar timestamps reales si existen; si solo hay tiempos de cue, etiquetar cualquier reparto como estimado y pedir ajuste. Las correcciones de texto no convierten por sí solas un token en timestamp pronunciado fiable.
- **Aceptación:** sin solapamientos ilegales ni cues fuera del clip; undo conserva IDs/procedencia; un término técnico no se divide arbitrariamente; no sobrescribir cues manuales por regeneración sin confirmación.

### E. Montaje desde transcripción

Reutilizar `CompositionNarrativePanel`: ya permite saltar a palabras y escenas. La búsqueda, selección de intervalos y extracción son el delta; no sustituir esta navegación ni la generación de captions temporizados.

- **Acción:** buscar una frase, escucharla y escoger «extraer» o «proponer corte».
- **Controles:** selección, handles temporales, preescucha, márgenes y comparación antes/después.
- **Resultado:** un plan sobre intervalos de la fuente, independiente del texto corregido para mostrar captions.
- **Reglas:** V1 puede comenzar con extraer una selección como nuevo clip. Eliminar del timeline es otra acción más riesgosa. Sin tiempos fiables, ofrecer selección manual del intervalo, no fingir precisión por palabra.
- **Sincronía:** plan ligado a versión del documento y fuente; confirmar implica coordinar clips vinculados y captions. Cambios concurrentes invalidan el plan.
- **Aceptación:** cortes reversibles, ningún corte fuera de fuente, preview de intervalos y duración final; la selección del texto no corta inmediatamente.

Referencia precisa: Kdenlive documenta extracción desde clips del bin, no una equivalencia universal con edición de texto en cualquier timeline. Esa limitación evita atribuirle un flujo que no se verificó. [Speech to Text](https://docs.kdenlive.org/en/effects_and_filters/speech_to_text.html).

### F. Pausas revisables

- **Acción:** analizar narración, recorrer pausas sugeridas y escoger cuáles acortar.
- **Controles:** umbral de nivel, duración mínima, pausa que se conserva, ámbito de análisis y aceptar/rechazar por intervalo.
- **Resultado:** propuestas de corte que reutilizan operaciones existentes, no audio procesado que borra el original.
- **Reglas:** bajo nivel no significa ausencia de información; música no debe ser la fuente de decisión por defecto. Pausas de reflexión y acciones de pantalla pueden protegerse. No aplicar independientemente a voz y avatar vinculados.
- **Aceptación:** reproducir con contexto visual; plan inválido si cambia la fuente; duración y material afectado visibles; cancelar no modifica nada; ruido no se presenta como eliminado.

Audacity diferencia reducción fija/proporcional y advierte sobre desincronía al tratar tracks independientemente. Acortar silencio no es denoise. [Truncate Silence](https://manual.audacityteam.org/man/truncate_silence.html).

### G. Volumen por puntos

Reutilizar la evaluación de envolventes existente. Los puntos calculados para fades/ducking/crossfade no acreditan una interfaz para que el usuario dibuje y persista su propia curva.

- **Acción:** añadir puntos para atenuar una frase o música en un intervalo concreto.
- **Controles:** tiempo, nivel, eliminar punto, restablecer y escucha del resultado.
- **Resultado:** automatización no destructiva, distinta de volumen global y fades de borde.
- **Reglas:** orden temporal, límites explícitos e interpolación definida; sin silencio implícito en extremos. Combinar con gain/fades/ducking/mute de forma documentada. El gráfico no puede usar una curva y el audio otra.
- **Aceptación:** mismos niveles en preview/export, comportamiento al trim/split predecible y diagnóstico de clipping; no crear otro transporte.

WaveSurfer y Audacity ilustran interfaces de puntos, pero sus reglas de interpolación no son idénticas. Nuestra elección debe ser explícita. [Envelope Tool](https://manual.audacityteam.org/man/envelope_tool.html).

### H. Marca y variantes de contenido

- **Acción:** elegir estilo de curso y aplicar a selección, lección o conjunto de elementos compatibles.
- **Controles:** alcance, vista previa de cambios, conservar overrides locales y restablecer al estilo de curso.
- **Resultado:** consistencia sin borrar el texto ni cambiar lecciones ajenas.
- **Reglas:** distinguir template compartido de instancia; cambios de marca requieren confirmación de propagación, permisos y versión. Un cambio de tema no cambia automáticamente la duración de una animación.
- **Aceptación:** resumen de elementos afectados, undo por lote y preservación de correcciones locales.

Penpot documenta instancias ligadas a componentes con overrides y tokens organizados por conjuntos. Esto orienta la relación entre estilo compartido y excepción local, sin requerir su modelo de datos. [Components](https://help.penpot.dev/user-guide/design-systems/components/), [Design Tokens](https://help.penpot.dev/user-guide/design-systems/design-tokens/).

### I. Marcadores y pasos pedagógicos

- **Acción:** marcar un instante, nombrarlo «Paso 3: ejecutar» y navegar por los pasos.
- **Controles:** nombre, color/categoría, punto o rango y ámbito clip/proyecto.
- **Resultado:** metadata navegable; no se quema en el video salvo acción distinta de rótulo.
- **Reglas:** marcadores de fuente y de timeline tienen distintas políticas ante cuts/ripple. Si el intervalo desaparece, avisar o eliminar dentro del mismo lote undoable; no dejar referencias inválidas.
- **Aceptación:** navegación precisa, persistencia, edición y export de metadata solo en formatos soportados. No confundir capítulos exportables con segmentos interactivos dentro de un MP4.

### J. Grabación y comparación de voz

- **Acción:** grabar narración, escucharla y añadirla/reemplazar una toma de forma explícita.
- **Controles:** micrófono, grabar, detener, cancelar, preescuchar, descartar y usar.
- **Resultado:** un asset nuevo; no modifica ni reemplaza automáticamente la narración previa.
- **Reglas:** límites de tamaño/duración, permisos visibles y liberación del micrófono incluso si la autorización llega después de cerrar el panel. Audio, cámara y captura de pantalla son ámbitos separados.
- **Aceptación:** cancelación sin asset editorial adoptado, permiso denegado y desconexión manejados, sin streams supervivientes.

La comparación original/procesado ya está en `AudioProcessingControls`; se descarta como implementación nueva. Verificar el ciclo completo de incorporación del asset antes de proponer adopción/reversión. No presentar normalización/compresión como reparación de ruido.

### K. Máscara y ocultación

- **Acción máscara:** delimitar rectángulo/elipse para mostrar solo parte de un medio.
- **Acción ocultación:** colocar una cobertura opaca sobre información sensible durante un intervalo.
- **Controles:** geometría, tiempo y anclaje; inversión/borde suave solo si se define como extensión.
- **Reglas:** crop, máscara y cobertura son operaciones distintas. V1 no incluye tracking ni paths arbitrarios. Cambiar encuadre exige revisar que la cobertura siga ocultando el dato.
- **Aceptación:** resultado presente en MP4, edición reversible y aviso de que el original almacenado sigue conteniendo información sensible. No prometer privacidad solo porque un overlay se vea en preview.

### L. Eficiencia de medios y otros formatos

- **Thumbnails:** continuar los contratos y el plan de derivados existentes, no diseñar una segunda base. Distinguir miniatura de asset, tira temporal y proxy. La tira ayuda a buscar frames; no cambia la fuente de export ni valida precisión de seek por sí sola.
- **Cambio de formato:** duplicar como variante, proponer layout y revisar títulos/captions. Cambiar canvas-size no equivale a adaptar contenido.
- **Aceptación:** fuente original preservada, límites/cancelación de derivados, legibilidad y ninguna sustitución accidental del render final por un proxy.

## 6. Qué NO hacer y qué conservar

- No añadir bibliotecas por haber encontrado una función interesante.
- No copiar estilos visuales, nombres de marca o assets del referente. Diseño de UX propio adecuado a Courseforge.
- No convertir este estudio en una reescritura del motor, almacenamiento o historial.
- No abrir HTML libre para simular edición por elemento; tampoco rasterizar todo si elimina la capacidad de corrección.
- No anunciar denoise, precisión por palabra, tracking o adaptación automática sin entregar el alcance real.
- Conservar operaciones comunes, validaciones, source offsets, fuentes/medios autorizados y arquitectura del editor existente.

Frontera propia: **intención del usuario → operación validada → documento existente → preview/render**. Las fichas funcionales se implementarán con contratos y módulos de Courseforge, no con tipos/eventos importados del referente.

## 7. Ruta por valor educativo, no por repositorio

| Orden recomendado | Entrega de producto | Por qué | Dependencia funcional |
|---|---|---|---|
| Continuidad existente | HTML editable y tira temporal de thumbnails | Evitar duplicar iniciativas activas; cerrar integración en sus propios flujos | Contratos locales existentes; no iniciar bases alternativas |
| 1 | Señalización temporal sobre demos | Permite explicar acciones sin reconstruir callouts de slides | Anclaje temporal y representación persistida |
| 2 | Dividir/unir captions y ajuste de palabras | Mejora precisión y accesibilidad sobre el editor actual | Tiempos existentes + UI de corrección |
| 3 | Zoom didáctico, freeze elegido y marcadores | Facilita demos de software | Semántica de anclaje/tiempo y movimientos existentes |
| 4 | Extracción por transcripción y pausas propuestas | Reduce montaje manual | Transcripción fiable y planes coordinados reversibles |
| 5 | Autoría de envolventes y grabación | Completa narración real sin rehacer mezcla ni comparación A/B | Mezcla/captura con límites y transporte único |
| Según evidencia | Propagación de marca, variantes y efectos específicos | Se justifica por uso y costo de trabajo reales | Medición o demanda; adopción de voz solo si el flujo completo demuestra una brecha |

Son recomendaciones de producto, no prioridades empíricas ni porcentajes de avance. El primer bloque nuevo puede reducirse a añadir una señal temporal sobre una demo → guardar → recuperar → exportar. La corrección de slides permanece en el trabajo existente de HTML editable; su relación con las anotaciones no justifica abrir otra implementación.

## 8. Seguridad y validación posterior

No se ejecutó QA ni se añadieron herramientas al editor en esta ronda. Se validó documentalmente presencia de los módulos citados y el alcance de fuentes oficiales. Las reglas propias propuestas necesitan validación de producto e implementación.

Cada herramienta debe cubrir: acción feliz, cancelación, undo/redo, recuperación, permisos/organización, fuente o documento obsoleto, límites, teclado, errores seguros y salida exportada. Los planes de cortes requieren precondiciones/versionado; el servidor debe validar el lote aunque el usuario haya aceptado una propuesta.

Métricas útiles: tiempo para corregir slide/caption, pasos manuales eliminados, pausas propuestas aceptadas/rechazadas, errores de sincronía, latencia de navegación y necesidad de recurrir a otro editor. No fijar ROI o umbrales de rendimiento sin baseline.

### Cobertura que aún no se declara

No se ha hecho una evaluación exhaustiva de todos los repositorios ni de todas las herramientas del mercado. No se investigó a fondo STT/denoise/tracking como servicios; son áreas diferentes de observar la interacción de una herramienta. No se probó equivalencia de comportamiento web/desktop. Para cualquier duda concreta se ampliará el referente que la resuelva, en vez de descargar proyectos sin una pregunta definida.

## 9. Conclusión

El resultado de rehacer la investigación no es una lista de librerías: es **un catálogo funcional con comportamiento esperado y contratos propios por definir**. La utilidad se decide por las tareas educativas de Courseforge; los repositorios se mantienen como referencias de consulta, sin integración, extracción o copia de código.
