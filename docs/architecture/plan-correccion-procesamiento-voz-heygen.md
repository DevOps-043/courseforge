# Plan de corrección del procesamiento de voz de HeyGen

Fecha: 2026-10-08. Estado: plan listo para implementación; sin cambios funcionales ni migraciones ejecutadas.

## 1. Entendimiento del objetivo

Hacer que las narraciones generadas por HeyGen puedan procesarse desde Ensamble, conservando el original, la autorización por organización, la trazabilidad y la sincronización audiovisual.

Orden de ejecución: clasificación → rutas de Storage → compatibilidad de formatos → integración y QA → despliegue controlado.

“Expansión de rutas” significa soportar las representaciones históricas y canónicas de objetos ya autorizados. No implica permitir buckets arbitrarios, URLs externas ni archivos del sistema operativo. La ampliación de formatos se realiza como etapa posterior independiente.

## 2. Diagnóstico técnico y evidencia

- El inspector habilita el tratamiento cuando el clip es AUDIO, pertenece a una pista VOICE y referencia un PRODUCTION_ASSET.
- El servidor exige asset_type VOICE_AUDIO y MIME MP3/WAV. No consulta los metadatos que identifican narraciones registradas como SOURCE_MEDIA.
- La sincronización de Producción crea registros SOURCE_MEDIA con metadata.timeline_role = VOICE. La importación de voz también puede usar metadata.import_type = voice. Esto explica que una narración reproducible sea rechazada por clasificación.
- La importación de HeyGen guarda storage_path con el prefijo del bucket. El creador del trabajo conserva esa ruta y el worker la pasa directamente a storage.from(bucket).download(path), que necesita la ruta interna del objeto.
- Los tipos y esquemas de API/worker excluyen M4A/AAC. El worker produce M4A, por lo que también deben revisarse las restricciones efectivas del bucket de salida.
- El mensaje observado ocurre antes de ejecutar FFmpeg. Una reproducción local confirma que SOURCE_MEDIA + audio/wav devuelve exactamente el mismo mensaje.
- Las suites existentes de audio aprobaron 22 pruebas web y 16 API. No cubren el recorrido completo HeyGen → Ensamble → Storage → worker.

Limitación: la consulta al recurso de staging no pudo completarse. El tipo y MIME del recurso concreto de la captura siguen pendientes de confirmar; no asumir que todos los archivos de HeyGen comparten contenedor o códec.

## 3. Plan de implementación

### Etapa 0 — Confirmar el recurso y preparar fixtures

1. Identificar el sourceAssetId enviado por el clip afectado y verificar su organización y componente.
2. Consultar únicamente clasificación, MIME, metadatos de procedencia, checksum, tamaño y representación de Storage.
3. Crear fixtures de una narración HeyGen directa, una narración sincronizada y un WAV separado de video. Usar archivos de prueba autorizados, sin secretos ni URLs firmadas en el repositorio.
4. Verificar la versión/capacidades de FFmpeg y ffprobe en el worker desplegado, su disponibilidad para reclamar trabajos y las restricciones reales de Storage.

Aceptación: el recorrido del recurso afectado queda documentado y reproducible. Las correcciones sustentadas por el código pueden avanzar aunque la inspección de staging siga pendiente; el cierre del incidente requiere esa validación real.

### Etapa 1 — Corregir la elegibilidad de narraciones

1. Extraer una política de elegibilidad con responsabilidad única en el dominio de audio-processing.
2. Admitir VOICE_AUDIO y SOURCE_MEDIA con función de voz acreditada por datos persistidos: timeline_role VOICE o import_type voice. Validar también MIME, estado activo y pertenencia al componente/organización.
3. Mantener excluidos música, efectos, recursos archivados y recursos sin procedencia de voz. No confiar en la pista o metadatos enviados por el navegador como autorización.
4. Leer metadata y qa_status desde production_assets en el servicio de creación del trabajo.
5. Exponer una capacidad de procesamiento y un motivo seguro al inspector mediante el contrato de recursos existente o una consulta autorizada. La API vuelve a validar al crear el trabajo.
6. Distinguir errores de clasificación, formato, integridad y tamaño. Conservar el código HTTP y el requestId del contrato de errores.

Decisión: conservar SOURCE_MEDIA como procedencia válida; no reclasificar masivamente registros, duplicar audios ni eliminar recursos históricos para corregir el botón.

Aceptación: MP3/WAV de voz directos y sincronizados se encolan; música y recursos ajenos se rechazan. Mostrar el botón y poder procesar utilizan criterios coherentes.

