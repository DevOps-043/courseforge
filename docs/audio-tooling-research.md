# Investigación técnica: herramientas para edición y tratamiento básico de audio

**Fecha:** 2026-09-21  
**Estado:** discovery técnico; no aprueba parámetros de audio ni proveedores.

## Objetivo

Identificar herramientas que permitan completar el flujo de producción recurrente
de Courseforge sin convertir el editor en una DAW: fades, control de nivel,
limpieza de ruido, tratamiento básico de voz y presets reproducibles.

La solución debe ser no destructiva, multi-tenant, trazable y equivalente entre
preview y render final.

## Hallazgos actuales

### Courseforge y HyperFrames

Courseforge usa `@hyperframes/core`, `@hyperframes/studio` y
`@hyperframes/studio-server` en versión `0.7.106`. Su documento de composición
ahora modela `fadeInSeconds` y `fadeOutSeconds` por clip. Los fades se compilan
como `volumeKeyframes`, el mismo contrato que HyperFrames procesa en preview y
en su mezclador offline.

HyperFrames aporta:

- clips con inicio, duración, offset, volumen y automatización de volumen;
- mezcla de fuentes de audio/video por FFmpeg;
- aplicación de envolventes sobre PCM para evitar límites de expresiones de
  FFmpeg;
- reproducción sincronizada basada en Web Audio para preview;
- generación de TTS, música y SFX, además de transcripción/captions mediante
  la skill `media-use`.

HyperFrames no proporciona como producto una cadena de reducción de ruido, EQ,
compresión, de-essing, limitación ni presets DSP de voz.

### Entorno local

`ffmpeg` no está disponible en `PATH` de este entorno de desarrollo. Por ello,
ninguna propuesta debe depender de que una API route o el navegador lo tenga
instalado. El procesamiento ha de ejecutarse en un worker/imagen de contenedor
con versión y capacidades verificadas, o delegarse a un proveedor.

## Alternativas investigadas

| Alternativa | Cubre | Ventajas | Riesgos / límites | Veredicto |
| --- | --- | --- | --- | --- |
| FFmpeg (`afade`, `afftdn`, `arnndn`, EQ, compresor, limitador, `loudnorm`) | fades, DSP clásico, análisis y normalización | Determinista, auditable, encaja con el renderer de HyperFrames | Requiere worker controlado y validación de build/modelos | **Base recomendada** |
| RNNoise | reducción neural de ruido de voz | Ligero, librería C, licencia BSD | Entrada/salida de ejemplo es PCM mono 48 kHz; requiere adaptador y validación de calidad | Candidato de POC |
| DeepFilterNet | mejora neural de voz | Soporta 48 kHz, binario `deep-filter`, licencia MIT/Apache | Operación y empaquetado Rust/modelos; evaluar latencia y artefactos | Candidato de POC prioritario |
| Auphonic API | nivelación, ruido, filtrado, loudness, operación por presets | Servicio maduro, API REST, presets y multitrack | Coste, transferencia de medios/PII, vendor lock-in | Candidato de benchmark / operación gestionada |
| Web Audio API | preview de EQ/compresión y ganancia | Nativo del navegador, latencia baja, Biquad/Compressor/Gain | No garantiza paridad con el render cloud; no usar como fuente de verdad | Sólo preview futuro, no MVP |

## Detalle de las herramientas

### 1. FFmpeg: base de procesamiento propia

La documentación oficial de filtros incluye:

- `afade` para fades;
- `afftdn` para denoise FFT;
- `arnndn` para reducción de ruido de voz mediante red neuronal, con un modelo
  requerido;
- `highpass`, `equalizer`, `acompressor`, `alimiter` y `loudnorm` para cadenas
  de voz y control de salida;
- `ebur128`, `astats` y `volumedetect` para mediciones.

`loudnorm` soporta objetivos de loudness integrado, rango de loudness y true
peak; para archivos permite flujo de dos pasadas. No se deben adoptar valores
objetivo sin aprobación del especialista de audio.

**Encaje propuesto:** worker asíncrono con una imagen inmutable que ejecute una
cadena allow-listed. La API recibe un `profileId`, nunca un filtro FFmpeg ni
argumentos libres. El worker produce una variante derivada y conserva métricas,
versión de perfil, checksum del input y checksum del output.

**Licencias:** FFmpeg es LGPL por defecto, pero una build con componentes GPL
puede pasar a GPL. Se debe registrar `ffmpeg -version`, `ffmpeg -buildconf`,
licencias y procedencia exacta de la imagen antes de distribuirla. Esta nota no
es asesoría legal.

