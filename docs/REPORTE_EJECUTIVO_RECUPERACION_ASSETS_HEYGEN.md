# Reporte ejecutivo: recuperación y sincronización de assets de HeyGen

**Fecha de revisión:** 1 de septiembre de 2026
**Curso auditado:** Ventas  
**Lección:** Lección 2.5: Optimización de la Comunicación con IA para el Seguimiento  
**Componente:** `3b54169f-9371-4339-991f-78eac4a48f8d`  
**Estado general:** Recuperación histórica, reasignación operacional y sincronización del editor completadas; pendiente únicamente la validación editorial de reproducción.

## 1. Resumen ejecutivo

La investigación confirmó que los videos y audios generados anteriormente no se perdieron. Los cuatro videos identificados existen en HeyGen, están marcados como completados, fueron importados al almacenamiento interno y permanecen disponibles en el editor. Los diez audios registrados también existen físicamente.

La percepción de pérdida surgió porque tres videos históricos corresponden a versiones anteriores de los guiones de las escenas 1, 3 y 7. El sistema actualizado evita vincular automáticamente un histórico cuando su huella no coincide, ya que hacerlo normalmente podría producir narración incorrecta y sincronización labial inconsistente.

Para esta lección se autorizó reutilizar expresamente esos tres videos. Se aplicó una reasignación externa, acotada y reversible de cada job a su escena, incluyendo la voz separada; después se ejecutó el mismo servicio de sincronización que usa el editor. El resultado vigente es de cuatro avatares y siete voces completas.

La revisión final cerró además el problema de interpretación: cada escena conserva explícitamente si espera avatar, sólo voz o ningún medio hablado. Las escenas heredadas que no puedan clasificarse con evidencia segura seguirán mostrándose como “modalidad pendiente”; esta reparación forzada no debilita esa regla general.

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

## 4. Evidencia confirmada antes de la reasignación

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

La verificación posterior confirmó:

| Comprobación final | Resultado |
|---|---:|
| Avatares vigentes completos | 4 |
| Voces vigentes completas | 7 |
| Medios reasignados presentes en el documento activo | 6 de 6 |
| Versión vigente del borrador tras normalizar etiquetas | 32 |
| Archivos físicos faltantes | 0 |
| Escenas objetivo con trazabilidad de reparación | 3 de 3 |

## 5. Estado por escena

| Escena | Voz vigente | Avatar vigente | Interpretación |
|---|---:|---:|---|
| 1 | Sí | Sí | Histórico reasignado de forma explícita y auditada. |
| 2 | Sí | No | Correcta como escena de voz en off. |
| 3 | Sí | Sí | Histórico reasignado de forma explícita y auditada. |
| 4 | Sí | No | Correcta como escena de voz en off. |
| 5 | Sí | Sí | Completa y compatible con el guion vigente. |
| 6 | Sí | No | Correcta como escena de voz en off. |
| 7 | Sí | Sí | Histórico reasignado de forma explícita y auditada. |

Distribución de los 14 medios de proveedor:

- 11 vigentes: avatares de escenas 1, 3, 5 y 7, más voces de las siete escenas.
- 3 históricos: voces de escenas manuales que ya no forman parte del storyboard.

## 6. Solución aplicada

La solución general implementada refuerza la trazabilidad y evita revivir contenido incompatible automáticamente:

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

La recuperación y la reasignación operacional están completas para este incidente:

- No quedan videos identificados en HeyGen pendientes de importar.
- No hay archivos registrados pero ausentes en Storage.
- Las escenas 1, 3 y 7 apuntan explícitamente a sus tres jobs históricos de avatar y a sus voces asociadas.
- El componente conserva cuatro avatares y siete voces con estado `COMPLETED`.
- El borrador del editor incorporó los seis medios reasignados en la versión 27 y actualmente conserva la versión 32 después de ediciones posteriores y la normalización de etiquetas.
- Los reintentos futuros de voz y avatar conservan una ruta de recuperación durable.

La reasignación de las escenas 1, 3 y 7 es una excepción operacional autorizada: los medios se generaron con versiones anteriores de sus guiones. Para impedir que una recuperación futura los vuelva a clasificar como obsoletos, el componente conserva la huella vigente mientras `production_assets.metadata.forced_scene_assignment` registra tanto la huella histórica como la actual, el motivo, la escena y el identificador de reparación.

## 8. Acciones pendientes

### Obligatorias para cerrar esta lección

