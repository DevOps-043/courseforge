# Auditoría y propuesta de autoguardado del editor

Actualización de 2026-10-30: la corrección posterior y su contrato están en
[contexto](reports/contexto-correccion-latencia.md) e
[implementación de latencia](reports/correccion-latencia-2026-10-30.md).
El análisis inicial que sigue se conserva como evidencia histórica.

Fecha: 2026-10-17. Base: 64606f73. Rama: codex/fix-heygen-preset-handoff.
Estado: auditoría inicial conservada como contexto. La implementación local y
su validación posterior se documentan en reports/implementation.md; las tablas
de estado observado describen el código anterior a esa implementación.

## 1. Contexto y límites

Actor: editor autorizado de una composición. Objetivo: editar sin confirmar
cambios uno por uno mediante Guardar y poder revertir las acciones.

Se inspeccionaron los componentes del editor de composición, sus callbacks
en NativeCompositionPreview, patches, cola, recuperación e historiales. No se
modificó producto, SQL, permisos ni medios. El panel de escenas de HeyGen y sus
correcciones anteriores son una superficie distinta: no se presume que ese
panel tenga el historial del documento de composición.

Velocidad de video, congelación y paths tienen flags y condiciones de medio.
Se incluyen como capacidades del código, sin afirmar que estén disponibles en
la sesión o despliegue del usuario. Operaciones admitidas sólo por el schema,
como clip.template, no se presentan como controles visibles confirmados.

## 2. Infraestructura actual comprobada

- NativeCompositionPreview.savePatch serializa comandos por CompositionSaveQueue.
  executeSavePatch valida localmente, usa PUT con If-Match/hash, actualiza preview
  y registra historial tras confirmar persistencia.
- Cada modificación del documento crea una versión inmutable. Restaurar una
  versión es otra edición validada; no elimina versiones posteriores.
- CompositionCommandHistory es de sesión: máximo 50 acciones y 20 MiB. Puede
  descartar entradas por presupuesto; no promete deshacer ilimitado ni conservar
  la pila al recargar. Un comando individual que excede el presupuesto limpia
  la pila. loadDocument puede reiniciarla en determinadas recargas.
- El listado del historial persistido consulta las últimas 20 versiones. Esto
  es el límite de consulta actual, no una política demostrada de borrar versiones.
- La cola admite hasta 50 comandos pendientes y cancela la cola restante cuando
  un comando falla. Su contenido pendiente no constituye un journal durable.
- El guardado tiene timeout de 30 segundos y recuperación del comando en ejecución.
  Un timeout no demuestra que el servidor no haya persistido.
- El estado visual Guardado/Guardando/Error depende de la cola y saveError; no
  considera los valores todavía locales de todos los inspectores manuales.
  Por ello puede mostrar Guardado aunque un control tenga ajustes sin enviar.
- El flag saving bloquea muchos controles durante la persistencia. Incrementar
  escrituras por tecla mantendría la fricción y puede empeorar la interacción.
- HTML dispone de comandos, revisiones y deshacer/rehacer editoriales propios.
  Su host reserva la cola nativa y valida el recibo y la adopción de revisión.
  No es seguro sustituirlo por el PUT genérico del documento.

## 3. Inventario de botones Guardar

Conteo: 13 instancias JSX en 8 archivos. Se excluye la mención instructiva
«Después usa Guardar cambios» de CompositionHtmlEditableFields. Las ramas de
CompositionInspector no se muestran todas simultáneamente.