Fuentes: [filtros oficiales](https://ffmpeg.org/ffmpeg-filters.html),
[licenciamiento oficial](https://ffmpeg.org/legal.html).

### 2. RNNoise: denoise neuronal de baja complejidad

RNNoise es una librería de supresión de ruido basada en redes recurrentes.
Ofrece API C y carga de modelos. El ejecutable de ejemplo requiere PCM raw de
16 bits, mono, 48 kHz; por tanto no debe invocarse directamente contra assets
arbitrarios sin una etapa explícita de decodificación/remuestreo/recodificación.

**Uso recomendado:** evaluar como un procesador interno para clips `VOICE`, no
para música, SFX ni mezcla completa. Conservar siempre el original y permitir
comparación A/B antes de reemplazar la fuente usada por el clip.

Fuente: [xiph/rnnoise](https://github.com/xiph/rnnoise).

### 3. DeepFilterNet: mejora neuronal de voz de mayor fidelidad

DeepFilterNet se presenta como framework de mejora de voz de banda completa a
48 kHz. Publica un binario `deep-filter` que procesa WAV de 48 kHz y puede
compensar el retardo del modelo. Su licencia del repositorio es MIT; el proyecto
también distribuye licencia Apache 2.0, que debe revisarse junto con los pesos
del modelo que se elijan.

**Uso recomendado:** POC offline con clips de narración representativos.
Compararlo contra `afftdn` y RNNoise con una batería de audios reales: ruido
constante, ventilador, eco leve, voz con música, voces femeninas/masculinas y
español. Medir además de escuchar: duración, clipping, loudness y degradación
de transcripción.

Fuente: [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet).

### 4. Auphonic: servicio gestionado

Auphonic ofrece API REST con loudness, nivelación, reducción de ruido, filtrado
y reconocimiento. Sus producciones/presets permiten automatizar lotes; la API
multitrack expone parámetros de reducción de ruido/deverb y objetivos de
loudness/true peak.

**Uso recomendado:** benchmark externo y opción de operación para equipos que
prioricen rapidez sobre control de infraestructura. Requiere evaluación formal
de coste, residencia de datos, DPA, retención, latencia, límites de payload y
estrategia de fallo/reintento. Nunca enviar URLs firmadas persistentes a logs.

Fuente: [Auphonic API](https://us.auphonic.com/help/api/),
[algoritmos](https://us1.auphonic.com/help/algorithms/index.html).

### 5. Web Audio API: solamente para preview

Web Audio puede construir grafos de `BiquadFilterNode`, `DynamicsCompressorNode`
y `GainNode`. Es útil para escuchar una hipótesis de preset de manera interactiva.
No debe ser la implementación final porque el renderer cloud de HyperFrames no
reproduce automáticamente ese grafo.

Fuente: [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).

## Skills, repositorios y funciones disponibles

| Recurso | Aporta hoy | Límite para este alcance |
| --- | --- | --- |
| Skill `media-use` | TTS, música, SFX, transcripción, captions y ducking GSAP | No implementa denoise ni presets de voz DSP |
| Skill `hyperframes` | Contrato de composición, render y selección de workflows | No aporta filtros de voz por sí misma |
| Repositorio HyperFrames | Motor de mezcla/automatizaciones y renderer | El checkout local no modifica el renderer cloud automáticamente |
| `functions.exec` | POC reproducible y pruebas de binarios en un worker | No sustituye un entorno de render con FFmpeg instalado |
| `web.run` | Investigación actualizada y verificación de proveedores/repositorios | No procesa archivos privados |
| Plugins/MCP de Codex | Podrían empaquetar un workflow de QA de audio o conectar un proveedor | No hay plugin de audio instalado y ninguno es necesario para el MVP |

Las skills son flujos reutilizables; los plugins pueden empaquetar skills y
servidores MCP. Para este proyecto conviene crear una skill de QA de audio sólo
después de estabilizar el contrato de perfiles y las pruebas de escucha.

Fuente: [Skills & Plugins de OpenAI](https://learn.chatgpt.com/docs/skills-and-plugins).

## Arquitectura recomendada

```text
UI / documento de composición
  ├─ fades y volumen → automatización HyperFrames
  └─ profileId explícito → job asíncrono de procesamiento
                             ├─ worker con FFmpeg / modelo aprobado
                             ├─ análisis antes y después
                             ├─ variante inmutable en storage privado
                             └─ resultado A/B y auditoría
```

Entidades sugeridas:

- `audio_processing_profiles`: `id`, organización, versión, estado, tipo,
  receta declarativa validada y límites permitidos.
- `audio_processing_jobs`: input checksum, perfil/versionado, estado,
  idempotency key, métricas, errores redaccionados y timestamps.
- `audio_processing_variants`: asset origen, asset derivado, checksum,
  duración, codec, sample rate, canales, loudness y true peak.

La clave de idempotencia debe contener `organizationId + sourceChecksum +
profileVersion`; el mismo input y perfil no deben reprocesarse. Las variantes
deben almacenarse en bucket privado y entregarse con URL firmada corta.

## Recomendación por fases

### Fase A — ya disponible

Usar fades, ganancia, trim, SFX y ducking de la composición HyperFrames.

### Fase B — POC de limpieza de voz

Crear un worker de prueba con build FFmpeg fijada. Comparar:

1. `afftdn` conservador;
2. `arnndn` con modelo versionado;
3. DeepFilterNet;
4. Auphonic como referencia gestionada.

No mostrar estos controles en producción hasta revisar resultados con el
especialista de audio.

### Fase C — perfiles de voz productivos

Una vez definidos por el especialista, publicar perfiles con nombres de
intención, no de parámetros: `LIMPIAR_VOZ`, `NARRACION_CLARA`,
`PRESENTACION_CALIDA`. La receta y sus límites permanecen de servidor.

## Criterios de decisión del POC

- Paridad de duración y sincronía tras el procesamiento.
- Sin clipping nuevo; mediciones comparables de loudness y true peak.
- Escucha A/B ciega sobre auriculares y altavoces comunes.
- La inteligibilidad y la transcripción no empeoran.
- Tiempo/coste por minuto dentro del presupuesto operativo.
- No se pierde la fuente original ni se mezcla contenido de organizaciones.
- Todas las variantes, modelos y binarios quedan versionados y auditables.

## Decisiones que requieren especialista de audio

1. Objetivo de loudness y máximo true peak por destino.
2. Límites de reducción de ruido y deverb para evitar artefactos.
3. Cadena y rangos de cada preset de voz.
4. Reglas para rechazar una fuente que no se puede rescatar de forma segura.
5. Set de fixtures de aprobación y criterio de escucha.
