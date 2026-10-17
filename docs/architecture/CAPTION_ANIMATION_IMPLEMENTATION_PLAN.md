# Plan de implementación: animaciones y énfasis de captions

Fecha: 2026-10-15. Estado: plan base; seguimiento de implementación en el documento de entrega.

Seguimiento: la implementación local y sus validaciones se describen en [CAPTION_ANIMATION_DELIVERY.md](CAPTION_ANIMATION_DELIVERY.md). Este documento conserva el alcance y las decisiones del plan original.

## 1. Objetivo y restricciones

Permitir que el editor anime cada frase de una capa de captions y resalte palabras seleccionadas o la palabra pronunciada. Conservar edición no destructiva, recortes, guardado versionado, deshacer/rehacer y paridad entre preview y exportación.

- Reutilizar GSAP, el renderer nativo y el flujo actual HyperFrames/HeyGen.
- No incorporar Cloud Run, servicios de transcripción, APIs ni dependencias nuevas para esta funcionalidad.
- No modificar producción de voz, diapositivas, autenticación ni almacenamiento de medios salvo contratos compartidos indispensables y justificados.
- Mantener el comportamiento visual de documentos existentes sin configuración nueva.
- Las cajas de texto conservan su animación de capa existente. El primer alcance nuevo se centra en captions; la selección de fragmentos dentro de cajas de texto queda fuera.
- La sincronización por palabra requiere timestamps existentes. No se inventará precisión temporal para texto manual ni SRT/VTT.
- Este plan no presupone que los cambios anteriores estén publicados: se encuentran en el árbol de trabajo junto con cambios ajenos que deben preservarse.

## 2. Dónde estamos

| Capacidad | Estado observado en código | Limitación |
| --- | --- | --- |
| Texto/captions nativos | Documento V3 con contenido, estilo y timing | Nuevas propiedades requieren extender esquemas estrictos y consumidores |
| Captions manuales | Creación y edición en inspector | Sin sincronización por palabra automática |
| SRT/VTT | Importación local validada | Tiempos por frase; no genera timestamps por palabra |
| Generación desde voz | Botón «Generar desde la voz» conectado al servicio | Requiere narración vigente y timestamps; rechaza captions manuales/importados y varias capas generadas |
| HeyGen | Lee URLs de subtítulos y video con captions | No se encontró importación automática de esas URLs a capas editables |
| Animación de capa | Controles existentes para TEXT y CAPTION; feature flag | Afecta CONTENT completo del clip |
| Karaoke | Opacidad por palabra programada en GSAP | Valores fijos y sin controles de efecto por palabra |
| División/eliminación de intervalos | Cambios locales de la tarea anterior con pruebas | Debe extenderse la conservación de nuevos metadatos |
| Exportación | Snapshot del documento y envío al proveedor actual | No representa exportación completamente local; conserva proveedor existente |

Fuentes principales: `composition-text-layer.types.ts`, `composition-transcript-caption.service.ts`, `composition-native-overlay-renderer.service.ts`, `composition-preview-compiler.service.ts`, `composition-motion.types.ts`, `CompositionInspector.tsx`, `CompositionStudioLibrary.tsx` y `hyperframes-render-submission.service.ts`.

## 3. Destino de la primera entrega

### Incluido

1. Animación de entrada por frase: Ninguna, Fade, Desplazamiento vertical suave y Pop.
2. Salida por frase: Ninguna y Fade.
3. Duración e intensidad acotadas, con valores predeterminados centralizados.
4. Configuración común de capa y override opcional por frase; restablecer frase permite heredar de nuevo.
5. Karaoke configurable: modo heredado actual, desactivado, opacidad y color de palabra activa.
6. Énfasis estático de palabras o secuencias de palabras seleccionadas: color y fondo. Puede combinarse con karaoke bajo reglas explícitas.
7. Pulso suave opcional de palabra activa únicamente con timestamps válidos. Será el último incremento funcional, después de validar el resaltado.
8. Estado informativo cuando no hay timestamps o cuando requieren revisión.
9. Guardar/recargar, deshacer/rehacer y cortes conservan configuración válida.

### Fuera de esta entrega