| Archivo y línea | Botón actual | Decisión propuesta | Momento de persistencia |
| --- | --- | --- | --- |
| CompositionInspector.tsx:101 | Guardar audio, música | Eliminar | Final de gesto o edición válida de duración/volumen/fades |
| CompositionInspector.tsx:168 | Guardar audio, otros clips de audio | Eliminar | Final de gesto; valores relacionados en un comando |
| CompositionInspector.tsx:216 | Guardar layout, texto/captions | Eliminar | Campo válido al terminar; posición/tamaño coherentes |
| CompositionInspector.tsx:219 | Guardar cambios, clips visuales | Eliminar | Por propiedad o grupo relacionado, no reenviar todo el inspector |
| CompositionInspector.tsx:255 | Guardar recorte | Eliminar | Soltar deslizador, terminar edición o gesto de recorte |
| CompositionMotionControls.tsx:359 | Guardar animación | Eliminar | Selección inmediata; parámetros al terminar edición válida |
| CompositionMotionControls.tsx:523 | Guardar pose | Eliminar | Una pose/keyframe completa y válida por interacción |
| CompositionTextControls.tsx:232 | Guardar texto | Eliminar | Pausa de escritura, Enter donde proceda o pérdida de foco |
| CompositionColorCorrectionControls.tsx:130 | Guardar color | Eliminar | Preview continuo; persistencia al finalizar gesto |
| LayerDepthControls.tsx:99 | Guardar plano | Eliminar | Valor entero válido al terminar edición; flechas ya persisten |
| CompositionVolumeEnvelopeControls.tsx:256 | Guardar curva | Eliminar | Añadir/quitar punto o terminar edición de punto; validar curva completa |
| CompositionVideoRateControls.tsx:52 | Guardar velocidad | Eliminar | Selección de velocidad válida, respetando elegibilidad |
| CompositionHtmlEditableFields.tsx:49 | Guardar cambios por lote | Eliminar después de integrar | Lote válido mediante host HTML; no saltarse recibos/historia |

El guardado de texto incluye contenido, estilo, tipografía, fuente autorizada,
alineación, captions, tiempos, karaoke, efectos y énfasis por frase. Los subcontroles
de captions hoy alteran el borrador del padre y dependen de Guardar texto.

## 4. Inventario del resto de herramientas

