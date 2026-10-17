# Corrección del procesamiento de voz HeyGen — entrega previa a QA

Fecha: 2026-10-08. Estado: implementación y validación local completadas; despliegue y aceptación de la escena real pendientes.

## 1. Objetivo y alcance

Implementar el plan revisado: aceptar narraciones con procedencia verificable, resolver rutas históricas de Storage, admitir MP3/WAV/M4A/AAC y permitir comparar, aplicar y restaurar el resultado conservando la edición. El procesamiento sigue usando el perfil `voice-course-v1`; no cambia la cadena de filtros ni activa limpieza neural.

Límites de esta entrega: 50 MB de entrada/salida y 30 minutos de audio. El límite de duración acota CPU/memoria y mantiene la salida AAC de 192 kbps dentro del límite de tamaño. No se permite procesar videos directamente.

## 2. Diagnóstico y corrección

| Defecto | Corrección implementada |
| --- | --- |
| Validación limitada a `VOICE_AUDIO`, aunque Ensamble usa `SOURCE_MEDIA` con procedencia de voz | Política central acepta `VOICE_AUDIO` y `SOURCE_MEDIA` con `timeline_role=VOICE` o `import_type=voice` persistidos. Música, recursos sin procedencia, archivados y rechazados quedan excluidos. |
| Rutas históricas incluyen el bucket y la descarga lo vuelve a añadir | Resolución canónica del objeto en API y worker, con compatibilidad para snapshots históricos. Rechaza URLs, traversal, buckets ajenos y prefijos cruzados. |
| Contratos restringidos a MP3/WAV | Contratos web/API equivalentes y prueba de paridad; soporte M4A/AAC en procesamiento, importación, recuperación y restricciones de medios del editor. |
| `application/octet-stream` interpretado como MP3 | Inspección de firma binaria en el importador, extensión según contenedor; `ffprobe` confirma códec, pista de audio y duración antes de convertir. |
| Resultado M4A incompatible con el reemplazo en la composición | Editor admite M4A/AAC. El servidor permite sustituir voz de una escena emparejada exclusivamente por un derivado verificado del mismo original/componente, o restaurar ese original. El navegador no puede autorizar la excepción. |
| Duración redondeada y padding AAC | Duración de PCM decodificado persistida en milisegundos; firma RPC de segundos enteros conservada para workers anteriores. |
| Seguimiento impreciso y errores reutilizados entre selecciones | Polling por `jobId` devuelto, cancelación al cambiar de selección, capability visible, comparación original/procesado y aplicación/restauración explícitas. |
| Reintentos automáticos sin límite | Contador atómico por claim; máximo de tres intentos automáticos para errores transitorios. Fallos de integridad/formato son terminales. Reintento manual únicamente para trabajo fallido solicitado explícitamente. |

Autorización por organización/componente, checksum y leases siguen siendo obligatorios. El reemplazo conserva inicio, duración del clip, offset, volumen, fades, pista y escena; no modifica el avatar ni el original. No hay reclasificación ni reencolado masivo.

## 3. Implementación y módulos afectados

- `apps/web/src/domains/production/audio-processing/`: contratos, política de elegibilidad, resolución de fuentes/originales, rutas, importación binaria y relación original/derivado.
- `apps/api/src/features/audio-processing/`: contrato del worker, probe local, errores terminales/transitorios, duración precisa, límites y reintentos.
- `apps/web/src/app/api/production/audio-processing/jobs/route.ts`: autorización, capability, creación y consulta de trabajo; respuestas de consulta sin caché.
- `apps/web/src/domains/materials/components/composition-editor/`: controles de tratamiento y conexión con el inspector.
- `apps/web/src/domains/production/composition-editor/`: autorización y aplicación del reemplazo verificado, con pruebas de regresión.
- `apps/web/src/domains/production/hyperframes/`: rutas de derivados y formatos de audio admitidos.
- `apps/web/src/domains/production/providers/heygen/heygen-audio-import.service.ts`: importación y recuperación MP3/WAV/M4A/AAC.
- `supabase/migrations/20261009090000_fix_voice_audio_processing_compatibility.sql`: MIME aditivos, duración en milisegundos y contador de claims, manteniendo firmas RPC y permisos `service_role`.

Los contratos de fuente se replican en los dos builds desplegados independientemente; la prueba de paridad impide divergencias sin introducir dependencias del backend hacia Next.js.

## 4. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npm run test:audio-processing` en web | 30 pruebas aprobadas |
| `npm run test:audio-processing` en API | 20 pruebas aprobadas |
| Editor: patch, persistencia del documento y fuentes HyperFrames | 113 pruebas aprobadas |
| Build TypeScript de API | Aprobado |
| Compilación focalizada de HyperFrames/editor | Aprobada |
| Worker con FFmpeg/ffprobe reales y cuatro formatos | Aprobado: checksum, ruta histórica, sonoridad, waveform, duración y rechazo de corruptos |
| Controles React reales en Chrome con API de prueba | Aprobado: solicitud, seguimiento por ID, aplicación, restauración y rechazo visible de música |
| Migración y RPC en PostgreSQL aislado (PGlite 0.3.14) | Aprobado: precisión, firma legacy, permisos, lease, ruta de salida de la organización y contador atómico |

