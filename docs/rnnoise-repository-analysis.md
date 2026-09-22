# Análisis del checkout de RNNoise

**Fecha:** 2026-09-22  
**Checkout analizado:** `D:\Pulse Hub\rnnoise`, `xiph/rnnoise` commit `70f1d256acd4b34a572f999a05c87bf00b67730d` (`v0.2-22-g70f1d25`, 2025-02-22).  
**Alcance:** inspección de código y licencias; no se descargaron pesos, no se compiló ni se procesó audio.

## Resultado ejecutivo

RNNoise ofrece supresión de ruido de voz mediante una biblioteca C y un modelo entrenado. Es viable como candidato para un worker offline de Courseforge, con FFmpeg antes y después del denoiser. Este checkout **no** contiene los pesos necesarios para compilar la configuración predeterminada. La licencia BSD de tres cláusulas cubre el código; no encontramos en el checkout una declaración separada y explícita para la redistribución del archivo de pesos que descarga el build. No habilitar ni distribuir una imagen RNNoise hasta resolver este punto para el modelo exacto.

## Lo que aporta el repositorio

| Elemento | Evidencia | Consecuencia para Courseforge |
| --- | --- | --- |
| API de inferencia C | `include/rnnoise.h`: `rnnoise_create`, `rnnoise_process_frame`, `rnnoise_destroy` | Requiere un adaptador o proceso nativo; no hay API Node ni servicio HTTP listos. |
| Modelo predeterminado incorporado en la compilación | `src/denoise.c`, `Makefile.am` | Construir la biblioteca predeterminada incluye pesos descargados durante el build. |
| Modelo cargable opcional | `README`, `rnnoise_model_from_file` | Permite una separación técnica de código y pesos, pero no resuelve por sí misma el permiso de redistribución. |
| Ejemplo CLI | `examples/rnnoise_demo.c` | Lee/escribe PCM raw `s16` mono a 48 kHz; no acepta WAV, MP3 ni M4A. |
| Tamaño de cuadro | `src/denoise.h`: 480 muestras | Cada llamada procesa 10 ms a 48 kHz; la continuidad del estado entre cuadros es obligatoria. |
| Descarga de modelo | `autogen.sh` → `download_model.sh` → `model_version` | `autogen.sh` hace una descarga de red y extrae un tarball; debe controlarse en una compilación reproducible. |
| Licencia del código | `COPYING` | BSD de tres cláusulas: avisos de copyright, texto de licencia y no usar nombres de titulares para promoción. |

`model_version` fija el SHA-256 `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`, que da nombre al tarball `rnnoise_data-<sha256>.tar.gz`. En el checkout no aparecen `src/rnnoise_data.c` ni `src/rnnoise_data.h`. El script verifica el SHA-256 si `sha256sum` está disponible, pero permite continuar sin esa herramienta y extrae el tarball directamente. Para CI conviene exigir el hash y verificar el contenido del archivo antes de extraerlo. No se ejecutó ese script durante este análisis.

## Integración técnica sugerida

```text
VOICE_AUDIO original
  → FFmpeg: decodificar y convertir a PCM s16 mono 48 kHz
  → adaptador RNNoise: procesar cuadros de 480 muestras y conservar duración
  → FFmpeg: finishing de voz y codificación M4A
  → PROCESSED_AUDIO en READY_FOR_QA, con comparación A/B
```

El `rnnoise_demo` sirve como referencia, no como ejecutable de producción. Descarta el primer cuadro de salida y no comprueba adecuadamente aperturas de archivos, lecturas parciales ni escrituras. Un adaptador propio tendría que validar entrada, rellenar/recortar el último cuadro, definir compensación de retardo, comprobar duración y devolver códigos de error estables. Ejecutarlo en el worker asíncrono existente mantiene límites de tamaño, tiempo y concurrencia.

No se debe conectar el tarball de este checkout directamente al filtro `arnndn` de FFmpeg. La documentación de FFmpeg exige un modelo para ese filtro y su implementación lee el formato textual `rnnoise-nu model file version 1`; el README de este checkout describe un blob binario “machine endian”. La compatibilidad o conversión tendría que demostrarse con un modelo concreto. La ruta más directa para este repositorio es un pequeño adaptador C sobre la API de RNNoise, con FFmpeg para el preprocesamiento y finishing.

## Licencias y procedencia

1. **Código:** `COPYING` declara BSD de tres cláusulas. Al distribuir binarios hay que reproducir los avisos y el descargo de responsabilidad en los materiales de distribución.
2. **Pesos preentrenados:** no vienen en el checkout ni hay una declaración de licencia específica en los archivos locales que autorice expresamente su redistribución. [La incidencia #284 del proyecto](https://github.com/xiph/rnnoise/issues/284) continúa abierta al 2026-09-22 y plantea precisamente esta duda. No interpretar el hash, la posibilidad técnica de descarga ni el `COPYING` del código como autorización inequívoca del modelo.
3. **Datos de entrenamiento:** `datasets.txt` lista conjuntos de terceros con licencias propias. La inferencia no requiere incorporarlos al worker; entrenar un modelo nuevo necesitaría una revisión adicional de datos y derechos.
4. **FFmpeg:** su licencia depende de la build exacta y de los componentes habilitados; registrar versión, configuración y avisos de la imagen final.

La aprobación de cumplimiento debe referirse al modelo exacto, su hash y la forma de uso/distribución prevista. Esta evaluación técnica no sustituye esa revisión.

## Decisión y siguientes pruebas

RNNoise queda como **candidato de POC**, detrás del perfil base de FFmpeg y en comparación con DeepFilterNet. Antes de implementarlo en producción:

1. Resolver documentalmente la licencia de los pesos seleccionados.
2. Preparar un artefacto inmutable y un build reproducible con hash obligatorio y avisos BSD.
3. Construir un adaptador de cuadros sin truncar ni desplazar el audio; validar exactamente duración y sincronía.
4. Comparar A/B con audios de narración en español: ruido constante, transitorios, reverberación leve, voces limpias de control y música de fondo.
5. Medir tiempo por minuto, memoria, clipping, loudness e inteligibilidad frente a FFmpeg base y DeepFilterNet.

Fuentes externas: [repositorio Xiph](https://github.com/xiph/rnnoise), [COPYING](https://github.com/xiph/rnnoise/blob/main/COPYING), [incidencia sobre los pesos](https://github.com/xiph/rnnoise/issues/284), [filtro `arnndn` de FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#arnndn) y [lector de modelos de FFmpeg](https://ffmpeg.org/doxygen/trunk/af__arnndn_8c_source.html).
