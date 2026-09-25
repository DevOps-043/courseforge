# Standalone: assets libres, profundidad y video vertical

Fecha: 2026-09-25. Estado: primera implementación funcional; pendiente QA integrado con Storage y render remoto.
Fuente de criterios: `docs/prompt_maestro.md`. Evidencia: código del checkout local.

## 1. Entendimiento del objetivo

Eliminar la clasificación obligatoria por uso (avatar, B-roll, voz, diapositivas) en el editor independiente. Importar medios según su naturaleza técnica, colocarlos en capas renombrables dentro del límite de profundidad existente y producir composiciones verticales 9:16. Mantener compatibilidad con cursos y proyectos históricos.

Aclaración del usuario: diez es el límite de profundidad, no un conjunto fijo de diez pistas. Una misma profundidad puede tener varias filas de timeline por formato y por solapamiento. Se conserva el contrato existente 0..10; no se modifica ni se colapsa su orden visual.

## 2. Diagnóstico técnico

| Evidencia local | Hallazgo e implicación |
| --- | --- |
| `apps/web/src/domains/production/standalone/StandaloneAssemblyStudio.tsx` | Reutiliza `ProductionAssetCard`, `MaterialAssets` y `saveMaterialAssetsAction`. La dependencia de categorías comienza antes de abrir el editor. |
| `apps/web/src/domains/production/standalone/standalone-assembly-readiness.ts` | Exige una fuente de duración: voz, avatar, B-roll o deck listo. Solo imágenes o música no habilitan el editor. |
| `apps/web/src/domains/production/standalone/standalone-assembly.actions.ts` | Crea registros de respaldo en artifacts, materials, material_lessons y material_components. Conviene conservar este enlace inicialmente para reutilizar autorización y render. |
| `apps/web/src/domains/production/composition-editor/composition-track-registry.ts` | Clasifica audios genéricos como MUSIC. La normalización reasigna clips a pistas canónicas y reconstruye sus labels. Cambiar solo etiquetas en UI no preservaría nombres personalizados. |
| `apps/web/src/domains/production/composition-editor/composition-layer-depth.ts` | Rango actual 0..10: once valores de profundidad, no diez capas persistidas. |
| `apps/web/src/domains/production/composition-editor/composition-timeline-layout.service.ts` | Agrupa por pista y profundidad; separa pistas de audio y crea subfilas para solapamientos. La misma proyección alimenta índices del compilador. |
| `apps/web/src/domains/production/composition-editor/composition-document.types.ts` | Distingue tipo de clip, pista y rol. Canvas admite ancho/alto variables. HTML usa DECK_SLIDE y estilos de deck compartidos. |
| `apps/web/src/domains/production/composition-editor/editor-patch.types.ts` | `track.update` cambia bloqueo, visibilidad, mute y volumen; no nombre. Existe operación de duración, pero no de dimensiones de canvas. |
| `apps/web/src/domains/production/composition-editor/composition-document.factory.ts` | Dimensiones iniciales derivadas del deck o 1920×1080; exige clips y aplica reglas de fuentes de producción. |
| `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx` | `submitAssemblyRender` envía `aspectRatio: "16:9"` fijo. |
| `apps/web/src/app/api/production/hyperframes/renders/route.ts` y `hyperframes-cloud.client.ts` | El contrato local ya admite 9:16, 16:9 y 1:1. Esto no acredita por sí solo un render vertical completo. |
| `CompositionPreviewViewport.tsx`, `CompositionComparisonPane.tsx` | La relación visual se calcula a partir de ancho/alto: base reutilizable para vertical. |
| `apps/web/src/domains/production/hyperframes/hyperframes-media-constraints.ts` | Allowlist actual: PNG/JPG, MP4/WebM, MP3/WAV. Admite 1080×1920 dentro del límite de 1920 px en el lado mayor. HTML requiere ruta de importación propia. |

Los roles también intervienen en layout por defecto, audio, ducking, vinculación avatar/voz, presets y prompts del agente. Eliminarlos globalmente causaría regresiones. El standalone necesita comportamiento genérico explícito y un adaptador de compatibilidad para fuentes antiguas.

## 3. Plan de implementación

1. Introducir contrato versionado para edición libre y conversor de documentos históricos, con fixtures antes de cambiar UI.
2. Implementar catálogo e importación genérica sin pasar nuevos uploads por propiedades como `avatar_clips` o `b_roll_clips`.
3. Conectar pistas por formato, conservando profundidad y subfilas, con renombrado y guardado versionado.
4. Añadir dimensiones del proyecto y cambio de formato con política explícita de reencuadre.
5. Integrar snapshot y render, verificar salida real y habilitar gradualmente el modo standalone.