- Transcribir videos arbitrarios o alinear automáticamente texto editado con audio.
- Eliminar o separar subtítulos incrustados en los píxeles de un video.
- Importar automáticamente URLs remotas de subtítulos de HeyGen.
- Editor libre de keyframes por palabra, animación por carácter y selección enriquecida dentro de cajas TEXT.
- Incorporar Lottie, Three.js, servicios externos de animación o infraestructura de render nueva.
- Modificar las animaciones internas de las diapositivas.

## 4. Diseño propuesto

### Contrato y persistencia

Agregar configuración opcional versionada de efectos a la fuente NATIVE_CAPTIONS y overrides por cue. Nombres exactos a definir al implementar, manteniendo separados estilo tipográfico, tiempos y efectos. Ausencia de configuración significa comportamiento heredado; desactivación explícita es un estado diferente.

- Esquemas Zod estrictos: presets enumerados, colores hex, números finitos, límites de duración/intensidad y referencias dentro del cue.
- Guardar presets e intención, no nodos DOM, HTML, CSS ni JavaScript proporcionados por el usuario.
- Énfasis textual: rangos sobre el texto exacto del cue, con convención de índices explícita y límites Unicode seguros; soportar palabras repetidas sin buscarlas solo por su texto. No exigir timestamps para color/fondo estáticos.
- Efectos de palabra sincronizados: referencias a IDs locales al cue y timestamps validados. No confundir índices textuales con IDs de palabras.
- No materializar cada palabra como una entrada de `motion.animations`: ese contrato tiene un máximo de 200 animaciones. Compilar los efectos especializados en un plan de runtime acotado.
- Incorporar un límite de elementos/efectos derivados además de los límites existentes de 2.000 cues y 20 palabras temporizadas por cue; fijar el presupuesto con fixtures y mediciones en la etapa de runtime.
- Reutilizar el documento persistido; no se prevé una tabla nueva. Auditar validadores SQL, snapshots, hashes y lectores antes de confirmar que no requiere migración.
- No renumerar formatos globales a ciegas: hay otros formatos de documento para edición HTML. El contrato de efectos tendrá versión propia y los lectores deberán rechazar versiones desconocidas sin borrar datos.

### Servicios y responsabilidades

| Módulo | Responsabilidad |
| --- | --- |
| `composition-caption-effects.types.ts` (nuevo) | Contratos, límites y configuración versionada |
| `composition-caption-effects.service.ts` (nuevo) | Presets, herencia, normalización y validación semántica |
| `composition-caption-effects-plan.ts` (nuevo) | Plan puro con objetivos y tiempos resueltos, compartido por runtime y expectativas QA |
| `composition-caption-effects-runtime.ts` (nuevo) | Programación determinista de operaciones GSAP |
| `CompositionCaptionEffectsControls.tsx` (nuevo) | Controles de efecto por capa/frase |
| `CompositionCaptionEmphasisControls.tsx` (nuevo) | Selección de palabras y énfasis |
| Contratos y servicio de patches existentes | Mutaciones atómicas, permisos, pistas bloqueadas e historial |
| Renderer/compilador existentes | DOM seguro, integración del plan y exportación |
| Servicio de fragmentos existente | Intersección de tiempos y conservación de metadatos |
| Contratos/QA de paridad existentes | Expectativas visuales para las nuevas propiedades |

Extraer responsabilidades de `CompositionTextControls.tsx`; evitar añadir toda la funcionalidad al componente principal o a `NativeCompositionPreview.tsx`.

### Render determinista

- Una línea temporal principal pausada y tiempos explícitos; sin temporizadores, animaciones infinitas ni cálculos aleatorios.
- Jerarquía de wrappers: contenido de capa para motion existente, wrapper de efecto por frase y spans/wrappers para palabras. La visibilidad temporal de cues permanece bajo control del compilador.
- Los efectos especializados no escriben transforms en el mismo elemento que la animación general de capa.
- Opacidad de capa, estilo, frase y palabra se componen; ninguna anula involuntariamente las otras.
- Prioridad visual: estilo base → énfasis estático → estado de palabra activa → restauración al estilo estático al terminar.
- Entradas/salidas se ajustan proporcionalmente si no caben en una frase corta. Nunca alargar el cue ni solapar entrada y salida accidentalmente.
- Usar transforms para Pop/pulso sin cambiar métricas tipográficas; preparar spans transformables y comprobar wrapping, baseline y recorte.
- Cambios nuevos de efectos recargan inicialmente el preview preservando cursor/selección. Revisar también move/trim/duration/template: reconstruir el plan o usar FULL_RELOAD si el parche en vivo actual no actualiza esos tiempos.
- La ausencia de palabras alineables conserva el texto original y desactiva el efecto temporal con estado de revisión; no sustituir texto por una transcripción diferente.

