# Informe de investigación: latencia recurrente del editor

**Fecha:** 30 de octubre de 2026.
**Base inspeccionada:** `staging`, commit `13774405f90d5d3dd1d87989673c6b4976269f54`.
**Alcance:** diagnóstico del editor nativo, autoguardado, preview incremental y preview de HTML controlado. No se modificó código de producto.
**Autoría:** investigación y revisión adversarial realizadas por el mismo agente; no se presentan como revisión independiente.

## 1. Conclusión ejecutiva

El reporte del usuario es coherente con el código actual. La solución anterior **separó parcialmente la actualización visual de la persistencia, pero no desacopló la continuidad de edición del guardado**. Además, existen caminos normales que reconstruyen el preview después de guardar.

Hay tres causas principales confirmadas:

1. **El guardado continúa siendo una barrera global.** El ACK visual puede habilitar reproducción y scrub, pero muchos controles del inspector, pistas y clips siguen recibiendo `saving` y quedan deshabilitados hasta terminar la escritura y su procesamiento posterior.
2. **La presencia de HTML controlado cambia el comportamiento de toda la composición.** El constructor de patches de escena devuelve `null` si existe una referencia HTML en cualquiera de los documentos. Una edición nativa de texto, timing o geometría que necesita esa proyección termina en reconstrucción canónica, aunque el asset editado sea otro video o texto.
3. **El inspector eleva ajustes simples a operaciones de escena.** Al cambiar posición, su callback también envía duración, movimiento y layout completo. Ese lote se clasifica como `LIVE_TIMELINE`. Incluso un `clip.layout` aislado deja de admitir patch DOM si incluye `opacity`, aunque la opacidad no haya cambiado.

Por tanto, pueden coexistir un preview que responde rápido en ciertos casos, controles bloqueados por persistencia y recargas recurrentes en otros. No hay contradicción técnica entre esas tres observaciones.

**Límite de la conclusión:** se demostraron los mecanismos en esta revisión y con datos sintéticos. No se conoce el commit desplegado, tipo exacto de curso afectado, flags efectivos, duración de sus requests, errores ni perfil de navegador del usuario. No se atribuyen segundos concretos de producción a una causa sin esas mediciones.

## 2. Qué se revisó y qué significa «guardar por detrás»

Se revisaron código y evidencias de OpenSpec, historial Git de los archivos relevantes, controles React, coordinadores, cola, tipos de patch, runtime del iframe, transporte HTML, rutas de persistencia y preparación de recursos.

El flujo actual es, de forma simplificada:

```text
Interacción en un control
  → borrador del control; final de gesto o pausa de 600 ms
  → flush/coordinación y registro local de pendientes
  → cola serial de guardado
  → documento optimista y elección de patch
       ├─ compatible: envío al runtime → ACK visual
       └─ incompatible/no disponible: esperar documento guardado → reconstruir preview
  → journal de recuperación + PUT con If-Match
  → respuesta, documento confirmado, reconciliación visual e historial
  → liberación del estado global de guardado
```

El PUT es asíncrono, pero **no constituye un worker independiente que permita continuar todas las acciones**. El componente sigue esperando su resultado para completar el comando. Esa espera es compatible con un preview optimista y, al mismo tiempo, con bloqueos globales en la UI.

La cola admite hasta 50 comandos y procesa uno por vez. La aplicación del documento optimista ocurre dentro de `executeSavePatch`, cuando se ejecuta el comando, no al admitir cualquier comando posterior en la cola. No equivale a un modelo completo de edición local concurrente con persistencia serial.

Evidencia: [autoguardado y coordinador](../../../../apps/web/src/domains/production/composition-editor/composition-interaction-autosave.ts), [eventos del formulario](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionAutosaveBoundary.tsx), [cola](../../../../apps/web/src/domains/production/composition-editor/composition-save-queue.ts), [admisión y ejecución](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L1821).

## 3. Hallazgos confirmados