| Familia y acciones | Estado observado | Política propuesta |
| --- | --- | --- |
| Mover/redimensionar en monitor | Mensajes de layout invocan savePatch | Mantener: un comando al terminar el gesto |
| Recortar en monitor | Mensaje de crop invoca savePatch | Unificar con inspector: misma validación e historial |
| Inicio, duración y trim en timeline | Callbacks invocan savePatch | Mantener al finalizar arrastre; nunca por frame |
| Dividir y quitar intervalo | Operaciones clip.split/remove-range | Mantener acción explícita; guardar automáticamente su resultado |
| Ripple delete, roll y slide | Construyen patches y guardan | Mantener: una interacción, un comando y undo coherente |
| Mover grupos | group.move vía savePatch | Guardado conjunto, no por cada clip |
| Duplicar, pegar, quitar clips | Funciones dedicadas que guardan | Guardar al ejecutar; quitar del timeline no borra el archivo |
| Agrupar/desagrupar | group.create/ungroup | Guardado automático por acción |
| Alinear y distribuir | Operaciones de selección | Un solo comando para la selección completa |
| Ocultar/mostrar clips | clip.visibility | Mantener guardado inmediato |
| Pistas: nombre, bloqueo, visibilidad, mute | track.update; nombre al blur/Enter | Mantener; deduplicar blur/Enter |
| Volumen maestro de pista | Commit en pointerup, keyup y blur | Mantener patrón y evitar escrituras duplicadas |
| Ducking | Toggle inmediato; nivel al terminar gesto | Mantener; agrupar futuros cambios de attack/release si se exponen |
| Mostrar completo/llenar caja | media-fit y eliminación de crop relacionados | Mantener cambio atómico |
| Animaciones: añadir/quitar preset | Patches directos de motion | Mantener; configuración y poses pasan al mismo flujo |
| Animación en timeline | animation.update-timing | Mantener final de gesto; validar colisiones y duración |
| Paths simples | Inserción/eliminación de puntos, edición de poses | Guardar una edición de punto; respetar flags y separaciones |
| Transiciones | Añadir/quitar/editar con callbacks a savePatch | Mantener; números deben esperar un valor válido, no cada tecla |
| Color: restaurar neutro/quitar corrección | Patches al invocar acción | Mantener; undo restaura la corrección previa |
| Freeze de último frame | Toggle con patch | Mantener; sólo medios elegibles y flag activo |
| Añadir texto/captions nativos | addNativeOverlay guarda | Mantener; edición posterior sin Guardar texto |
| Importar SRT/WebVTT | Parseo deja cues en borrador local | Commit automático tras validar archivo completo; reemplazo reversible en bloque |
| Captions desde voz | Plan y guardado del resultado | Acción Generar explícita; aplicar resultado guarda una vez |
| Insertar medio/SFX | Alta/vinculación seguida de clip.add | Sin segundo Guardar; undo quita instancia, no elimina el asset original |
| Sustituir fuente de un clip | clip.replace-source | Guardar la elección como acción única; conservar recurso anterior |
| Intro y cierre de producción | Flujos que reorganizan documento | Guardar resultado en bloque; undo cubre documento, no compras/importaciones |
| Separar audio del video | Crea/reutiliza asset y añade clip/silencia video | Mantener acción Separar; autoguardar montaje resultante, sin prometer deshacer el procesamiento |
| Procesar voz y usar audio procesado/original | Job separado y sustitución por selección | Mantener Procesar y elección entre resultados; sin guardado adicional del montaje |
| Recalcular duración | Patches calculados con validación | Acción explícita y autoguardado único |
| Organizar timeline/preensamble/reiniciar asset | Acciones amplias; algunas tienen confirmación | Confirmar intención cuando proceda; no añadir Guardar después; un comando reversible |
| Preset de composición | Preview separado, Aplicar/Descartar, endpoint propio | Mantener preview deliberado; Aplicar persiste sin otro Guardar |
| Propuesta del asistente | Proponer, aprobar/descartar y undo propios | Mantener aprobación del resultado; no confirmar cada propiedad ni autoadoptar sugerencias |
| Crear preset reutilizable | Crea entidad de catálogo | Mantener Crear/Guardar como: es un recurso nuevo, no guardar la composición |
| Extracción narrativa de voz/fragmentos | Consulta y confirmación explícita mediante host | Mantener acción y recibos; auditar reversión antes de integrarla al undo común |
| HTML: texto, atributos, estilo limitado, imagen, slots y gráficos | Preparar campo y luego Guardar lote | Migrar campos válidos al host automáticamente; gráficos/slots se validan atómicamente |
| HTML: inicializar/adoptar/reconstruir/vincular recursos | Flujos separados de elegibilidad y revisión | Acciones explícitas; no activarlas al escribir o cambiar selección |
| Snapshot, aprobación, render, reemplazar/borrar video previo | Entrega y efectos externos, fuera del simple patch | Mantener acciones explícitas y recuperación; no autolanzar con cada edición |
| Publicación/republicación de revisión HTML | Registro con recibo y recuperación propios | Mantener intención explícita; separar de autoguardar campos editoriales |
| Historial/restauración | Restore crea una nueva versión | Mantener Restaurar; su resultado se guarda automáticamente |
| Zoom, scroll, playhead, selección, búsqueda, paneles, comparación y preescucha | Estado de vista o consulta | No crear versiones; preferencias de editor pueden persistir localmente |

«Aplicar» sólo se conserva cuando existe una comparación o propuesta deliberada
pendiente de aceptación. No se propone renombrar Guardar a Aplicar para mantener
el mismo paso redundante. La selección ordinaria de una opción válida no debe
necesitar otra confirmación. Quitar/deshacer/restaurar son acciones, no botones
de guardado que deban desaparecer.

## 5. Qué significa reversible

1. Edición del documento: undo restaura el estado anterior mediante una nueva
   versión validada; redo vuelve a aplicar el estado siguiente.
2. Referencia a un medio: puede deshacerse su inserción/sustitución si el recurso
   anterior sigue autorizado y disponible. No implica borrar el medio subido.
3. Proceso externo: el historial no devuelve créditos, cancela trabajo ya aceptado,
   despublica por sí solo ni recupera un archivo eliminado físicamente.