### Etapa 2 — Normalizar rutas de almacenamiento

1. Introducir un resolver puro de identidad de Storage: storageBucket + objectPath.
2. Aceptar tanto `production-assets/heygen/archivo.mp3` como `heygen/archivo.mp3` cuando el bucket persistido es production-assets. Retirar exactamente un prefijo coincidente; preservar el nombre real del objeto.
3. Rechazar rutas vacías, URLs, rutas absolutas locales, segmentos de traversal y discrepancias inequívocas entre bucket y ruta. No decodificar o transformar nombres de objetos de forma ambigua.
4. Mantener la lista de buckets autorizados; comprobarla antes de encolar y también en el worker.
5. Canonicalizar trabajos nuevos. Normalizar defensivamente snapshots históricos al descargarlos y verificar siempre el checksum.
6. Probar la idempotencia con representaciones equivalentes de la misma ruta. Revisar los trabajos fallidos existentes antes de habilitar reintentos explícitos y acotados; nunca reencolarlos en masa.

Decisión: adaptación al leer; no mover objetos ni reescribir todas las rutas persistidas. No exigir un prefijo organizations/ a objetos históricos de HeyGen: la autorización depende del registro validado y su organización/componente.

Aceptación: ambas representaciones descargan el mismo objeto y verifican los mismos bytes. Trabajos históricos mantienen compatibilidad; no se amplía el acceso a Storage.

### Etapa 3 — Ampliar formatos compatibles

1. Agregar M4A con MIME audio/mp4 y AAC con MIME audio/aac. Mantener MP3/WAV y normalizar aliases explícitos de MIME conocidos.
2. Actualizar de forma coordinada tipos, validación de creación, contratos web del worker y esquema efectivo del worker API. Usar un contrato común viable para ambos builds o pruebas de paridad explícitas; evitar dependencias web dentro del backend.
3. Revisar el importador de HeyGen: clasificación de MIME, extensión de salida y respuesta binaria. No etiquetar cualquier application/octet-stream como MP3 por defecto; los casos ambiguos necesitan inspección del contenido.
4. Ejecutar ffprobe sobre un archivo local verificado antes de convertir. Confirmar pista de audio, contenedor/códec admitido y duración finita positiva. Aplicar límites de duración/recursos definidos con fixtures representativos y mantener el límite vigente de 50 MB durante esta entrega.
5. Conservar conversión intermedia a PCM WAV y el perfil actual. No cambiar parámetros de compresión, sonoridad ni activar procesamiento neural como parte de la corrección.
6. Verificar MIME permitidos en buckets de entrada y salida. Si falta soporte, añadir una migración aditiva que preserve permisos y MIME existentes, con rollback documentado.
7. Desplegar primero el worker compatible con formatos antiguos y nuevos; habilitar nuevas entradas en la API después.

Aceptación: MP3, WAV, M4A y AAC válidos completan el trabajo. Archivos corruptos, disfrazados o sin audio producen errores específicos y seguros.

Extracción directa desde MP4/WebM: mejora opcional separada. El soporte inicial cubre narraciones y WAV ya separados por el editor; ampliar a videos requiere definir explícitamente elegibilidad, pista seleccionada y sincronización. No admitir cualquier video solo porque contiene audio.

### Etapa 4 — Completar el flujo del editor

1. Limpiar estado/error al cambiar el recurso seleccionado y respetar la respuesta real de jobId del POST.
2. Diferenciar fallo recuperable, incompatibilidad y trabajo activo, evitando solicitudes duplicadas y polling permanente tras fallos terminales.
3. Mostrar comparación Original/Procesado y verificar el flujo existente para incorporar el derivado a la composición. Si falta, añadir una acción explícita que reutilice el mecanismo de reemplazo de assets.
4. Preservar inicio, recorte, offset, volumen y fades al aplicar el resultado. Mantener original disponible para restauración.
5. Corregir la medición de duración del derivado para conservar precisión subsegundo: el worker actual usa Math.ceil. Validar el desfase y el retardo de codificación AAC con narración y avatar reales.

Aceptación: el usuario puede solicitar, comparar, incorporar y restaurar el audio sin perder ediciones ni sincronización. El procesamiento por asset se distingue del recorte aplicado a una instancia del clip.

## 4. Implementación propuesta: módulos y entregas

