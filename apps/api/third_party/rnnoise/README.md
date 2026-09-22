# Artefactos RNNoise sujetos a aprobación

Este directorio no versiona pesos ni binarios. `manifest.example.json` es solo
un esquema: **no es una aprobación**. La fuente queda fijada al commit
`70f1d256acd4b34a572f999a05c87bf00b67730d` y el tarball upstream al
SHA-256 indicado en `model_version`.

Un paquete aprobado deberá contener exactamente el tarball original, los
archivos `rnnoise_data.c` y `rnnoise_data.h` extraídos de él, el blob binario
derivado con `dump_weights_blob`, un aviso `MODEL-LICENSE` aplicable al modelo
exacto y `manifest.json` con hashes verificables y referencia de aprobación.
La correspondencia entre tarball, C/header y blob deberá comprobarse durante
la compilación; verificar solo hashes individuales no demuestra esa relación.

`node scripts/verify-rnnoise-artifacts.mjs` valida el manifiesto y falla si
falta la aprobación explícita de redistribución de la imagen. El verificador
no descarga ni compila los pesos. Hasta disponer de la aprobación, no se
construye ni publica una imagen RNNoise y el perfil permanece deshabilitado.
