# Reporte ejecutivo: recuperación y sincronización de assets de HeyGen

**Fecha de revisión:** 31 de agosto de 2026  
**Curso auditado:** Ventas  
**Lección:** Lección 2.5: Optimización de la Comunicación con IA para el Seguimiento  
**Componente:** `3b54169f-9371-4339-991f-78eac4a48f8d`  
**Estado general:** Recuperación histórica correcta; contrato de completitud por escena implementado; producción vigente pendiente de decisión editorial en tres escenas.

## 1. Resumen ejecutivo

La investigación confirmó que los videos y audios generados anteriormente no se perdieron. Los cuatro videos identificados existen en HeyGen, están marcados como completados, fueron importados al almacenamiento interno y permanecen disponibles en el editor. Los diez audios registrados también existen físicamente.

La percepción de pérdida surgió porque tres videos históricos corresponden a versiones anteriores de los guiones de las escenas 1, 3 y 7. El sistema actualizado evita vincularlos automáticamente a los guiones vigentes, ya que hacerlo produciría narración incorrecta y sincronización labial inconsistente.

La recuperación histórica está completa respecto de los assets que realmente fueron generados. Si los guiones actuales son definitivos, deben regenerarse únicamente las escenas 1, 3 y 7. No es necesario regenerar las escenas 2, 4, 5 o 6.

La revisión final cerró además el problema de interpretación: cada escena ahora conserva explícitamente si espera avatar, sólo voz o ningún medio hablado. Las escenas heredadas que no pueden clasificarse con evidencia segura se muestran como “modalidad pendiente” en lugar de asumirse como avatares faltantes.

## 2. Problema observado

El flujo anterior tenía varios puntos donde un asset aceptado o generado por HeyGen podía quedar sin una referencia durable en Courseforge:

- Un video podía ser aceptado por HeyGen y perderse la actualización local del identificador del proveedor.
- Un audio podía alcanzar Storage, pero fallar antes de crear su registro en `production_assets`.
- Los reintentos de voz eliminaban información que podía reutilizarse para evitar una segunda generación con costo.
- La recuperación se apoyaba demasiado en el identificador de escena, aunque el storyboard podía regenerarse y reutilizar esos identificadores con textos distintos.
- Los assets históricos válidos no permanecían visibles en el inventario del editor.
- La interfaz no diferenciaba con suficiente claridad entre assets vigentes, históricos y colocados en la timeline.

## 3. Causa raíz

La causa no fue una sola eliminación de archivos. Fue una combinación de correlación incompleta y mutabilidad del storyboard:

1. Los jobs, los archivos internos y los recursos de HeyGen no siempre conservaban una correlación recuperable de extremo a extremo.
2. Las escenas 1, 3 y 7 cambiaron de guion después de haberse generado sus videos.
3. Los assets anteriores seguían existiendo, pero ya no eran semánticamente compatibles con el contenido vigente.
4. La interfaz mostraba conteos de medios sin explicar cuáles estaban activos y cuáles eran históricos.

## 4. Evidencia confirmada en la segunda auditoría

La revisión cruzó base de datos, Storage, jobs, borrador de composición, timeline y HeyGen.

| Comprobación | Resultado |
|---|---:|
| Escenas narrativas vigentes | 7 |
| Videos de HeyGen identificados | 4 |
| Videos completos directamente en HeyGen | 4 de 4 |
| Audios de proveedor registrados | 10 |
| Medios de proveedor activos | 14 |
| Medios históricos no compatibles con el guion vigente | 9 |
| Archivos físicos faltantes en Storage | 0 |
| Assets vinculados al borrador | 16 |
| Assets de timeline sin vínculo al borrador | 0 |
| Clips colocados en la timeline | 13 |
| Versión del documento consistente con el borrador | Sí |

Los 16 assets vinculados se explican por 14 medios de HeyGen y 2 imágenes auxiliares del deck. No representan 16 archivos de avatar o voz.

Los 13 segmentos de la timeline coinciden con la interfaz:

- 8 diapositivas;
- 1 clip de avatar vigente;
- 4 clips de voz vigentes.

## 5. Estado por escena

| Escena | Voz vigente | Avatar vigente | Interpretación |
|---|---:|---:|---|
| 1 | No | No | Existe una generación histórica, pero usa otro guion. |
| 2 | Sí | No | Correcta como escena de voz en off. |
| 3 | No | No | Existe una generación histórica, pero usa otro guion. |
| 4 | Sí | No | Correcta como escena de voz en off. |
| 5 | Sí | Sí | Completa y compatible con el guion vigente. |
| 6 | Sí | No | Correcta como escena de voz en off. |
| 7 | No | No | Existe una generación histórica, pero usa otro guion. |

Distribución de los 14 medios de proveedor:

- 5 vigentes: avatar de escena 5 y voces de escenas 2, 4, 5 y 6.
- 9 históricos: avatares y voces anteriores de escenas 1, 3 y 7, más tres voces de escenas manuales que ya no forman parte del storyboard.

## 6. Solución aplicada

La solución implementada refuerza la trazabilidad y recuperación sin revivir contenido incompatible:

- Correlación durable entre job local y video remoto mediante un identificador incluido en el título de nuevas generaciones.
- Lectura paginada del catálogo remoto de HeyGen para reparar jobs huérfanos.
- Recuperación de identificadores del proveedor y de videos históricos completados.
- Comparación por huella criptográfica del guion antes de vincular un asset a una escena vigente.
- Remapeo seguro sólo cuando una huella de guion coincide de manera única.
- Recuperación independiente de avatar y voz para evitar que un tipo de job oculte al otro.
- Checkpoint durable inmediatamente después de generar voz.
- Recuperación de voz desde `production_assets`, Storage o checkpoint antes de solicitar una nueva generación.
- Conservación del checkpoint al reintentar un job fallido para evitar duplicar consumo en HeyGen.
- Exposición de avatares y voces históricas en el inventario del editor.
- Exclusión explícita de assets históricos de la inserción automática en la timeline.
- Validación de tenant, componente y rutas internas de Storage en los endpoints involucrados.
- Contrato persistente `expected_media_mode` por escena, con los valores `avatar`, `voice_only` y `none`.
- Clasificación histórica segura a partir de medios vigentes y jobs cuyo guion coincide; no se infiere modalidad desde un asset incompatible.
- Completitud calculada según el medio esperado, no por ausencia genérica de video.
- Un avatar con pista separada sólo se considera completo cuando existen tanto el video como su voz; un video con audio integrado sigue siendo válido por sí solo.
- Conservación del contrato cuando cambia el guion, se guarda un formulario antiguo, se recupera historial o termina un worker concurrente.
- Selección y edición visibles de la modalidad en el módulo de avatares.

## 7. Estado actual de la solución

La recuperación puede considerarse técnicamente correcta para este incidente:

- No quedan videos identificados en HeyGen pendientes de importar.
- No hay archivos registrados pero ausentes en Storage.
- No existen referencias rotas desde la timeline.
- Los históricos permanecen disponibles sin sustituir contenido vigente.
- Los reintentos futuros de voz tienen una ruta de recuperación durable.

La lección no debe marcarse todavía como producción audiovisual completa hasta decidir la modalidad de las escenas 1, 3 y 7. Si el patrón aprobado sigue siendo avatar en escenas impares y voz en off en escenas pares, faltan nuevas generaciones sólo para esas tres escenas.

Después de ejecutar nuevamente la recuperación, el resultado esperado es:

- escenas 2, 4 y 6 clasificadas como `voice_only` y completas;
- escena 5 clasificada como `avatar` y completa por contar con video y voz separada;
- escenas 1, 3 y 7 como modalidad pendiente, sin vincular sus medios históricos incompatibles;
- cero falsos positivos que reporten falta de avatar en escenas configuradas como voz en off.

## 8. Acciones pendientes

### Obligatorias para cerrar esta lección

