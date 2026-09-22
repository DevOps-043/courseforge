# Artefactos aprobados de DeepFilterNet

Este directorio no contiene pesos ni binarios versionados por Git. El pipeline
de CI debe obtenerlos desde el release aprobado, validar sus checksums y crear
un `manifest.json` local a partir de `manifest.example.json`.

Archivos esperados:

- `deep-filter`: binario Linux ejecutable;
- `DeepFilterNet3_onnx.tar.gz`: modelo ONNX aprobado;
- `LICENSE-MIT`, `LICENSE-APACHE` y notices aplicables;
- `manifest.json`: procedencia, checksums y aprobación de cumplimiento.

Los nombres están fijados por contrato: `deep-filter` y
`DeepFilterNet3_onnx.tar.gz`. Esto elimina ambigüedades entre el manifiesto,
el build y el worker.

`Dockerfile.audio-worker-neural` ejecuta esta verificación durante el build y
falla antes de copiar los artefactos a la imagen final:

```bash
npm run verify:deepfilter-artifacts -w apps/api
```

La imagen neuronal fija las rutas y checksums de ejecución desde el manifiesto
incluido. No se deben inyectar rutas o checksums `DEEPFILTER_*` diferentes en
el despliegue: el proceso se detendrá para impedir usar un artefacto distinto.

## Build de la imagen neuronal

El workflow manual
`.github/workflows/build-audio-worker-neural.yml` no forma parte del pipeline
general. Debe ejecutarse únicamente desde el Environment protegido
`deepfilter-artifacts`, tras aprobar los artefactos. Este Environment necesita:

- secrets: `DEEPFILTER_ARTIFACT_BUNDLE_URL` y
  `DEEPFILTER_ARTIFACT_BUNDLE_SHA256`;
- variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ARTIFACT_REPOSITORY`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER` y `GCP_SERVICE_ACCOUNT`.

El bundle HTTPS, que no vive en Git, debe contener exclusivamente
`manifest.json`, `deep-filter`, `DeepFilterNet3_onnx.tar.gz`, `LICENSE-MIT` y
`LICENSE-APACHE`. El workflow valida primero el checksum del bundle y después
el manifiesto y hashes individuales. El build tiene dos barreras independientes:

1. `verify:deepfilter-artifacts` comprueba el manifiesto, aprobación y hashes.
2. El Dockerfile exige una versión exacta de FFmpeg mediante el input manual
   `ffmpeg_package_version`.

No promover la etiqueta `candidate` a producción sin una prueba auditiva y de
regresión de las voces de referencia.