### H1 — El ACK visual no libera la mayoría de las herramientas

**Prioridad P1; confianza alta.**

El runtime puede confirmar un patch y ejecutar `setPreviewDirty(false)` antes de que termine el PUT. Sin embargo, `saving` continúa activo. En el camino exitoso se espera también al resultado del patch, se registra historial y se limpia el journal antes del `finally` que libera el guardado. La cola mantiene estado ocupado si quedan comandos.

Ese estado se propaga a `CompositionInspector`, `CompositionSelectionPanel`, `CompositionTimelineWorkspace`, transiciones y toolbar. Entre los consumidores hay campos de texto, motion, recorte, volumen, profundidad, controles de pista y botones de clips de la timeline. Algunas entradas de geometría no llevan `disabled` directamente, pero su boundary de autoguardado sí recibe el bloqueo; no debe afirmarse que absolutamente toda la interfaz se congela.

El transporte de reproducción/scrub tiene una excepción: puede habilitarse después del ACK cuando `previewDirty` ya es falso. **La excepción no se extiende al resto de las herramientas.**

Evidencia: [ACK temprano y guardado](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L1919), [espera y finalización](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L2040), [inspector](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionInspector.tsx#L216), [clips de timeline](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionTimeline.tsx#L640), [excepción de transporte](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionPreviewViewport.tsx#L99).

### H2 — Una referencia HTML puede forzar recargas por cambios en otros assets

**Prioridad P1; confianza alta.**

`buildCompositionPreviewScenePatch` devuelve `null` si `beforeDocument.htmlEditing.items` o `document.htmlEditing.items` tiene elementos. Es una condición de composición completa, no un filtro del clip afectado.

Para una operación que necesita escena, ese `null` impide el envío incremental. Después del PUT se programa `scheduleSavedPreviewReload`, que espera a que la cola quede vacía y llama a `refreshPreviewDocument`. Esto pausa, cambia hash/generación y genera otra URL de preview. Para HTML también cambia la sesión correspondiente.

Se comprobó con el mismo lote sobre video:

| Composición sintética | Resultado del constructor |
| --- | --- |
| Sólo video | Patch de escena disponible |
| Video y deck estático sin referencias HTML | Patch de escena disponible |
| Video y otro clip con referencia HTML controlada | Sin patch; necesita fallback |
| Texto nativo y otro clip con referencia HTML controlada | Sin patch; necesita fallback |

No significa que todos los documentos con HTML recarguen ante cualquier comando: los patches DOM pequeños todavía pueden ser admisibles. El problema aparece cuando la operación pasa a escena. El runtime conserva además su propio rechazo de escenas para HTML controlado.

Este fallback protege un contrato de autoridad y layout. **No corresponde eliminar la condición sin diseñar una alternativa segura.**

Evidencia: [guard de composición](../../../../apps/web/src/domains/production/composition-editor/composition-preview-scene-patch.ts#L37), [guard del runtime](../../../../apps/web/src/domains/production/composition-editor/composition-preview-compiler.service.ts#L1398), [programación de recarga](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L1753), [fallback tras guardado](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L2091).

### H3 — Cambiar un campo puede reconstruir mucho más que ese campo

**Prioridad P1 por su interacción con H2; confianza alta.**

`saveAllChanges` envía `clip.duration`, `clip.move` y `clip.layout` completo para una edición de geometría. Si el clip tiene audio configurable, añade volumen y fades. La política elige la estrategia más exigente del lote, aunque algunas propiedades no hayan cambiado.

El constructor DOM rechaza layouts que contengan `opacity`. El inspector la incluye en el layout completo. La comprobación de no-op del componente compara el documento entero: evita un guardado completamente redundante, pero no elimina operaciones redundantes de un lote que sí cambia algo.

Consecuencias:

- Sin HTML controlado: un ajuste simple puede reconstruir la proyección de toda la escena y reinstalar el timeline.
- Con HTML controlado: el mismo ajuste puede pasar a recarga de iframe por H2.
- Música y texto tienen callbacks que también envían conjuntos de propiedades, no únicamente el campo editado.

Evidencia: [lote del inspector](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionInspector.tsx#L179), [lote de música](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionInspector.tsx#L92), [lote de texto](../../../../apps/web/src/domains/materials/components/composition-editor/CompositionTextControls.tsx#L148), [rechazo de opacity](../../../../apps/web/src/domains/production/composition-editor/composition-preview-visual-patch.ts#L72), [política por lote](../../../../apps/web/src/domains/production/composition-editor/composition-preview-operation-policy.ts).

### H4 — La edición editorial HTML tiene una reconstrucción normal después de adoptar la revisión

**Prioridad P1 si el usuario trabaja en HTML; confianza alta.**

El host HTML reserva exclusividad frente a la cola nativa, comunica ocupación y, después de adoptar la revisión confirmada, llama directamente a `refreshPreviewDocument(false, "EDIT_SAVED")`. Esta recarga es parte del camino normal del editor HTML, no sólo recuperación de un error.

El canal HTML utiliza una sesión vinculada al hash y a una generación. Su preparación incluye comprobar inventario, materializar recursos en archivos temporales, compilar y revalidar el portfolio. La página emite capacidades para entregar recursos y libera los archivos preparados; los GET posteriores reautorizan su entrega. Repetir ese camino puede ser mucho más caro que cambiar un atributo DOM.

No se midieron los bytes transferidos al usuario ni se asegura que todos los videos se descarguen completos en cada recarga: intervienen rangos, cachés y estado del navegador. Sí está confirmada la repetición del ciclo de preparación/navegación. Tampoco equivale a regenerar el video original ni a iniciar un render facturable.

Evidencia: [host y adopción](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L688), [selección de canal](../../../../apps/web/src/domains/production/composition-editor/composition-html-editing-preview-selection.ts), [preparación de recursos](../../../../apps/web/src/domains/production/composition-editor/composition-html-editing-preview-resources.server.ts#L51), [página y capacidades](../../../../apps/web/src/domains/production/composition-editor/composition-html-editing-preview-page.server.ts).

### H5 — Hay otras causas explícitas de fallback y un presupuesto de ACK estrecho

**Confianza alta en el mecanismo; frecuencia en producción desconocida.**

La ruta incremental exige runtime listo, patch representable, hashes compatibles y ausencia de propuesta/preset en conflicto. Fuentes nuevas, cambios de CSS/deck, restauración de documento o edición durante una recarga pueden ir a compilación. Un patch rechazado o un timeout también causa reconstrucción tras guardar.

El ACK visual tiene presupuesto de **750 ms**. Para medios nuevos, antes de despacharlo puede necesitarse HEAD/resolución de URL, con límite de **10 s**; esa espera puede solaparse con el PUT, pero el comando espera a ambos. En HTML, la admisión en la cola de transporte no es un ACK visual: existe intervalo de **50 ms** entre comandos y un timeout de ACK de canal de **5 s**.

La reproducción sin enviar deliberadamente el ACK produjo `TIMEOUT` aproximadamente a los 763 ms. Prueba el mecanismo, no que la sesión real haya superado ese presupuesto. Las colas del transporte y la carga del hilo principal deben medirse antes de atribuirles recargas.

Evidencia: [condiciones incrementales](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L1911), [timeouts](../../../../apps/web/src/domains/production/composition-editor/composition-preview-sync.config.ts), [coordinador de ACK](../../../../apps/web/src/domains/production/composition-editor/composition-preview-runtime-sync.client.ts), [URL de medios nuevos](../../../../apps/web/src/domains/production/composition-editor/composition-preview-asset-urls.client.ts), [host HTML](../../../../apps/web/src/domains/production/composition-editor/composition-html-editing-preview-host.client.ts), [contrato del canal](../../../../apps/web/src/domains/production/composition-editor/composition-html-editing-preview-channel.contract.ts).

## 4. Por qué las mediciones y pruebas anteriores no descartan el problema

### El nombre de una métrica no representa necesariamente la experiencia completa

En el camino incremental, `edit_to_visual_update_ms` recibe `runtimeOutcome.durationMs`, igual que `runtime_visual_patch_ms`. Esa duración no incluye los 600 ms de pausa, admisión/cola, construcción del patch ni resolución de URL anterior al dispatch. Tampoco mide cuánto siguen bloqueadas las herramientas después del ACK.

`save_roundtrip_ms` empieza después del journal y termina en `finally`, después de esperar el patch y registrar historial. No es una medida aislada del servidor o de la red.

La telemetría permite **100 eventos por sesión**, no 100 acciones. El contador no se restablece al vaciar un batch. En una prueba con 110 eventos válidos aceptó 100. Una sesión larga puede dejar de aportar observaciones. El tamaño registrado de request se limita a 32 KiB y no describe el tamaño del documento de respuesta ni del patch de escena.

Además, `SAVE_RECOVERY` agrupa recuperaciones por distintas causas; una operación clasificada `LIVE_TIMELINE` puede terminar en reload sin que esa etiqueta explique el rechazo de capacidad por HTML. Faltan razones de fallback específicas y tiempos de bloqueo/desbloqueo.

Evidencia: [registro de métricas](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L2040), [finally](../../../../apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx#L2132), [presupuesto y schema](../../../../apps/web/src/domains/production/composition-editor/composition-preview-telemetry.ts), [contador de sesión](../../../../apps/web/src/domains/production/composition-editor/composition-preview-telemetry.client.ts#L28).

### La prueba de guardado lento cubría transporte de preview, no continuidad general de edición

El smoke anterior añade texto a una composición sin referencias HTML, retiene un PUT simulado y comprueba que el scrub está habilitado. No comprueba que puedan seguir editándose texto, motion, pistas o clips mientras se persiste. Tampoco acredita un curso HTML controlado ni tiempos de su API/Storage real.

Los buenos tiempos de aplicación de patches previamente reportados pueden ser correctos para ese fixture. **No justifican concluir que toda la latencia del editor quedó resuelta.** Las pruebas de autoguardado comprueban deduplicación, orden y recuperación, no un SLO de edición concurrente.

Evidencia: [smoke anterior](../../../../apps/web/src/domains/production/composition-editor/qa/run-composition-editor-latency-smoke.ts#L111), [límites ya registrados en OpenSpec](implementation.md), [tests del coordinador](../../../../apps/web/src/domains/production/composition-editor/__tests__/composition-interaction-autosave.test.ts).

## 5. Costes adicionales comprobables, todavía sin atribución temporal de producción

La proyección de escena genera nodos y timeline para todos los clips; el runtime revierte/reinstala el timeline y reconcilia el árbol. Se reutilizan medios cuando identidad, fuente y orden lo permiten, pero no es una actualización estrictamente limitada al clip modificado.

En un experimento sintético de video sencillo, una proyección de 1 clip contenía 1 nodo y 1,395 bytes; una de 500 clips, 500 nodos y 579,762 bytes. La mediana local de construcción en Node fue aproximadamente 0.11 ms y 4.87 ms, respectivamente. **Esto no demuestra un cuello de botella excesivo de CPU:** excluye React, DOM, GSAP, transferencia entre contextos, imágenes y decodificación. Sí demuestra que el trabajo y el payload crecen con la composición completa.

También hay serialización del documento, hashing del journal, localStorage e historial en la ruta de edición. Se necesita un perfil del hilo principal para cuantificar su coste real.

El PUT mantiene autenticación, organización, lectura del documento actual, validación, hash y append versionado mediante `append_video_composition_draft_document_v2`; devuelve el documento completo. La lentitud del servidor se convierte en espera visible por H1. No hay evidencia aquí para afirmar que falten índices, exista un lock prolongado, falte memoria en runtime o Supabase sea la causa primaria. Los cambios recientes del heap de build no prueban un problema del editor en navegador.

Evidencia: [escena completa](../../../../apps/web/src/domains/production/composition-editor/composition-preview-scene-patch.ts), [runtime de escena](../../../../apps/web/src/domains/production/composition-editor/composition-preview-scene-runtime.ts), [persistencia](../../../../apps/web/src/domains/production/composition-editor/composition-document.service.ts#L151), [PUT](../../../../apps/web/src/app/api/production/hyperframes/drafts/[draftId]/document/route.ts#L98), [journal](../../../../apps/web/src/domains/production/composition-editor/composition-recovery-journal.ts), [historial](../../../../apps/web/src/domains/production/composition-editor/composition-command-history.ts).

## 6. Modelo de latencia y cómo distinguir las causas

Son modelos conceptuales, no resultados medidos del usuario:

| Síntoma | Tramos que deben separarse |
| --- | --- |
| El campo tarda en reflejarse en el canvas | Borrador local, pausa de autoguardado, admisión, proyección, transporte y ACK |
| El canvas cambia pero no puedo continuar | Estado global `saving`, respuesta completa del PUT, espera adicional del runtime, historial y liberación de cola |
| Se vuelve a preparar el preview | Motivo de fallback, guardado, espera de cola vacía, nueva URL/sesión, preparación de recursos y readiness |
| El video tarda en recuperar imagen o reproducción | Navegación/reordenamiento, fuente/capacidad, buffers, rangos, decodificación y buffering |

La pausa normal de autoguardado es de 600 ms para ciertos eventos; finalizar gesto, blur o Enter puede adelantar el envío. No debe sumarse siempre a todos los escenarios. En texto, el control mantiene estado local y publica contenido/estilo mediante `onPatch`; no expone un callback de preview efímero como el que sí existe para color o crop. Tampoco debe darse por probado que todos los campos se reflejen continuamente antes del commit.

## 7. Recomendaciones priorizadas

### P0 — Medir el flujo completo y clasificar las recargas

- Confirmar revisión desplegada, tipo de documento y flags efectivos mediante un diagnóstico autorizado, sin volcar secretos ni leer configuraciones personales.
- Capturar una acción real con marcas de entrada, borrador visible, espera de cola, patch construido/enviado, ACK visual, inicio/fin del PUT, herramientas habilitadas, navegación de iframe y primer frame disponible.
- Separar fallback por HTML controlado, fuente/dependencia nueva, runtime no listo, discrepancia de hash, rechazo de envío, timeout y error HTTP. No agruparlos exclusivamente bajo `SAVE_RECOVERY`.
- Añadir visibilidad de duración por etapa de persistencia y preparación, y revisar el presupuesto de eventos por sesión. No quitar límites sin diseñar muestreo y cuotas.
- Medir p50/p95 sobre composiciones representativas; los umbrales existentes no constituyen evidencia de cumplimiento.

### P1 — Completar el desacoplamiento, preservando consistencia

- Mantener separados documento confirmado, borrador compuesto y comandos en vuelo. Continuar admitiendo/mostrando ediciones locales mientras una única ruta serial persiste las versiones.
- Sustituir bloqueos globales por bloqueos de operaciones realmente incompatibles. **No basta con quitar `disabled={saving}`:** las operaciones siguientes necesitan una base coherente, reconciliación de respuestas tardías, historial y recuperación.
- Emitir patches con propiedades efectivamente modificadas, conservando la semántica de cada acción. Evitar incluir opacity, timing o fades sin necesidad.
- Diseñar actualizaciones autorizadas de capas nativas independientes cuando el curso contenga HTML controlado. La autoridad de revisiones, sesión, manifiesto, aislamiento, CAS e inventario debe permanecer intacta.
- Para campos HTML, evaluar un preview efímero de datos admitidos por el manifiesto y reconciliación de la revisión confirmada, en vez de navegar todo el iframe por cada edición. No introducir HTML arbitrario ni confiar en el payload como permiso.

### P2 — Reducir trabajo de reconstrucción y mejorar claridad

- Proyectar sólo clips/ventanas afectados cuando sea posible y conservar elementos, URLs/capacidades vigentes y buffers cuando sus identidades no cambien.
- Revisar el presupuesto de ACK junto con el transporte HTML y la carga real, sin ocultar rechazos genuinos aumentando timeouts indiscriminadamente.
- Diferenciar «Guardando», «Preview actualizado» y «Preparando medios». El inspector aún puede mostrar «Actualizando preview…» por `saving` aunque el ACK ya haya llegado.

## 8. Matriz mínima para una corrección posterior

| Caso | Criterio observable |
| --- | --- |
| Mover un video con PUT retenido | Canvas actualizado y próxima edición local admitida antes de liberar el PUT |
| Cambiar sólo X en inspector | Operación mínima; no incluir duración/opacidad sin cambio |
| Editar texto nativo en curso con HTML controlado | No reconstruir todo el preview por afectar una capa nativa independiente, una vez exista contrato seguro que lo permita |
| Modificar un campo HTML admitido | Preview coherente y revisión confirmada; sin eludir manifiesto, sesión ni permisos |
| Ráfaga de acciones y respuesta tardía | Último borrador preservado; orden, undo/redo y CAS correctos |
| 409, 403, timeout o fallo de almacenamiento | Sin sobrescritura silenciosa ni reintentos peligrosos; recuperación explícita |
| 1, 50, 200 y 500 clips; textos, audio y HTML | Medir trabajo de CPU/DOM, bytes y tiempo de interactividad, no sólo ACK |
| Sesión con más de 100 eventos | Observabilidad útil según política de muestreo documentada |

## 9. Evidencia y límites de esta entrega

- [JSON de resultados y hashes de fuentes](latencia-2026-10-30-evidencia.json).
- [Script reproducible del diagnóstico](reproducir-latencia-2026-10-30.cjs). Carga las fuentes TypeScript de esta revisión con dependencias locales; no permite fetch en los módulos evaluados ni carga `.env`.
- Seis escenarios de decisión de patch comprobados con aserciones; comprobaciones adicionales de cola, timeout sin ACK, límite de telemetría y tamaño de proyección.
- `npm run test:composition-autosave --workspace=apps/web`: salida 0, **21 pruebas aprobadas**, ejecutado sobre la misma base en el checkout principal para reutilizar sus dependencias. Sólo se generan salidas auxiliares ignoradas.
- `npm run docs:audit`: salida 0 en el worktree aislado. El contraste con README y contexto no exige alterar alcance de producto ni contratos: el informe documenta límites y defectos del flujo existente. No se reescribieron esas fuentes sólo para cambiar su fecha.
- La primera ejecución del experimento falló porque el fixture de deck manual no estaba normalizado por el schema; se normalizó antes de comparar. No se cambió el producto para obtener un resultado favorable.
- Validaciones documentales y de OpenSpec: resultados finales en [registro de verificación](verificacion-latencia-2026-10-30.md).

No se ejecutaron sesión autenticada, consulta de producción, SQL remoto, trazas HAR reales, QA visual ni render del proveedor. No se inspeccionaron secretos ni configuración local. No se verificó el despliegue ni se promete que estos resultados sean sus métricas.

**Dictamen:** la optimización anterior sigue siendo útil en el camino nativo compatible, pero el comportamiento actual conserva barreras de persistencia y rutas de reconstrucción que explican la recurrencia. El siguiente trabajo debe centrarse en continuidad de edición, granularidad de patches y contrato de actualización HTML, con medición integral; reducir únicamente el tiempo del PUT no resuelve esas tres causas.