Reutilizar servicios de persistencia, autorización, revisión y render. Separar casos de uso nuevos en módulos pequeños; evitar ampliar el componente `NativeCompositionPreview` con lógica de importación o migración.

## 4. Implementación propuesta

### Catálogo e importación

- Asset: identificador estable, organización/proyecto, nombre original y editable, tipo técnico IMAGE/VIDEO/AUDIO/HTML, MIME detectado, extensión, dimensiones, duración cuando exista, presencia de audio, checksum, ubicación privada y estado de validación.
- Clip: referencia al asset, capa, tiempos, recorte, transformaciones, ajuste CONTAIN/COVER y volumen explícito. Una carga no crea obligatoriamente un clip.
- Reutilizar `production_assets` como registro de archivos, cuyos campos existentes incluyen MIME, tamaño, checksum, Storage y metadatos. Formalizar el vínculo al proyecto y campos técnicos mediante migración aditiva, tras revisar sus consumidores y RLS; no crear un segundo catálogo autoritativo en `MaterialAssets`.
- UI única con selección múltiple, progreso/error individual, miniaturas y filtros técnicos opcionales. Sin pedir si el archivo es avatar o B-roll.
- Conservar inicialmente los formatos soportados por el motor. Ampliar otros formatos mediante detección y conversión verificadas, sin prometer que cualquier contenedor/códec es reproducible.
- Duración configurable para imágenes/HTML; duración real detectada para video/audio. Sustituir readiness semántico por disponibilidad de medios válidos y duración editable. Admitir proyecto de solo imágenes o audio.

Carga: autorizar proyecto → reservar asset/ruta → subir directamente a Storage → verificar archivo en servidor/worker → marcar listo. Validar tamaño real, MIME/contenido, códecs y metadatos; no confiar solo en el nombre o MIME enviado por navegador. Reutilizar cargas firmadas y bucket privado existentes. Hacer la finalización idempotente y limpiar cargas abandonadas con retención definida.

### Profundidad y filas de timeline

Se conserva `layout.zIndex` y su límite vigente. Los nuevos archivos usan pistas técnicas `media-png`, `media-mp4`, etc., con nombres editables y sin roles semánticos que alteren audio o encuadre. La normalización conserva sus IDs y nombres. Las filas por formato y solapamiento pueden compartir profundidad y no cuentan como nuevas capas.

`track.update` admite nombres de hasta 120 caracteres; conserva historial, control de concurrencia, volumen y bloqueo. El renombrado opera sobre la pista: sus apariciones en distintas profundidades muestran el mismo nombre. Los cursos y assets históricos mantienen sus roles y comportamiento.

### HTML

Un archivo HTML no equivale a una imagen. Definir contrato de importación para extraer diapositivas, recursos y tamaño de origen; mantener CSS aislado por asset para poder mezclar decks sin colisiones. El contrato actual de estilos compartidos necesita adaptación.

Procesar HTML no confiable con sanitización, aislamiento y restricciones de recursos externos. No ejecutar JavaScript arbitrario subido dentro del origen de la aplicación. Las animaciones admitidas necesitan conversión a un runtime controlado y reproducible. Informar incompatibilidades antes de insertar; no eliminar silenciosamente contenido. Este es un requisito de la nueva capacidad, no una vulnerabilidad demostrada del importador actual.

### Vertical

- Presets iniciales: horizontal 1920×1080 y vertical 1080×1920; dimensiones persistidas como fuente de verdad.
- Nueva operación de canvas que aplique reencuadre de forma atómica. Mantener proporciones; permitir encajar, rellenar/recortar y ajuste manual. No estirar diapositivas horizontales.
- Derivar aspecto del snapshot aprobado al enviar el render; validar concordancia en servidor. Cambiar el formato invalida el snapshot anterior.
- Verificar dimensiones en compilación, render remoto/local, recuperación de jobs y metadatos del archivo final. Hay otro builder con 1920×1080 fijo (`hyperframes-project-builder.service.ts`): trazar su participación y parametrizarlo si alcanza este flujo.
- Ajustar panel de entrega para mostrar dimensiones reales. Añadir guías visuales opcionales para zonas de interfaz, sin incorporarlas al video exportado.

## 5. Riesgos y validaciones

