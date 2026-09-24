# Licencias y aprobación de modelos de audio

## Alcance

Courseforge ejecutará los workers de audio en infraestructura administrada por
la organización. Si una imagen se entrega a otra entidad, la revisión debe
cubrir expresamente esa distribución. La aprobación de calidad de audio es un
paso posterior e independiente.

| Componente | Código | Modelo seleccionado | Estado de la licencia del modelo |
| --- | --- | --- | --- |
| DeepFilterNet | MIT o Apache-2.0; Courseforge selecciona Apache-2.0 | `DeepFilterNet3_onnx.tar.gz` del commit aprobado | Pendiente de referencia documental sobre el alcance de la licencia del modelo. |
| RNNoise | BSD-3-Clause; `COPYING` del commit `70f1d256acd4b34a572f999a05c87bf00b67730d` | Tarball SHA-256 `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37` | Pendiente de referencia documental sobre los pesos descargados por separado. |

DeepFilterNet incluye el ONNX en su repositorio y en la compilación por defecto;
su README declara la doble licencia para «todo el código». Las consultas
[DeepFilterNet #709](https://github.com/Rikorose/DeepFilterNet/issues/709)
y [RNNoise #284](https://github.com/xiph/rnnoise/issues/284) piden aclarar
expresamente los pesos. Son preguntas abiertas, no declaraciones de prohibición.

## Cómo registrar una decisión

1. Identificar fuente, commit/tag, SHA-256 del modelo y modalidad de uso de la
   imagen (interna o entregada a terceros).
2. Conservar la fuente que sustenta los términos del modelo y el dictamen de
   cumplimiento con un identificador estable. Una licencia del código no sirve
   como única evidencia de los términos de pesos obtenidos por separado.
3. Preparar el bundle en almacenamiento privado. Incluir el binario, modelo,
   licencias de código originales, avisos de dependencias Rust para DeepFilterNet
   y, para RNNoise, el documento aplicable al modelo. Registrar el SHA-256 de
   cada archivo en `manifest.json`.
4. Completar `codeLicense`, `modelLicense` y `reviewReference`. Cambiar el
   indicador de aprobación solo después del dictamen. Los ejemplos mantienen
   `modelLicense: "PENDING_REVIEW"` y aprobación `false`.
5. Ejecutar el verificador correspondiente y construir una imagen candidata.
   Conservar el manifiesto, textos de licencia, SBOM, versión y configuración de
   FFmpeg junto con la imagen. Activar el perfil tras las pruebas auditivas.

Los verificadores comprueban integridad y que exista una decisión registrada;
no sustituyen la evaluación jurídica. La imagen DeepFilterNet usa el Environment
protegido `deepfilter-artifacts`. Aún no existe una imagen RNNoise publicable.

Fuentes: [licencia de DeepFilterNet](https://github.com/Rikorose/DeepFilterNet/blob/main/LICENSE),
[licencia de RNNoise](https://github.com/xiph/rnnoise/blob/main/COPYING),
[términos de FFmpeg](https://ffmpeg.org/legal.html).
