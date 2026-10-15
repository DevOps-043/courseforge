# Herramientas del editor: análisis de repositorios y ruta de incorporación

> Orientación sustituida, 2026-10-03: se conserva la evidencia de lectura, pero no se buscará incorporar librerías o extraer módulos. La [investigación funcional](SOFLIA_EDITOR_FUNCTIONAL_TOOLS_RESEARCH.md) define herramientas por comportamiento y diseño propio, conforme a la aclaración del usuario.

Fecha: 2026-10-03. Investigación independiente del seguimiento anterior. No se modifican estados de capacidades.

## 1. Alcance y procedencia

El proyecto ahora permite leer los repositorios como workspaces hermanos de Courseforge. Se verificaron sus commits y se inspeccionaron módulos adicionales, sin instalar dependencias ni ejecutar código externo. No se inició una integración productiva ni se reemplazó el motor existente.

| Workspace actual | Commit verificado | Uso |
|---|---|---|
| `D:\Pulse Hub\grapesjs` | `7fe07c839c37cf724346a7b5948551570e61680b` | Autoría HTML y propiedades |
| `D:\Pulse Hub\moveable` | `75069102f30c88cd89ecaaa8ca7e5f7434e54807` | Gestos y máscaras visuales |
| `D:\Pulse Hub\opencut-classic` | `cf5e79e919144200294fb9fed22a222592a0aeea` | Herramientas audiovisuales y restricciones temporales |
| `D:\Pulse Hub\twick` | `3044c23e282b87c639c3f0b3fd5fb3fd972aa04c` | Referencia conceptual; sin adopción por licencia |
| `D:\Pulse Hub\wavesurfer.js` | `69974d0265f1bfd489cbb7ed5dd0efc829bfb240` | Regiones, envolventes y grabación de voz |

Son los mismos commits del [manifiesto previo](editor-tools-reference-manifest.json). Ese manifiesto registra la ubicación de descarga original; la tabla anterior identifica los workspaces actuales. No se movieron ni borraron clones durante esta revisión. Los cinco repositorios externos estaban limpios al consultar su estado; Courseforge conserva cambios previos ajenos a esta investigación.

Se leyeron las instrucciones raíz de OpenCut Classic y WaveSurfer. Las instrucciones de OpenCut anuncian una migración a Rust, pero el snapshot conserva lógica TypeScript: las aspiraciones de arquitectura no acreditan una migración terminada. No se modifican esos repositorios ni se ejecutan sus pruebas.

Este análisis amplía el [estudio inicial](SOFLIA_EDITOR_OPEN_SOURCE_TOOLING_STUDY.md), no pretende auditar todos los archivos. «Fuente inspeccionada» y «herramienta integrada» son estados distintos.

## 2. Descubrimientos adicionales y sus límites

### OpenCut Classic

**Máscara rectangular.** `apps/web/src/masks/builtin/definitions/rectangle.ts` separa parámetros, construcción por defecto, interacción y render de una máscara. La geometría construye un `Path2D`; el borde puede tener una geometría propia. Es una referencia útil para registrar herramientas parametrizadas, pero su renderer Canvas no es intercambiable con la representación de Courseforge.

Aplicación propuesta: primero nuestras primitivas de anotación —rectángulo, elipse, flecha— y luego máscaras geométricas. Cada tipo declara campos y límites. Una máscara que recorta contenido y una anotación que lo señala son herramientas diferentes, aunque compartan geometría.

**Segmentación de captions.** `apps/web/src/transcription/caption.ts` divide texto por cantidad de palabras y estima la duración desde la duración del segmento. `caption-defaults.ts` declara tres palabras por chunk y mínimo 0.8 segundos. Estos son defaults del referente, no constantes a copiar a Courseforge.

Límite concreto: esta ruta no utiliza timestamps reales de cada palabra. El mínimo de duración y el desplazamiento mediante `globalEndTime` pueden llevar los chunks fuera del intervalo original. También requiere revisar segmentos de duración cero y argumentos de chunk inválidos. Por tanto, sirve para estudiar agrupación visual, **no como alineador fiable para eliminar frases del video**.

**Thumbnail.** `apps/web/src/media/thumbnail.ts` limita dimensiones, dibuja un canvas y devuelve un JPEG como data URL. No extrae por sí solo frames de video ni proporciona un servicio de sprites, caché por fuente, cola o cancelación. Conviene distinguir miniatura de un elemento, tira temporal de frames y proxy de reproducción.