| Prueba requerida | Riesgo cubierto |
| --- | --- |
| Cargar PNG, JPG, MP4, WebM, MP3, WAV y HTML admitido sin categoría | Persistencia y clasificación técnica correctas |
| Proyecto de solo imágenes; duración manual; reapertura | Bloqueo heredado de readiness |
| Capa con PNG, video y audio; renombrar, mover, undo/redo, recargar | Pérdida de identidad o reaparición de categorías |
| Comparar preview y render histórico antes/después de conversión | Cambios de volumen, crop, profundidad, tiempos o presets |
| Superposición, transición y audio de video en diez capas | Colisiones de índices internos y desincronización |
| HTML con estilos repetidos, scripts y recursos externos | Colisiones CSS y ejecución/acceso no autorizado |
| MIME falso, archivo corrupto, acceso entre organizaciones y URL vencida | Abuso de carga y aislamiento de datos |
| Render real 1080×1920 y 1920×1080 con medios mixtos | Preview correcto pero exportación incorrecta |
| Carga/reintento concurrente y actualización con revisión obsoleta | Duplicados y pérdida de cambios |

Suites existentes útiles: `test:hyperframes`, `test:hyperframes-media`, `test:composition-preview-sync` y `test:security-boundaries` de `apps/web/package.json`. Añadir casos específicos a servicios de documento, timeline, patches, compilador y render. La aceptación requiere inspección visual y metadatos del video, no solo tests unitarios.

Validación realizada en esta revisión: inspección estática de código, contratos y migraciones locales. No se ejecutaron suites ni renders, ni se consultó la BD desplegada; no se certifica todavía compatibilidad vertical extremo a extremo. La revisión inicial fue documental; el estado de implementación actualizado se describe al final.

## 6. Mejoras adicionales recomendadas

Obligatorio en esta entrega futura: importación idempotente, validación server-side, límites por archivo/proyecto, concurrencia acotada y errores correlacionados por asset/proyecto/job sin URLs firmadas ni secretos en logs.

Deseable después: proxies para medios pesados, conversión asíncrona de formatos adicionales y guías configurables para videos sociales. Evitar cargar todos los archivos en memoria; paginar catálogo y generar miniaturas en segundo plano. La capacidad a gran escala requiere medición y cuotas de render, no se puede deducir del número de capas.

## Estado de la primera implementación

- Pantalla standalone con carga múltiple única de PNG/JPG, MP4/WebM, MP3/WAV y HTML; errores por archivo.
- Archivos genéricos privados registrados en `production_assets`, con checksum y metadatos detectados en servidor. Verificación de pertenencia al proyecto y organización; reintento de registro idempotente. La continuación añade una migración de tipos MIME del bucket privado; no cambia tablas de negocio.
- Medios genéricos agrupados por formato, volumen neutro y encaje CONTAIN. Se pueden abrir proyectos de solo imágenes/audio.
- Pistas renombrables; se conserva el límite de profundidad y el packing de subfilas.
- Selector 16:9, 9:16 y 1:1. Conserva geometría y animaciones: el usuario ajusta manualmente el encuadre. No implementa reencuadre automático.
- Aspecto persistido en snapshot y comprobado al solicitar render. El HTML conserva sus dimensiones de origen al cambiar canvas.

Límites explícitos: se reutiliza el importador HTML existente, con un deck de varias diapositivas por proyecto. La UI rechaza un segundo deck para evitar reemplazos silenciosos; la biblioteca de múltiples documentos HTML aislados queda pendiente. HTML conserva el tratamiento de Storage del importador existente; los nuevos archivos multimedia sí usan bucket privado. No se implementó borrado/archivo desde la nueva biblioteca, conversión de códecs ni limpieza automática de cargas fallidas. El registro limita archivos a 100 MiB (50 MiB para imagen/audio por política compartida) y trabaja secuencialmente en cliente; el procesamiento en servidor mantiene el archivo en memoria y requerirá cola/cuotas para alta concurrencia.

Validación automatizada: TypeScript sin errores y 148 pruebas aprobadas de factory, patches, compilador, distribución de timeline, política de preview y nuevos casos standalone. La aceptación final en entorno integrado debe incluir carga real, reapertura, nombres, encuadre vertical, audio y archivo exportado 1080×1920.


## Continuación: biblioteca de múltiples HTML

La biblioteca registra cada HTML como `SOURCE_MEDIA` privado con MIME `text/html` y contenido preparado en `content.deck`. El borrador nativo combina esas fuentes con el deck heredado cuando existe. Cada clip conserva el UUID del archivo y el índice original de su diapositiva: añadir otro archivo no reasigna ediciones ni exclusiones por posición. Los HTML nuevos usan la pista de formato `HTML`, sin rol de avatar o diapositivas heredadas.

