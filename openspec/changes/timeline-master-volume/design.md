# Diseño

El maestro es un multiplicador lineal 0..1: 0 silencia, 1 conserva la mezcla.
No amplifica por encima del nivel base ni normaliza automáticamente. Se aplica
una sola vez al volumen efectivo y a todos los puntos de la envolvente final,
después de fades, ducking, curvas de autor y crossfade. Incluye voz, música, SFX,
audio de video e intro/outro que ya sean audibles; no reactiva pistas silenciadas.

`audioMix.masterVolume` es opcional, sin default insertado por el lector, para no
alterar hashes de documentos existentes. Ausente equivale a 1. Guardar el valor
neutral elimina el campo. La operación existente `audio-mix.update` acepta el
nuevo ajuste pero lo mantiene separado de `audioMix.ducking`. Inversa y diff
conocen el campo. El modelo runtime no recibe capacidades ni permisos adicionales.

El slider se muestra junto a la mezcla de voz, conserva borrador local y usa el
coordinador de autosave existente para guardar la última interacción. El resultado
se actualiza mediante el timeline/scene patch existente o el fallback autenticado.
No se añade una segunda ganancia WebAudio exclusiva del preview.

Compatibilidad: desplegar juntos lector, servidor y UI; lectores anteriores con
schema estricto no conocen este campo. Para revertir, mantener soporte de lectura
o guardar el maestro a 100% antes de retirar el soporte. Sin migración SQL.

Riesgos: duplicar la ganancia sobre curvas o dejar un baseline sin atenuar. Se
prueban nivel estático, curvas combinadas, silencio, valores inválidos, snapshots,
paridad del HTML, actualización en vivo y referencia PCM sintética local.