4. HTML y extracción narrativa: sus historiales/recibos no son automáticamente
   intercambiables con document.restore. El servicio protege referencias HTML
   frente a restauraciones genéricas; deben respetarse esas barreras.

Por tanto, no se debe prometer «todas las acciones son reversibles gracias al
historial» hasta auditar sus efectos y su integración. El objetivo sí es que
todas las ediciones ordinarias del documento sean reversibles.

## 6. Contrato de interacción propuesto

- Click discreto: validar, producir un comando y persistir automáticamente.
- Slider/arrastre: preview local durante gesto; al soltar, guardar valor final.
  pointercancel/Escape cancelan el gesto sin introducir una versión parcial.
- Campo numérico/timecode: admitir estados de escritura incompletos localmente;
  validar y guardar al terminar (Enter, blur o pausa con valor válido).
- Texto: pausa breve configurable, blur o confirmación de campo; respetar
  composición IME y no usar Enter para guardar un salto de párrafo accidental.
- Un mismo cambio disparado por Enter y blur, o pointerup y blur, se deduplica.
- Cambios relacionados (crop completo, fades+duración, pose, curva, dataset)
  forman un único comando; no se envían estados intermedios inválidos.
- Cambiar de clip/herramienta o iniciar render debe resolver los cambios locales:
  vaciar acciones válidas a la cola, o señalar el campo inválido sin perderlo.
- Un periodo de debounce es una propuesta de UX, no un valor ya implementado.
  Debe centralizarse y ajustarse con pruebas de interacción.
- La interfaz mostrará Editando/Pendiente/Guardando/Guardado/Error/Conflicto o
  Sin confirmar, distinguiendo borrador local de persistencia confirmada.

## 7. Arquitectura recomendada

Reutilizar documento V2, patches validados, hash/If-Match, RPC de append, cola y
journal existentes. No crear un segundo documento canónico ni un autosave por
componente con efectos que compitan por escribir.

Agregar un coordinador de interacciones con identidad por documento, clip,
propiedad y gesto. Debe mantener estado local válido/pendiente, agrupar comandos,
coalescer actualizaciones del mismo gesto y entregar operaciones a una cola
compartida. Se diferencia el estado deseado local del último confirmado.

El historial se registra por intención de edición completada, no por evento de
UI ni por un efecto secundario de rerender. Undo durante un guardado pendiente
debe coordinarse con la cola; no aplicar document.restore contra una base antigua.
La política precisa de comandos pendientes se define y prueba antes de liberar
edición mientras hay guardados activos.

La cola debe preservar las acciones pendientes y sus bases antes de admitirlas.
Ante conflicto o resultado incierto se pausa el envío y se conserva el trabajo;
no se reintenta automáticamente una escritura desconocida. Para HTML se usa su
host exclusivo y seguimiento de recibos, sin endpoints paralelos desde controles.

Se sustituirán formularios de inspector que guardan todo el clip por patches de
propiedades modificadas. Sus efectos de sincronización actuales pueden resetear
otros borradores locales cuando vuelve una respuesta: deben conservar valores
dirty y descartar respuestas de un clip/gesto anterior. Es especialmente sensible
en texto, que reinicia su formulario cuando cambia source.

No basta con quitar botones ni llamar a save en cada onChange: produciría
versiones excesivas, bloqueo durante red, valores intermedios y pérdidas por
respuestas tardías. Para rendimiento, persistir una vez por acción y actualizar
el preview incrementalmente; reservar recompilación para cambios que la requieren.
No se promete carga o throughput sin medición.

## 8. Plan por fases

1. Base de seguridad de edición: contratos de interacción, journal de pendientes,
   estados de guardado, conflictos y agrupación de historial. Pruebas de red lenta.
2. Geometría y color: crop, transformaciones, plano, color y velocidad. Unificar
   inspector con los gestos del monitor/timeline que ya guardan.
3. Audio y motion: volumen/fades/curvas, parámetros/poses/paths y transiciones.
   Mantener integridad temporal y preview/render consistentes.