| Entrega | Archivos principales existentes | Responsabilidad |
| --- | --- | --- |
| Clasificación | apps/web/src/domains/production/audio-processing/audio-processing-job.service.ts; apps/web/src/domains/production/hyperframes/hyperframes-source-asset.service.ts | Política de narración y lectura de procedencia |
| Storage | audio-processing-job.service.ts; apps/api/src/features/audio-processing/audio-worker.ts | Canonicalización, compatibilidad histórica y descarga verificada |
| Formatos | apps/web/src/domains/production/audio-processing/audio-processing.types.ts; audio-processing-worker-contracts.ts; apps/api/src/features/audio-processing/audio-worker.ts; apps/web/src/domains/production/providers/heygen/heygen-audio-import.service.ts | Contratos coordinados, importación e inspección real |
| API/UX | apps/web/src/app/api/production/audio-processing/jobs/route.ts; apps/web/src/domains/materials/components/composition-editor/CompositionInspector.tsx; AudioProcessingControls.tsx | Capacidad visible, errores, seguimiento y aplicación del resultado |
| QA/operación | Tests de audio web/API; fixture HeyGen; supabase/migrations si hace falta | Regresión, recorrido real y soporte de Storage |

Crear módulos pequeños para política de fuentes y resolución de rutas; mantener controllers delgados y comandos FFmpeg como argumentos de execFile, sin interpolación en shell. Reutilizar servicios existentes cuando sus contratos sean adecuados.

## 5. Riesgos y validaciones

| Caso | Resultado esperado |
| --- | --- |
| VOICE_AUDIO MP3/WAV | Trabajo aceptado y derivado generado |
| SOURCE_MEDIA con procedencia VOICE | Aceptado sin cambiar asset_type |
| SOURCE_MEDIA de música o sin procedencia | Rechazado con causa específica |
| Recurso de otra organización/componente o archivado | Rechazado antes de acceder a Storage |
| Ruta con/sin bucket y snapshot histórico | Mismos bytes y checksum; sin doble prefijo |
| Bucket no permitido, URL o traversal | Rechazado sin descarga externa |
| M4A/AAC válidos; MIME ambiguo | Inspección real antes de procesamiento |
| Archivo corrupto, sin audio, checksum distinto, más de 50 MB | Error terminal específico; sin reintentos infinitos |
| Solicitudes repetidas/concurrentes | Idempotencia y leases existentes respetados |
| Fallo transitorio de Storage | Reintento acotado; original intacto |
| Cambio de selección y trabajo fallido | Estado correcto, sin errores de un recurso anterior |
| Clip recortado con avatar | Derivado aplicado conservando timing, offsets y fades |

Ejecutar `npm run test:audio-processing` en apps/web y apps/api, las pruebas focalizadas nuevas y un smoke de FFmpeg en la imagen real del worker. Completar QA manual en staging con la escena afectada, comparación audible y comprobación de preview/exportación. Las pruebas unitarias por sí solas no cierran el incidente.

Observabilidad: registrar requestId, jobId, sourceAssetId, perfil y código seguro de etapa/error. No registrar credenciales, URLs firmadas, narración o bytes. Medir rechazos por motivo, fallos de descarga, tiempo en cola y duración de procesamiento.

Despliegue revisado durante implementación: migración aditiva (MIME, precisión y contador de claims compatible con workers anteriores) → worker compatible → API/UI → prueba con un recurso → ampliación gradual. El nuevo contador debe existir antes de activar el límite de reintentos del worker. Rollback: deshabilitar nuevas entradas antes de revertir workers y dejar finalizar trabajos compatibles; conservar originales y derivados. No reducir restricciones de Storage mientras existan trabajos dependientes.

## 6. Mejoras adicionales recomendadas

Deseables y fuera de la corrección inicial: procesamiento directo de videos, lotes de narraciones, limpieza neural y revisión de límites para audios largos. No ampliar límites de memoria/concurrencia ni regenerar voces HeyGen para solucionar este defecto.

Definición de terminado: la escena afectada y los fixtures completan el recorrido; el derivado pasa QA de sonoridad y sincronización, puede usarse/restaurarse desde el editor y los controles multi-tenant y de integridad siguen funcionando. Clasificación y rutas no requieren una migración masiva de datos.

## Estado de implementación — 2026-10-08

Las etapas de clasificación, rutas, formatos y controles del editor están implementadas y verificadas localmente. Se añadió la migración aditiva y pruebas del procesamiento con FFmpeg real, aplicación/restauración y contratos SQL. La entrega, evidencias, límites y requisitos de rollout están documentados en [qa-correccion-procesamiento-voz-heygen.md](qa-correccion-procesamiento-voz-heygen.md). La escena real de staging y su preview/exportación quedan para la aceptación posterior al despliegue; no se declara cerrado el incidente en el ambiente publicado.
