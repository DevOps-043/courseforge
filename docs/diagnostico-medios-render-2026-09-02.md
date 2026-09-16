# Render sin videos ni audio — 2 de septiembre de 2026

## Causa confirmada

El MP4 de la solicitud `0575e316-cf9b-4440-b23a-7207d3fc13da` tiene una sola pista: video H.264 de 230.48 segundos. No contiene pista de audio. Su importación a Storage había funcionado, pero el contenido ya llegó incompleto desde el proveedor.

Se descargó y examinó el ZIP exacto de la revisión `3a3dda16-993f-4c99-a683-b8185be697e0`. Los 10 elementos de video y 7 de audio carecían de `src`: usaban `data-hf-src`, que no es el atributo de sustitución de HyperFrames. Las diapositivas conservaban URLs directas, por eso sí aparecían.

El [contrato oficial de variables y medios](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-core/references/variables-and-media.md) especifica `data-var-src`. Además, el mezclador obtiene las pistas desde el HTML mediante `audio[id][src]`, antes de ejecutar las sustituciones del navegador. Corregir solo el nombre del atributo no basta para garantizar el audio.

Las 16 URLs del manifiesto se verificaron con HTTP HEAD y respondieron correctamente. No era necesario volver a generar los assets ni meter sus 77,173,028 bytes dentro del ZIP.

## Corrección

- El compilador genera `data-var-src`.
- Tras verificar tamaño y SHA-256 de la revisión, el envío prepara una copia temporal del ZIP y escribe las URLs autorizadas en los atributos `src`. Esto permite al decodificador de video y al mezclador de audio descubrir las fuentes antes de ejecutar JavaScript.
- La misma preparación corrige snapshots existentes con `data-hf-src`; se conserva el documento aprobado, sus recortes, volúmenes, pistas y tiempos.
- Las URLs firmadas quedan únicamente en la copia que se entrega a HeyGen. No se guardan en el snapshot inmutable.
- Si falta una URL o el identificador de una pista de audio, el envío falla antes de solicitar el render.
- La versión del contrato de medios forma parte de la identidad del trabajo y del snapshot, para no reutilizar resultados silenciosos anteriores.

La copia preparada del proyecto real pesa 53,594 bytes. Contiene 10 videos con `src` y 7 pistas `audio[id][src]`, sin atributos `data-hf-src`.

## Verificación

- TypeScript del proyecto y del conjunto HyperFrames aprobado.
- 4 pruebas de preparación del ZIP: fuentes explícitas para el mezclador/decodificador, compatibilidad con snapshots antiguos, URLs sin resolver, medios incompletos, seguridad básica de URLs y conservación del snapshot original.
- 22 pruebas del compilador aprobadas, incluidos recortes, offsets de clips divididos, audio separado, volumen de B-roll y mezcla de música.
- Comando reproducible: `npm run test:hyperframes-media -w apps/web`.

## Versión corregida del video

Se envió la misma revisión aprobada usando el servicio corregido, conservando el archivo anterior:

- Solicitud: `d964ecb4-418e-46bf-bc94-50a92dd03cad`.
- Trabajo: `1486f3c1-15f2-47cc-8344-108fa7e31722`.
- Render de HeyGen: `3a486aa7-e405-4fcd-9111-2d4a8ae5b245`.
- Inicio: 21:42:04 UTC / 15:42:04, Ciudad de México.

Resultado final:

- Estado del proveedor: `COMPLETED`; importación: `COMPLETED`; trabajo: `SUCCEEDED`.
- Finalización: 21:50:32 UTC / 15:50:32, Ciudad de México.
- Asset final: `dfadfcc1-5c9f-4a62-b4a1-a5d466c135bf`, 76,943,218 bytes, 230.48 segundos.
- Contenedor verificado con una pista H.264 y una pista AAC.
- Se midió audio no silencioso en ventanas de cinco segundos desde 0:00, 0:40, 1:45 y 3:15 (RMS entre 0.035 y 0.055).
- Se decodificaron y revisaron fotogramas a 0:05, 0:20, 0:44, 1:05, 1:20, 2:00, 2:55 y 3:25. Los tramos programados muestran diapositivas, avatar y B-roll; a 0:44 aparece el B-roll que antes se veía vacío.
- La URL del asset quedó vinculada a `material_components.assets.final_video_url` y el archivo corregido se abrió en la pestaña del navegador que contenía la versión anterior.

No se requieren nuevas migraciones SQL. El cambio permanente en la aplicación web se publica por el flujo Git/Netlify para que los próximos renders utilicen este contrato.