Decisión: reutilizar patrones conceptuales; una eventual copia/adaptación MIT requiere avisos, revisión del archivo/dependencias y tests propios. No se copió código en esta entrega.

### Moveable

`packages/react-moveable/src/ables/Clippable.tsx` ofrece interacción de clip-paths, eventos de inicio/cambio/final y geometrías como inset, polygon y ellipse. Sus eventos incluyen una cadena CSS de clip-path.

Aplicación propuesta: usar la interacción solo detrás de un adaptador. La cadena CSS producida por la UI **no entra directamente al documento**. El adaptador genera un objeto tipado de geometría normalizada; una operación lo valida y el compilador crea la representación visual.

V1 recomendada: rectángulo/elipse, dimensiones y radios limitados, sin CSS libre ni polígonos arbitrarios. Mantener zoom del editor y transformación del elemento como espacios distintos. Cancelación de gesto restaura baseline; confirmación genera una sola operación undoable.

Compatibilidad React 19, comportamiento dentro de iframe, accesibilidad y versión de paquete adoptable siguen pendientes. El commit de 2023 no debe tratarse automáticamente como la mejor release actual.

### WaveSurfer

**Envolvente.** `src/plugins/envelope.ts` representa puntos de tiempo/volumen y emite cambios. Su actualización interpola linealmente y escribe volumen en el reproductor de WaveSurfer. Cuando faltan extremos sintetiza puntos de volumen cero; además redondea a dos decimales.

Esto tiene consecuencias: montar el plugin sin controlar su reproducción no equivale a añadir una envolvente a nuestra mezcla. Puede introducir otra política de fades y otro reloj. No basta con dibujar puntos: preview y export deben evaluar la misma función de ganancia en el tiempo.

Contrato propio recomendado: puntos ordenados, cantidad acotada, valores finitos, tiempo local del clip, ganancia limitada y extremos definidos explícitamente. Decidir la composición con gain, fades, ducking y mute; el punto de partida puede ser multiplicativo, pero debe documentarse y probarse. No adoptar silenciamiento implícito en extremos ni redondeo de reproducción solo porque el plugin lo hace.

**Grabación de voz.** `src/plugins/record.ts` utiliza `getUserMedia` y `MediaRecorder`, selección de MIME y liberación del stream. Se inspeccionó la protección frente a un permiso de micrófono que se resuelve después del teardown: el stream recién concedido se detiene. También observa la desconexión del dispositivo.

Aplicación propuesta: grabación de narración opcional, con preescucha y adopción explícita del asset. No confundirla con captura de pantalla/cámara: la ruta inspeccionada pide audio. Elegir entre una captura propia pequeña y usar el plugin; WaveSurfer no tiene que convertirse en dependencia obligatoria de captura.

La arquitectura de `Scope` y su disposición de recursos es una referencia relevante para evitar streams, listeners o timers que sobrevivan al panel. Se debe comprobar por ejecución, no dar por libre de fugas solo por leer el código.

### GrapesJS

`packages/core/src/dom_components/model/Component.ts` declara restricciones de edición/drag/drop/style y también campos de script y exportación de script. Las primeras controlan UX; **no son autorización ni sandbox**. Un componente no editable en UI aún necesita validación de mutaciones en servidor.

Aplicación propuesta: un manifiesto propio selecciona qué campos se exponen —texto, imagen autorizada y tema— y un inspector puede inspirarse en Traits. No importar `script`, `script-export`, HTML libre o todos los atributos del componente. Mantener el JSON de Courseforge como estado persistente, sin un proyecto GrapesJS paralelo autoritativo.

### Twick

Se inspeccionaron `packages/timeline/src/utils/chapter-export.ts` y `caption-geometry.ts` como contraste de tareas. El primero ordena metadata de capítulos y produce texto/JSON; eso no demuestra un editor completo de marcadores. El segundo centraliza geometría de captions, sin probar idéntica medición de fuentes en todas las superficies.

Podemos definir por nuestra cuenta capítulos pedagógicos y geometría compartida, sin copiar esos archivos. La discrepancia entre restricciones SaaS de `LICENSE.md` y ejemplos del README permanece: no adoptar implementación ni instalar paquetes Twick en el producto sin aclaración comercial/jurídica.

## 3. Decisiones de incorporación