## 5. Políticas de edición y recorte

| Acción | Resultado esperado |
| --- | --- |
| Dividir dentro de una frase | Ambos fragmentos conservan texto/estilo; cues/palabras se intersectan y rebajan como hoy; cada fragmento recibe efectos derivados de su intervalo |
| Eliminar intervalo | Se conservan configuración y énfasis de partes retenidas; desaparecen referencias a palabras eliminadas |
| Fragmento sin cues | Configuración de capa válida, cero efectos visibles, sin captions inventados |
| Mover clip | Todos los efectos siguen al clip sin modificar los tiempos locales |
| Trim izquierdo | Rebajar cues/palabras y efectos al nuevo origen; auditar semántica actual del trim nativo antes de modificarla |
| Acortar final | Intersectar captions/efectos con duración final; no dejar cues fuera de límites |
| Extender duración | Conservar cues existentes; no estirar timestamps ni inventar texto |
| Editar texto | Conservar configuración de frase; invalidar tiempos por palabra y rangos de énfasis de cues cuyo texto cambió; informar y guardar atómicamente |
| Cambiar solo estilo/efectos | Conservar texto, timestamps y selección de énfasis |
| Reimportar SRT/VTT | Reemplazar cues explícitamente, conservar configuración común y retirar overrides que ya no tengan destino |
| Duplicar clip | Copia independiente; referencias de cue/palabra siguen siendo locales al nuevo clip |
| Deshacer/rehacer | Restaurar contenido, configuración y tiempos juntos |

Decisión inicial: los efectos por frase se resuelven contra el cue retenido y pueden reiniciar su entrada tras un corte. Esto debe ser explícito en QA. Preservar el progreso exacto de una entrada cortada requeriría otro contrato y queda fuera. Las animaciones generales de capa mantienen su política actual de rechazo cuando el corte atraviesa una animación.

### Regeneración desde voz

Para esta entrega no reemplazar silenciosamente varias capas fragmentadas. Mantener el rechazo protector y mejorar el mensaje: indicar que regenerar no conserva recortes y explicar el camino de reemplazo explícito. La nueva configuración no dependerá de que se resuelva una regeneración coordinada de múltiples fragmentos.

Actualizar una única capa generada requiere conservar configuración común y descartar overrides sin destino estable, comunicándolo. Un flujo futuro de reemplazo multicapas deberá tener preview de cambios y comando atómico propio. Los captions manuales/importados continúan protegidos de sobrescritura automática.

## 6. Etapas y puertas de calidad

| Etapa | Entrega | Criterio para avanzar |
| --- | --- | --- |
| 0. Línea base | Inventario de consumidores y fixtures manual/SRT/VTT/voz/fragmentos | Comportamiento actual documentado; cambios previos preservados |
| 1. Contratos | Esquemas, defaults heredados y patches de efectos | Documentos previos conservan apariencia; payloads inválidos fallan atómicamente |
| 2. Runtime por frase | Plan puro, wrappers, Fade/Slide/Pop y salida | Seek en ambos sentidos y compilación preview/export con tiempos idénticos |
| 3. Inspector | Controles por capa/cue, herencia y reset | Guardar/recargar y undo/redo completos; mensajes claros sin timestamps |
| 4. Palabras | Énfasis estático, karaoke configurable y pulso acotado | Unicode, palabras repetidas, puntuación y restauración de estilos correctos |
| 5. Edición | Integración de recortes, timing, duplicación e invalidación de referencias | Matriz de edición aprobada y sin regresiones multimedia |
| 6. Conformidad | Expectativas de apariencia/pose y capturas visuales | QA reconoce color, fondo, opacidad y transforms; no solo presencia del texto |
| 7. Entrega | Documentación, flag y validación de exportación real | Video final revisado; limitaciones y presupuesto de runtime registrados |

