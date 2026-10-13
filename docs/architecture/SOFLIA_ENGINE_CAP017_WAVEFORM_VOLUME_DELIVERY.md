# CAP-017 — ondas de fuente y volumen por puntos

Fecha: 2026-10-13. Entrega de código y validación local; migración, despliegue y aceptación de un proyecto real pendientes.

## 1. Objetivo y alcance

Mostrar ondas de las fuentes de producción —voz, música y audio integrado en video— sin aplicarles tratamiento de voz. Permitir atenuaciones por puntos que se guardan en el documento y usan la misma evaluación en preview y render.

Se integra en el editor de lecciones y en Ensamble standalone con componente de respaldo. La reconstrucción HTML independiente (`componentId=null`), la biblioteca experimental `SOUND_EFFECT_ASSET` y los recursos `ASSEMBLY_BRAND_ASSET` necesitan sus propios adaptadores de autorización/análisis; esta entrega no amplía sus permisos ni los presenta como cubiertos.

## 2. Diagnóstico

La versión anterior exigía `PROCESSED_AUDIO`, ligaba la lectura de ondas a metadatos de loudness y calculaba extremos después de convertir a mono/400 Hz. Entregaba un LOD fijo para todo el archivo y el timeline dibujaba únicamente clips AUDIO. Las automatizaciones existentes procedían de fades, ducking y crossfades; no había puntos editables persistentes.

La onda fuente y la curva de atenuación se mantienen diferenciadas: cambiar un punto no altera los picos almacenados ni reescribe el archivo. Una waveform no sustituye la medición de LUFS/true peak ni la escucha de la mezcla.

## 3. Diseño implementado

### Worker y persistencia

- Perfil independiente `waveform-analysis-v2` sobre la cola AUDIO_PROCESSING y sus leases. Los workers antiguos no anuncian este perfil.
- Verificación de organización, componente, estado, identidad de Storage y checksum antes de decodificar. Solo se usan archivos internos y demuxers permitidos; se excluyen protocolos de red y playlists.
- FFmpeg entrega PCM flotante a la frecuencia original, manteniendo canales. El acumulador procesa chunks, conserva extremos por canal y genera la pirámide sin cargar todo el PCM en memoria.
- Límites: fuente de 250 MB, 30 minutos, 8–192 kHz, hasta ocho canales, 65 536 buckets por canal, derivado JSON de 32 MB y decodificación de siete minutos. Un formato o tamaño no admitido falla explícitamente.
- El RPC `complete_audio_waveform_job` comprueba lease y checksum fuente bajo locks, actualiza únicamente metadatos y completa el trabajo de forma atómica. Un video sin audio queda como `NO_AUDIO`.
- La recuperación de leases expirados se limita al perfil nuevo. Tras tres intentos interrumpidos queda FAILED; no cambia la recuperación de los perfiles de tratamiento de voz.
- Los fallos registran código seguro y jobId; no URLs firmadas, tokens ni contenido multimedia.

### Lectura y timeline

- Lectura independiente de metadatos de loudness; mantiene compatibilidad con derivados v1 y valida v2, checksum, duración, canales y secuencia de LOD.
- GET acepta `start`, `end` y `width`; selecciona detalle y devuelve solo los buckets del intervalo. Cada lectura vuelve a autorizar el recurso.
- Caché de derivados verificados por organización/ruta/checksum: TTL de 60 segundos, hasta 16 entradas y presupuesto estimado de 64 MB por proceso. No sustituye autorización.
- El cliente analiza recursos referenciados con concurrencia tres, seguimiento por jobId, cancelación, espera acotada y reintento explícito de fallos. No normaliza ni reemplaza medios.
- El SVG representa canales separados. Zoom, scroll horizontal y recortes solicitan el tramo visible; las lecturas de detalle tienen debounce, límite de concurrencia, cancelación y caché por checksum.

### Volumen por puntos

- Campo opcional `volumeEnvelope`: máximo 128 puntos de tiempo de fuente/ganancia, ordenados, únicos y finitos. Los documentos anteriores conservan su comportamiento.
- Operación `clip.volume-envelope` mediante el mecanismo existente de patches, persistencia e historial. Respeta pistas bloqueadas y fuentes con audio confirmado.
- Curva por clic, edición numérica de tiempo/dB, eliminación, restablecimiento y guardado explícito. 0 dB conserva el nivel; el control usa −60 dB como silencio. Esta versión atenúa, no amplifica por encima del volumen base.
- Interpolación lineal de amplitud; fuera de los puntos se mantiene el primer/último nivel. Sin puntos equivale a ganancia uno.
- Los puntos usan coordenadas de fuente: el recorte y la división ordinarios conservan el nivel del contenido. Reiniciar el asset elimina también la curva.
- La evaluación contempla los handles de audio de las transiciones. Ganancia de clip/pista, fades, ducking y crossfade se combinan con la curva. Los productos de rampas se subdividen de forma determinista en 16 segmentos y se serializan igual para preview/render/referencia.
- La proyección incluye los puntos exactos; un descenso breve no desaparece por muestreo uniforme del gráfico.
- Cambiar volumen o visibilidad en una composición con curvas fuerza recompilación de preview, evitando que un patch escalar sobrescriba una automatización temporal.

