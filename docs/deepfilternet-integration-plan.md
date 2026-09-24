# Plan de integración: DeepFilterNet para limpieza neural de voz

**Estado:** integración y POC técnico preparables; imagen publicable y uso en producción sujetos a la revisión de los términos del modelo ONNX.

## Decisión

Usar el binario Rust `deep-filter` de DeepFilterNet dentro del worker de audio,
exclusivamente para fuentes de narración. No usar Python, PyTorch ni GPU para
el primer POC. FFmpeg conserva la conversión de formatos y el finishing de
audio; DeepFilterNet realiza únicamente la mejora neural.

```text
asset VOICE_AUDIO original
  -> FFmpeg: WAV PCM, mono, 48 kHz
  -> deep-filter: modelo ONNX fijado y --compensate-delay
  -> FFmpeg: high-pass, compresión, limitador y loudness
  -> PROCESSED_AUDIO en READY_FOR_QA
```

## Perfil experimental

`voice-clean-neural-dfn3-v1`:

- modelo: `DeepFilterNet3_onnx.tar.gz`;
- post-filter: desactivado;
- compensación de delay: activada;
- límite de atenuación: conservador y pendiente de calibración;
- salida intermedia: WAV; salida final: M4A;
- activación: manual y con comparación A/B.

El perfil no aplica a música, SFX, mezcla final, ni variantes que ya fueron
procesadas. El original se conserva siempre.

## Artefactos inmutables exigidos

La imagen del worker debe registrar y validar:

- tag y commit de DeepFilterNet;
- SHA-256 del binario `deep-filter`;
- SHA-256 del archivo de modelo ONNX;
- versión y build configuration de FFmpeg;
- licencia/notices y SBOM de las dependencias de Rust.

El job y el asset derivado deben conservar `deepfilter_version`, `model_id`,
`model_sha256`, `delay_compensated`, perfil y versiones de FFmpeg.

## Gate de licenciamiento

El checkout local declara que el **código** está disponible bajo MIT o
Apache-2.0; Courseforge selecciona Apache-2.0 y el bundle conserva ambos textos.
El modelo ONNX está en el repositorio y puede evaluarse técnicamente, pero el
README no nombra expresamente los pesos en su declaración de licencia. Antes
de publicar una imagen con el modelo se debe registrar una decisión documental
para el archivo/tag exactos y revisar las licencias de dependencias del binario.
Véase [el registro de licencias de audio](./compliance/audio-model-licenses.md).

No se deben empaquetar las muestras ni datasets de entrenamiento; algunos
assets del repositorio tienen licencias Creative Commons ajenas a la inferencia.

## POC y criterios de salida

1. Ejecutar sobre un corpus aprobado de narraciones en español con ruido,
   reverberación leve, distintos micrófonos y voces limpias de control.
2. Comparar sin limpieza, FFmpeg clásico, DFN3 estándar y DFN3 low-latency.
3. Medir duración, clipping, loudness, true peak y degradación de transcripción.
4. Hacer escucha A/B ciega con el especialista.
5. Aprobar únicamente si la inteligibilidad no empeora y los artefactos no son
   perceptibles en casos comunes.

## Orden de implementación

1. Confirmación de licencia de pesos y selección de release/modelo.
2. Publicar artefactos con checksums en almacenamiento interno de build.
3. Construir la imagen separada `audio-worker-neural` con `deep-filter` y el
   modelo fijados, tras la validación de artefactos aprobados.
4. Añadir el perfil experimental, preflight WAV/48 kHz y metadatos.
5. Ejecutar POC offline; no exponer controles al usuario final.
6. Convertir el perfil en productivo únicamente después de aprobación de audio.