4. Texto/captions: contenido, tipografía, cues, efectos, énfasis e importación.
   Conservar escritura incompleta e IME sin vaciar borradores al sincronizar.
5. HTML: integrar preparaciones y validación atómica con host, recibos e historial.
   Retirar Guardar lote sólo después de cerrar esta integración.
6. Cierre transversal: navegación, render, accesibilidad, E2E y telemetría de errores,
   conflictos, latencia y cantidad de comandos por gesto, sin texto ni PII en logs.

Rollback: habilitar la UX anterior por capacidad durante migración, conservando
lectores V2 y versiones ya escritas. No eliminar datos ni reescribir historial.
Las nuevas reglas de UX se añaden a la fuente canónica al implementarlas; este
análisis no cambia el contrato vigente ni constituye despliegue.

## 9. Matriz mínima de aceptación y QA

- Arrastrar cientos de eventos genera un comando final y un deshacer.
- Slider con teclado, pointerup+blur y Enter+blur no duplica versiones.
- Número vacío temporalmente, signo menos y timecode incompleto no sobrescriben
  el último estado válido ni se guardan como cero por accidente.
- Escribir, cambiar de clip y volver conserva el texto y guarda sólo cambios válidos.
- Cambiar crop, luego color, con red lenta conserva ambos cambios y su orden.
- Fades, duración, offsets, poses y transiciones no publican estados incompatibles.
- Error del primer comando conserva todos los posteriores pendientes y los muestra.
- Timeout tras commit remoto consulta/reconcilia antes de permitir duplicación.
- 409 de otra pestaña y 403 de rol/tenant no sobrescriben la versión remota.
- Undo/redo durante envío, después de recargar y ante límite de memoria tienen
  comportamiento documentado; el historial persistido no se confunde con la pila.
- Cambiar una propiedad HTML respeta su revisión y no rompe undo nativo ni recibos.
- Añadir/quitar referencias no borra recursos; render/procesar/publicar no se
  inicia al mover un slider ni al cerrar el inspector.
- Preview y render consumen el mismo documento confirmado; exportar/renderizar
  no ignora una cola pendiente ni usa un snapshot viejo silenciosamente.

## 10. Evidencia primaria

Rutas relativas a apps/web/src:

- domains/materials/components/composition-editor/CompositionInspector.tsx:88–255.
- domains/materials/components/composition-editor/CompositionMotionControls.tsx:212,359,443,523.
- domains/materials/components/composition-editor/CompositionTextControls.tsx:54,142,232.
- domains/materials/components/composition-editor/CompositionColorCorrectionControls.tsx:70–130.
- domains/materials/components/composition-editor/LayerDepthControls.tsx:36,89–99.
- domains/materials/components/composition-editor/CompositionVolumeEnvelopeControls.tsx:256.
- domains/materials/components/composition-editor/CompositionVideoRateControls.tsx:40–52.
- domains/materials/components/composition-editor/CompositionHtmlEditableFields.tsx:23–54.
- domains/materials/components/composition-editor/TrackControls.tsx:22–50,139–141.
- domains/materials/components/composition-editor/AudioMixControls.tsx:25,68–70.
- domains/materials/components/composition-editor/NativeCompositionPreview.tsx:625,1262–1272,1765–2045,2003,2709–2755,3770–3818.
- domains/materials/components/composition-editor/CompositionPreviewToolbar.tsx:133.
- domains/materials/components/composition-editor/useCompositionHtmlEditorialSession.ts:18–83.
- domains/production/composition-editor/composition-command-history.ts:3–7,45,132–162.
- domains/production/composition-editor/composition-save-queue.ts:12–99.
- domains/production/composition-editor/composition-document.service.ts:137,207.
- domains/production/composition-editor/composition-advanced-capabilities.ts:1–13.

Las líneas corresponden al checkout de esta auditoría y pueden moverse al editar.
Se hizo revisión estática; no se probaron controles autenticados ni proveedores.