## 4. Activación y rollback

1. Aplicar según el procedimiento de staging la migración aditiva `20261013120000_complete_audio_waveform_analysis.sql`, después de las migraciones previas de la cola de audio.
2. Construir y desplegar el worker compatible. Ambas imágenes incorporan `run-waveform-ffmpeg-smoke` como gate de build; el FFmpeg recortado de Remotion no sirve para este procesamiento.
3. Desplegar API y UI con el lector nuevo. Verificar primero análisis, carga y recarga de una voz, una música y un video.
4. Habilitar `NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED=true` en servidor y build web para permitir autoría de curvas. La flag no desactiva la lectura/reproducción de curvas existentes y permite retirarlas mediante patches.
5. Validar un proyecto autenticado y su exportación antes de dar aceptación de producción.

No se aplicó SQL remoto ni se activaron flags o despliegues durante esta entrega.

Rollback operativo: deshabilitar autoría y conservar el lector compatible; dejar de anunciar el perfil de análisis al drenar workers. No borrar derivados referenciados ni originales. **Un lector antiguo con Zod estricto no entiende `volumeEnvelope`: no desplegarlo sobre documentos nuevos sin una conversión explícita y reversible.**

## 5. Validación y reproducción

Desde la raíz:

```powershell
npm run test:audio-processing
npm run test:composition-audio-editing
npm run typecheck
npm run build -w apps/api
node scripts/test-waveform-analysis-migration.cjs
node scripts/run-waveform-editor-controls-smoke.cjs
# Requiere ffmpeg/ffprobe completos en el PATH de este proceso:
node scripts/run-waveform-worker-smoke.cjs
node apps/api/dist/features/audio-processing/qa/run-waveform-ffmpeg-smoke.js
```

El test SQL usa el PGlite temporal ya provisionado en `.tmp/voice-audio-pglite/package`; no accede a Supabase remoto. El smoke React usa Chrome y la dependencia Puppeteer ya existente del runtime controlado, con una API HTTP local de fixtures.

Validado localmente:

- `test:audio-processing`: 58 pruebas aprobadas; `test:composition-audio-editing`: 96 pruebas aprobadas.

- Suite de procesamiento: picos de 1 kHz, estéreo en oposición de fase, chunks no alineados, contratos, checksums, fuentes obsoletas, ventanas, caché, autorización y cancelación de solicitudes en cola.
- Suite del editor: composición de ganancias, trim/split, reset, handles, documentos previos y serialización igual entre preview y render, más regresiones existentes.
- PostgreSQL aislado: perfil, lease, completado único, checksum cambiado, ruta ajena, preservación del original, NO_AUDIO, recuperación y grants exclusivos de service_role.
- Chrome: solicitud, polling por ID, canales, zoom/scroll/trim del intervalo visible, guardado de puntos y controles bloqueados.
- Worker real con WAV estéreo, MP3, MP4 con audio y MP4 sin audio: originales intactos, waveform v2 y NO_AUDIO correctos.

Para esta última prueba se descargó y verificó una copia temporal de FFmpeg 9.0.2 Essentials de [Gyan](https://www.gyan.dev/ffmpeg/builds/), proveedor enlazado por [FFmpeg](https://ffmpeg.org/download.html). Archivo SHA256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`. Permanece en `.tmp/waveform-ffmpeg-runtime`; no se instaló ni cambió el PATH del sistema.

## 6. Límites y siguientes validaciones

- Quedan pendientes el build de las imágenes en su entorno final, la escena autenticada, escucha humana y medición del MP4 exportado. Comparar envelopes serializadas no demuestra por sí solo conformidad del renderer/provider.
- No se certifican loops que excedan la fuente: la onda sigue representando el intervalo disponible del archivo, y los puntos mantienen su extremo fuera del rango definido. Antes de ampliar esta cobertura, definir y probar cómo se repiten waveform y curva, incluyendo normalización de offsets en cortes.
- La cancelación del navegador cancela consultas; el trabajo idempotente ya encolado puede terminar para reutilizar su derivado. No se cancela un análisis compartido al desmontar una vista.
- No hay prueba de carga de 100 000 usuarios. La decodificación se desacopla mediante cola y workers; dimensionar almacenamiento, pool, backpressure y capacidad con mediciones de uso real. El presupuesto de caché es por proceso y no equivale a un caché distribuido.
- Para SFX, branding y borradores independientes, añadir resolutores autorizados específicos sobre sus registros/enlaces. No ampliar la consulta de production_assets ni asumir ownership por UUID.