1. Confirmar que los guiones actuales de las escenas 1, 3 y 7 son definitivos.
2. Definir su modalidad en el módulo de avatares. Si deben usar avatar, generarlas allí; la generación producirá también sus pistas de voz separadas.
3. Ejecutar `Actualizar assets` cuando HeyGen complete los tres videos.
4. Verificar que la timeline termine con cuatro avatares y siete voces vigentes, si ese es el patrón editorial aprobado.
5. Revisar sincronización y duración antes de aprobar o renderizar.

### Obligatorias antes de declarar el fix desplegado

1. Confirmar que el commit que contiene la recuperación está desplegado en el ambiente objetivo.
2. Ejecutar un smoke test con una lección controlada: generar una voz y un avatar, interrumpir la persistencia simuladamente y comprobar la recuperación.
3. Revisar logs estructurados para confirmar que no aparecen eventos de correlación perdida.

## 9. Mejoras recomendadas

### Implementada: contrato explícito de completitud por escena

Courseforge ya persiste de forma inequívoca si una escena espera `avatar`, `voice_only` o ningún medio hablado. Para datos heredados, sólo clasifica automáticamente cuando existe evidencia compatible con el guion vigente; de lo contrario exige una decisión editorial.

El campo añadido a cada escena es:

```ts
expected_media_mode: "avatar" | "voice_only" | "none"
```

Los conteos de completitud, alertas y acciones de regeneración ya se derivan de ese contrato y de la existencia de los medios requeridos.

### Prioridad media: claridad del inventario

Separar visualmente los conteos:

- Medios vigentes.
- Medios históricos.
- Medios colocados en timeline.
- Medios incompatibles por cambio de guion.

Los históricos deberían mostrar una insignia y el motivo por el cual no se insertaron automáticamente.

### Prioridad media: observabilidad operativa

Añadir métricas y eventos para:

- videos aceptados por HeyGen sin persistencia local inmediata;
- audios recuperados desde checkpoint;
- assets recuperados desde Storage sin registro previo;
- históricos rechazados por diferencia de guion;
- jobs sin identificador remoto recuperable;
- tiempo total y resultado de cada sincronización.

### Prioridad baja: política de retención

Definir cuánto tiempo deben conservarse las generaciones históricas y cuándo pueden archivarse. La eliminación no debe ser automática hasta contar con una política aprobada y trazabilidad de uso.

## 10. Validaciones ejecutadas

- Auditoría de sólo lectura contra Supabase.
- Comprobación física de los 14 medios de proveedor en Storage.
- Consulta directa del estado de los cuatro videos en HeyGen.
- Validación de los vínculos del borrador y los assets utilizados por la timeline.
- Comprobación de consistencia entre la versión activa del borrador y el último documento.
- TypeScript completo sin errores.
- Suite de HeyGen y Remotion aprobada.
- Suite de HyperFrames y editor de composición aprobada.
- Suite de preview y progreso de Producción aprobada.
- Pruebas de regresión del contrato de modalidad, compatibilidad con formularios antiguos y requisito de voz separada aprobadas.

## 11. Criterio de cierre

El incidente de recuperación de assets puede cerrarse cuando:

- el fix esté desplegado y verificado en el ambiente objetivo;
- las escenas 1, 3 y 7 tengan una modalidad explícita y se generen sólo los medios que esa decisión requiera;
- la timeline contenga exactamente los medios esperados según el contrato editorial;
- una nueva sincronización reporte cero archivos faltantes y cero referencias rotas;
- la recuperación reporte cero medios esperados incompletos y cero escenas sin modalidad.

## 12. Conclusión

No existe evidencia de pérdida física de los videos o audios identificados. La solución aplicada recuperó y conservó correctamente el historial, impidió vincular contenido obsoleto a guiones nuevos, protegió futuras generaciones de voz y avatar y corrigió el modelo de completitud. El trabajo restante ya no es técnico: consiste en decidir la modalidad de las escenas 1, 3 y 7 y generar únicamente los medios correspondientes al guion vigente.