1. Abrir nuevamente el artefacto con una sesión válida; el borrador ya quedó sincronizado y cargará su versión vigente.
2. Reproducir las escenas 1, 3 y 7 para confirmar editorialmente que el audio histórico sigue correspondiendo al texto y orden visual deseados.
3. Revisar sincronización y duración antes de aprobar o renderizar.
4. Si algún guion histórico ya no es aceptable, regenerar únicamente esa escena desde el módulo de avatares; no repetir la reasignación completa.

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

La reparación de datos queda técnicamente cerrada porque:

- las escenas 1, 3 y 7 tienen modalidad `avatar` y medios completos;
- la lección contiene exactamente cuatro avatares y siete voces;
- los seis archivos reasignados existen en Storage, están enlazados al borrador y aparecen en el documento vigente;
- la operación conserva evento de auditoría y metadatos de procedencia reversibles;
- no se modificaron otras lecciones, componentes ni organizaciones.

Permanece como validación editorial reproducir las tres escenas reasignadas antes del render final.

## 12. Conclusión

No existía pérdida física de los videos o audios: el problema era de correlación y vigencia tras cambiar los IDs y guiones de escena. La solución general conserva historial, evita asociaciones automáticas ambiguas y protege futuras generaciones. Para esta lección concreta se aplicó, además, una reasignación externa y auditada de los tres pares video/voz solicitados. El componente y el editor ya reflejan cuatro avatares y siete voces; sólo falta la revisión editorial de reproducción.

## 13. Auditoría operacional de IDs históricos

Se ejecutó una auditoría externa de sólo lectura para determinar si era necesario reasignar manualmente assets cuyos IDs no coinciden con las escenas actuales.

Resultados:

- 10 jobs de HeyGen revisados.
- 14 assets de voz o avatar comprobados físicamente en Storage; faltantes: 0.
- 16 vínculos existentes en el borrador de la lección.
- 14 archivos de HeyGen cubiertos por esos vínculos; archivos sin cobertura: 0.
- Coincidencias seguras entre un ID histórico diferente y un guion vigente: 0.
- Tres jobs conservan los IDs `scene-1`, `scene-3` y `scene-7`, pero sus huellas corresponden a guiones anteriores.

Después de sincronizar, los seis medios objetivo no aparecen mediante sus IDs originales de proveedor en `video_composition_draft_assets`: el editor los representa con seis registros `SOURCE_MEDIA` canónicos que apuntan al mismo bucket y archivo. Los seis están enlazados y presentes en el documento activo; esto es el comportamiento esperado y no representa pérdida ni desvinculación.

La auditoría inicial concluyó correctamente que no existía una coincidencia automática segura. Posteriormente, con autorización explícita para reutilizar esos contenidos históricos, se ejecutó una reparación externa con simulación previa, validación de tenant, componente, lección, jobs y archivos físicos.

Mapeo aplicado:

- job `7adc8b88-d144-432a-9046-2528e1c54bfd` → `scene-1`;
- job `b71806d6-3cf1-4bf6-86e1-0f4bd62a3be2` → `scene-3`;
- job `d787704f-9b73-4f3a-9d9f-03f31d802199` → `scene-7`.

Trazabilidad:

- reparación: `e4087bef-a194-4d72-8685-b6a1e167880f`;
- evento: `b7d62951-513c-4900-aa07-4a6063a54dde`;
- tipo de evento: `HEYGEN_HISTORICAL_SCENE_FORCE_REMAP`;
- seis assets anotados con la huella histórica, la huella asignada, el motivo y la escena destino;
- borrador reconciliado de la versión 26 a la 27;
- resultado final verificado: cuatro avatares completos, siete voces completas y seis medios reasignados presentes en el documento activo.

## 14. Normalización de nombres de audio en el editor

Una auditoría posterior detectó nueve clips de voz cuyos assets ya tenían metadatos canónicos, pero cuyos documentos de composición conservaban etiquetas creadas antes del estándar actual:

- seis clips de la Lección 1.4 mostraban el UUID físico del archivo MP3;
- tres clips de la Lección 2.5 mostraban el formato corto `Voz · Escena N`;
- las demás voces vigentes del curso ya cumplían el estándar.

Se corrigió la reconciliación para que los clips vinculados a assets de Producción adopten también su etiqueta canónica. El estándar visible es:

```text
Lección <número>: <título> · Escena <NN> · Voz
```

La reparación actualizó únicamente documentos versionados:

- Lección 1.4: seis etiquetas, borrador 14 → 15;
- Lección 2.5: tres etiquetas, borrador 31 → 32;
- etiquetas fuera del estándar después de la operación: 0.

Los objetos de Storage no se movieron ni renombraron. Sus UUID permanecen como identidad física estable, mientras el nombre descriptivo se mantiene como metadato y etiqueta del editor. No cambiaron rutas, referencias, duraciones, posiciones, volumen ni contenido de audio.