Complejidad global: media para efectos por frase; media–alta incluyendo edición por palabra, cortes y conformidad. El motor no es la principal incertidumbre: lo son edición de texto/timing, composición visual y validación. Evitar un compromiso de calendario antes de completar la etapa 0.

## 7. Validaciones obligatorias

### Unitarias y contratos

- Defaults heredados y desactivación explícita; herencia de configuración y reset.
- Rechazo de presets/colores/números/referencias inválidos y versiones desconocidas.
- Frases de un frame, entrada/salida mayores que el cue, límites exactos, silencios y fragmentos vacíos.
- Español con acentos, emojis, puntuación, palabras repetidas, RTL y texto CJK; índices sin romper caracteres.
- Alineación entre texto autoritativo y palabras; ausencia o caducidad de timestamps.
- Presupuesto máximo de cues, spans, efectos y operaciones.

### Integración

- Patches con autorización existente, pista bloqueada y persistencia atómica.
- Guardado versionado, restore, undo/redo, copia/duplicación y compilación de snapshot.
- Split/remove-range/trim/move/duration/template con configuración nueva.
- Regresión de video, voz, transiciones, motion general y fuentes privadas.
- Falla explícita ante contrato desconocido; ninguna eliminación silenciosa de propiedades nuevas.

### Visual y exportación

- Capturar antes/durante/después de entrada, palabra activa y salida; repetir con seek inverso.
- Comparar preview/render usando el mismo documento, fuentes y plan, con expectativas que también cubran color, fondo y transform de palabras.
- Verificar líneas largas, tamaños de fuente, pantallas verticales/horizontales y bordes del canvas.
- Exportar un fixture representativo por el proveedor actual y revisar el MP4 resultante; una compilación HTML correcta no sustituye esta prueba.
- Medir un caso normal y un caso cercano a límites: tamaño de documento/HTML, número de nodos/tweens, tiempo de compilación/inicialización y fluidez al buscar en timeline. Fijar límites con datos y hardware de referencia registrado.

Comandos existentes reutilizables desde `apps/web`: `npm run test:composition-native-fragments`, `npm run test:composition-timeline`, `npm run test:composition-transitions`, `npm run qa:composition-preview-runtime`. Agregar un comando dedicado a los nuevos efectos. Ejecutar compilación TypeScript y lint de los módulos afectados.

## 8. Seguridad, operación y compatibilidad

- Misma autenticación, aislamiento de organización y autorización de patches/snapshots. No crear endpoints públicos nuevos.
- Escapar texto y restringir propiedades; no aceptar código, selectores CSS arbitrarios ni URLs externas para efectos.
- Configuración vive en documento y snapshots versionados. El snapshot congela efectos y assets del render.
- Registrar fallos con correlation ID, versión del contrato y contadores; nunca texto de captions, transcripción ni PII en logs.
- Flag de creación/edición para rollout; lectura/render de efectos guardados debe seguir disponible con flag apagada.
- Desactivar la flag no equivale a ejecutar un binario antiguo. Rollback requiere una versión capaz de leer el nuevo contrato o restauración explícita de una revisión anterior compatible.
- No publicar capacidades nuevas hasta validar todos los consumidores estrictos de documento, contrato y conformance.

## 9. Definition of Done

1. Un usuario aplica un preset a todas las frases o a una sola desde el inspector.
2. Puede resaltar palabras específicas sin timestamps y configurar palabra activa cuando sí existen.
3. El texto y su sincronización no se alteran al cambiar un efecto.
4. Se conservan cortes y ediciones según la matriz de políticas, sin referencias huérfanas.
5. Documentos previos conservan comportamiento; documentos nuevos guardan/restauran toda la configuración.
6. Preview y MP4 exportado coinciden en los fixtures de aceptación.
7. Pruebas, lint y compilación aprobados; rendimiento documentado y limitado.
8. Sin Cloud Run, nuevas dependencias ni servicios externos adicionales.

## 10. Mejoras futuras independientes

Solo después de la primera entrega: regeneración coordinada de capas fragmentadas, importación remota segura de SRT de HeyGen, selección enriquecida en cajas TEXT y edición libre de timing por palabra. Ninguna bloquea los efectos por frase y resaltado propuestos.