Evidencias conservadas en [evidence/voice-audio-compatibility](evidence/voice-audio-compatibility/evidence.json), [controles](evidence/voice-audio-compatibility/controls-evidence.json) y [migración](evidence/voice-audio-compatibility/migration-evidence.json).

Los cuatro fixtures son tonos sintéticos de 6.375 segundos; no son narraciones descargadas de HeyGen. MP3/WAV/M4A conservan 6375 ms; AAC ADTS decodifica 6400 ms por padding del formato. La duración del contenedor de salida es 6.4 s, pero la composición usa los milisegundos de PCM, evitando el redondeo previo a 7 s. Sonoridad medida entre −16.01 y −15.95 LUFS; todos pasan el criterio actual.

La prueba usa FFmpeg 9.0 en Windows. El smoke de la imagen del worker ya incluye los cuatro formatos y debe ejecutarse durante su construcción; no se construyó ni desplegó la imagen Docker en esta sesión. Supabase del smoke es un fake; la prueba SQL utiliza tablas de contrato aisladas, no la base remota.

El chequeo global `npx tsc --noEmit --pretty false` señala imports sin uso en `domains/syllabus/import/syllabus-import.service.ts` (`SyllabusImportRecord`) y `domains/syllabus/services/syllabus.service.ts` (`runAllValidations`), procedentes de cambios de temarios ajenos a esta entrega. No hay errores de voz en ese chequeo. No se modificaron esos archivos.

Se realizó una consulta remota de solo lectura, limitada al ID del artefacto de la captura; el entorno Supabase configurado devolvió cero assets de ese curso. No se pudo validar una narración de la escena afectada. No se modificaron datos remotos.

### Reproducibilidad

Desde cada aplicación: `npm run test:audio-processing`. Desde `apps/api`: `npm run build`. Desde `apps/web`: `npx tsc -p tsconfig.hyperframes-test.json`, seguido de `node --test` para los tres archivos compilados `editor-patch.service.test.js`, `composition-document.service.test.js` y `hyperframes-source-asset.service.test.js` bajo `.tmp/hyperframes-tests/domains/production/`.

Desde la raíz, con `ffmpeg` y `ffprobe` en PATH: `node scripts/run-voice-audio-compatibility-smoke.cjs` y `node apps/api/dist/features/audio-processing/qa/run-audio-ffmpeg-smoke.js`. Controles: `node scripts/run-voice-audio-controls-smoke.cjs`, con dependencias del runtime controlado instaladas y Chrome local.

SQL: empaquetar `@electric-sql/pglite@0.3.14` en `.tmp`, extraer el tarball en `.tmp/voice-audio-pglite` (debe existir `package/dist/index.cjs`) y ejecutar `node scripts/test-voice-audio-migration.cjs`. Es una dependencia temporal de verificación; no se agrega al producto.

## 5. Despliegue y revisión de resultados

Orden actualizado por el contador de intentos: **migración aditiva → worker compatible → API/UI → smoke de una narración en staging → QA**. La migración conserva los contratos previos; el nuevo worker necesita el contador para limitar reintentos correctamente. No habilitar nuevas entradas con workers antiguos.

Antes de staging, resolver los dos imports de temarios en su cambio correspondiente para que el build global pueda quedar limpio. Aplicar únicamente las migraciones pendientes según el procedimiento habitual; no ejecutar SQL manual sobre producción desde esta entrega.

QA revisa resultados sobre la escena original de HeyGen y un clip recortado con avatar:

1. Solicitar tratamiento: debe ser aceptado y completar con un derivado, sin regenerar la voz.
2. Escuchar Original/Procesado: comprobar claridad, ausencia de clipping y final íntegro.
3. Usar procesado: comprobar inicio, recorte, offset, volumen, fades y sincronización de avatar en preview.
4. Guardar y recargar: confirmar selección y waveform del derivado.
5. Restaurar original: comprobar que conserva las mismas decisiones de edición.
6. Exportar un clip representativo: confirmar formato, duración audible y sincronización en la salida final.

Esta lista es aceptación del resultado; no requiere que QA diagnostique o implemente correcciones. La validación del render/exportador y de la escena real sigue pendiente hasta desplegar en el entorno correcto.

Rollback: retirar primero la habilitación de nuevos formatos/API si surge una regresión; conservar los objetos originales y derivados, los MIME aditivos y el contador. Revertir funciones/worker solo después de drenar trabajos compatibles y revisar referencias; no borrar ni convertir assets históricos.

## 6. Mejoras fuera de alcance

Extracción desde video, lotes y limpieza neural permanecen separados. La entrega no amplía concurrencia ni memoria, no incorpora nuevas dependencias de producción y no cambia el perfil sonoro. La aceptación final del incidente depende del recorrido de staging y la revisión audible/sincronización, no únicamente de pruebas locales.