El importador reutiliza la preparación determinista existente y añade sanitización estructural mediante dependencias ya instaladas. Aísla selectores, nombres de animaciones, identificadores y referencias SVG por archivo. Elimina navegación, scripts, eventos y SVG ejecutable; admite imágenes raster incrustadas y las fuentes Google autorizadas. Rechaza recursos CSS externos y construcciones que no puede validar. El contrato sigue siendo HTML de diapositivas `section.slide`, no una página web arbitraria con JavaScript. El tamaño de origen del importador permanece en 1920×1080; cambiar a canvas vertical conserva proporciones y requiere ajustar el encuadre.

### Despliegue y reversibilidad

Aplicar `supabase/migrations/20260925120000_allow_standalone_source_formats.sql` antes de habilitar la nueva carga. Amplía la lista MIME del bucket `production-render-sources` con PNG, JPG y HTML y conserva su privacidad. No se ejecutó contra una base desplegada durante esta implementación. Para revertir el despliegue, deshabilitar primero la carga nueva; conservar objetos y registros mientras haya borradores o snapshots que los utilicen. No retirar tipos MIME ni eliminar objetos existentes como parte de un rollback de código.

### Validación y límites pendientes

Se validan automáticamente identificación por contenido, agrupación por formato, nombres persistentes, profundidad compartida, canvas vertical, múltiples HTML con CSS/SVG coincidentes, sanitización, conservación de geometría/tiempos y exclusiones estables. Se ejecutan también las regresiones de factory, patches, compilador, timeline, política de preview, fuentes, borradores y envío a render.

La aceptación integrada sigue requiriendo cargar archivos contra Storage real, reabrir el borrador, comprobar undo/redo y escuchar/exportar un MP4 de 1080×1920. No se ha certificado ese recorrido remoto. El registro comprueba los límites HTML acumulados, pero no serializa cargas entre pestañas; cuotas transaccionales por proyecto, limpieza de cargas fallidas y procesamiento por cola siguen pendientes antes de habilitar alta concurrencia. La retirada de archivos de la biblioteca también queda pendiente: debe conservar referencias de borradores y snapshots y no eliminar físicamente archivos todavía utilizados. La edición existente permite retirar clips del timeline.

Resultado final de esta continuación: TypeScript del frontend completo y compilación de pruebas sin errores; 181 pruebas aprobadas, cero fallos. La prueba adicional confirma que un deck heredado añadido después no reemplaza clips HTML independientes.


## Ajuste de flujo: biblioteca e inserción manual (standalone)

Cargar un archivo registra una fuente en la biblioteca y no equivale a insertarla en el timeline. La identificación del proyecto standalone se comprueba en servidor contra `standalone_assembly_projects` y se persiste en el documento como `sourceInsertionMode: MANUAL`. Los documentos del flujo de cursos mantienen su comportamiento automático.

- Un borrador standalone nuevo empieza sin clips, aunque tenga archivos preparados. La biblioteca ofrece «Añadir a timeline» para imagen, video, audio y cada diapositiva HTML.
- La sincronización actualiza fuentes y estilos sin insertar clips ni extender la duración por archivos que el usuario no eligió.
- Añadir un medio conserva su duración y amplía el lienzo temporal cuando hace falta. Se coloca a partir del cursor o después del último clip de su pista.
- Los borradores existentes conservan sus clips y ediciones al adoptar la selección manual. No se vacían composiciones existentes.
- Se puede quitar el último clip y seguir editando. Un documento vacío es válido para editar y se rechaza explícitamente al preparar una exportación.
- La inserción HTML compara la fuente recibida con las diapositivas preparadas del proyecto autorizado; el cliente no puede introducir HTML arbitrario mediante esa inserción.
- Restaurar versiones conserva la política de inserción del borrador actual.

La pantalla previa de carga sigue disponible; su eliminación y la carga dentro del editor no forman parte de este ajuste. El cambio resuelve la selección progresiva desde la biblioteca del editor.

Validación de esta iteración: 184 pruebas aprobadas (regresiones del editor, fuentes y render, más inicio vacío, sincronización sin inserción, eliminación/reinserción y rechazo de fuentes HTML alteradas). Pendiente la comprobación visual con un proyecto autenticado y Storage desplegado. No requiere una nueva migración de tablas: la política se guarda en el documento JSON versionado.