| Herramienta propia | Base de estudio | Estrategia | Dependencia nueva necesaria hoy |
|---|---|---|---|
| Inspector de elementos HTML | GrapesJS Traits/Component | Implementación propia de manifiesto y overrides; comparar adapter después | No |
| Flechas/resaltados/callouts | Patrón de registro y geometría de OpenCut | Primitivas propias con esquema limitado | No demostrada |
| Máscara rectangular/elíptica | OpenCut y Moveable Clippable | Modelo propio; adapter de gesto opcional | Moveable solo si aporta mejora comprobada |
| Regiones de narración | WaveSurfer Regions | Adapter sobre peaks y transporte existentes | WaveSurfer opcional |
| Envolvente de volumen | WaveSurfer Envelope | Evaluador propio compartido; UI de puntos intercambiable | No para el dominio; UI por evaluar |
| Grabar narración | WaveSurfer Record y APIs navegador | Servicio de captura separado, consentimiento y liberación de recursos | No demostrada |
| Marcadores/capítulos | Contraste conceptual Twick | Metadata propia con semántica ante cortes | No; sin código Twick |
| Dividir/unir captions | OpenCut y contratos actuales | Algoritmo propio sobre tiempos validados | No; evitar estimaciones como timestamps reales |
| Tira de thumbnails | Utilidad de thumbnail de OpenCut | Pipeline propio de extracción/cache/cola | No decidido; utilidad insuficiente por sí sola |

No reutilizar herramientas ya cubiertas por Courseforge sin comparar primero su límite actual. Nuestro esquema tiene gain/fades pero no acredita una envolvente general; la UI de captions ya permite corregir cues. La investigación propone extensiones, no la reconstrucción de esas bases.

## 4. Primer bloque implementable recomendado

**Autoría educativa: inspector HTML + elementos de señalización.** Es el bloque con mayor conexión directa a los materiales que Courseforge ya produce. El audio avanzado puede estudiarse aparte sin bloquearlo.

Orden de implementación:

1. Definir manifiesto de elementos editables con identidad/versionado y lista cerrada de propiedades.
2. Definir primitivas didácticas y sus operaciones; separar propiedades de presentación de semántica temporal.
3. Resolver selección y geometría mediante el puente existente, manteniendo aislamiento del contenido.
4. Crear inspector y toolbar contextual propios, con límites visibles y una operación por gesto.
5. Conectar las representaciones persistidas a preview/render existentes sin introducir un motor paralelo.
6. Habilitar solo tras validar seguridad, undo/recuperación y salida exportada.

Para HTML no instrumentado: declarar «no editable por elemento» y mantenerlo como recurso opaco. No asumir que toda presentación externa o imagen rasterizada contiene nodos de texto editables.

Para anotaciones: definir si se anclan al canvas o a un clip. Cortar/mover el clip debe tener efecto predecible en tiempo y geometría de la anotación. Para oclusión de datos: una cobertura en export no anonimiza el original almacenado.

Esta entrega deja una especificación de adopción; no crea todavía los contratos de producto ni instala paquetes. El siguiente cambio de código debe ser un bloque acotado, no incorporar cinco monorepos.

## 5. Validación y límites

- Verificados: workspaces accesibles, commits coincidentes con snapshots previos y módulos descritos presentes.
- No ejecutados: demos, builds, pruebas externas, pruebas de compatibilidad ni benchmarks. No QA formal.
- Antes de dependencia nueva: licencia transitiva, avisos, versión congelada, scripts de instalación, SBOM y análisis de vulnerabilidades.
- Antes de autoría HTML: autorización por organización/componente, validación de mensajes y rechazo de nodos/versiones ajenos, URLs no autorizadas y payloads XSS.
- Antes de máscaras/anotaciones: comparación geométrica en diferentes tamaños/FPS, locks, undo, cancelación y persistencia.
- Antes de captions: timestamps reales, segmentos vacíos/cero, textos largos, fuente efectiva y estabilidad después de trim/split.
- Antes de envolventes: bordes explícitos, offsets/rates, combinación de ganancias, clipping y comparación de audio exportado.
- Antes de captura: permiso denegado, permiso tardío tras desmontaje, dispositivo desconectado, duración/tamaño máximos, cancelación y stream liberado.

Regla de cierre: una biblioteca disponible no es una herramienta añadida. Registrar por separado **estudiada**, **diseñada**, **implementada**, **habilitada** y **validada**. Esta ronda completa el estudio focalizado descrito; la incorporación sigue pendiente.
