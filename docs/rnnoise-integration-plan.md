# Plan de integración de RNNoise en Courseforge

**Fecha:** 2026-09-22  
**Estado:** plan; no autoriza distribuir los pesos ni activar el perfil en producción.  
**Base analizada:** `xiph/rnnoise` commit `70f1d256acd4b34a572f999a05c87bf00b67730d`; véase [análisis del repositorio](./rnnoise-repository-analysis.md).

## Objetivo y alcance

Agregar una variante opcional de reducción de ruido para narraciones `VOICE_AUDIO`, procesada por el worker asíncrono existente. FFmpeg decodifica y entrega el archivo final; RNNoise solo reduce ruido. La fuente se conserva y el resultado entra como `PROCESSED_AUDIO` en `READY_FOR_QA`. Música, SFX y mezclas finales quedan fuera de este perfil.

```text
POST de job autorizado → production_jobs (PENDING)
  → worker con capacidad RNNoise
  → FFmpeg: PCM s16 mono 48 kHz
  → adaptador RNNoise: cuadros de 480 muestras
  → FFmpeg: finishing y M4A
  → production_assets (PROCESSED_AUDIO, READY_FOR_QA)
  → comparación A/B y aprobación humana
```

## Decisiones arquitectónicas

1. **Usar la API C de RNNoise mediante un ejecutable pequeño y aislado.** El ejemplo `rnnoise_demo` no valida adecuadamente I/O y descarta el primer cuadro; el adaptador propio debe dar un contrato apto para producción. No usar `arnndn` de FFmpeg con el tarball de este checkout: los formatos de modelo no se han demostrado compatibles.
2. **Compilar desde un commit fijo y un modelo con hash fijo.** El checkout local no estará disponible en GitHub Actions. El build debe obtener el código por commit y los pesos desde un almacén aprobado, verificar ambos y producir un binario inmutable. `autogen.sh` descarga el modelo por su cuenta y por eso no debe usarse sin controlar previamente la descarga y la extracción.
3. **Imagen RNNoise separada.** Mantener la imagen FFmpeg base y la imagen DeepFilterNet como capacidades distintas. La imagen RNNoise incluirá solo FFmpeg, el adaptador y los pesos aprobados, además de los avisos de licencia correspondientes.
4. **Perfil versionado, sin filtros configurables por el cliente.** ID propuesto: `voice-clean-neural-rnnoise-v1`. El servidor resuelve parámetros y versión. El cliente solo elige un ID permitido; el perfil queda oculto por defecto hasta la aprobación técnica y legal.
5. **Enrutamiento de jobs por capacidad.** El RPC `claim_audio_processing_jobs` actual permite que cualquier imagen FFmpeg reclame cualquier perfil. Debe recibir una lista de perfiles soportados o una capacidad equivalente y reclamar únicamente esos jobs. Validar la capacidad otra vez en el worker antes de descargar audio. Los perfiles no soportados permanecen pendientes para el worker adecuado.

## Orden de implementación

| Fase | Trabajo concreto | Módulos previstos | Criterio de salida |
| --- | --- | --- | --- |
| 0. Cumplimiento y procedencia | Resolver el permiso de uso y redistribución de los pesos exactos; fijar commit, SHA-256 del tarball, notices y registro de aprobación; revisar la build de FFmpeg. | Registro de terceros, manifiesto de artefactos, configuración de CI | Aprobación documental para el modo de despliegue elegido. Sin ella no se publica imagen con pesos. |
| 1. Cola por capacidad | Extender el RPC de claim y su índice si la consulta lo requiere; pasar la capacidad desde cada entrypoint; probar coexistencia de base, DeepFilterNet y RNNoise. | `supabase/migrations/`, `apps/api/src/features/audio-processing/` | Cada worker reclama solo perfiles que puede ejecutar, incluso con concurrencia y reintentos. |
| 2. Adaptador nativo | Crear CLI C de `input.pcm → output.pcm` con lectura y escritura completas, estado RNNoise por archivo, control de errores, límite de tamaño y compensación de retardo verificada. | `apps/api/native/rnnoise/` (nuevo), pruebas nativas | Salida PCM con la misma cantidad de muestras y alineación validada; archivos truncados/corruptos fallan explícitamente. |
| 3. Build reproducible | Obtener fuente por commit, verificar modelo antes de extraer, compilar biblioteca y CLI, fijar versión de FFmpeg, registrar hashes/SBOM y avisos BSD; workflow manual de GitHub Actions en un Environment protegido. | `apps/api/Dockerfile.audio-worker-rnnoise`, `.github/workflows/`, `apps/api/third_party/rnnoise/` | Imagen construida con artefactos aprobados; build falla ante hash, licencia o versión ausente. |
| 4. Integración del worker | Seleccionar el adaptador por perfil, generar PCM temporal 48 kHz mono, ejecutar con `execFile` y timeout, validar PCM de salida, hacer finishing, persistir metadatos de versión/modelo y asset para QA. | `apps/api/src/features/audio-processing/`, contratos de perfil en `apps/web/src/domains/production/audio-processing/` | Job idempotente y aislado por organización; fallo seguro, limpieza temporal y trazabilidad completa. |
| 5. API y QA | Habilitar el perfil solo mediante configuración de servidor; mostrarlo únicamente a usuarios autorizados; recuperar original y derivado con acceso temporal; registrar aprobación explícita antes de usar el resultado en el timeline. | Ruta `/api/production/audio-processing/jobs`, controles del editor y flujo de QA | Nadie puede pedir RNNoise mediante payload arbitrario ni consumir un asset de otra organización. |
| 6. POC y rollout | Comparar RNNoise con original, FFmpeg base y DeepFilterNet usando narraciones en español; activar primero para un grupo interno, medir y decidir. | Fixtures autorizados, telemetría, checklist de QA | Aprobación del especialista de audio y operación; rollback mediante desactivar perfil sin perder fuentes. |

Las fases 1 y el diseño del adaptador pueden prepararse antes de resolver la licencia de los pesos. Las fases de build distribuible, prueba con el modelo oficial y activación dependen de la fase 0.

**Avance de la fase 1 (2026-09-22):** se agregó el RPC de claim por perfil, se restringió el RPC anterior al perfil base y el worker declara/verifica sus capacidades. Pasaron pruebas unitarias y build del backend; queda pendiente aplicar y probar la migración contra PostgreSQL antes de desplegar workers nuevos.

**Avance de la fase 2 (2026-09-22):** se añadió un adaptador C aislado de PCM a PCM, sin modelo ni conexión al worker, y una prueba con motor simulado en el gate de GitHub Actions. En esta máquina no hay compilador C disponible; la prueba nativa y la medición del retardo con la biblioteca real siguen pendientes.

**Avance preparatorio de la fase 3 (2026-09-22):** se añadió un manifiesto de artefactos y un verificador con pruebas que exigen commit y tarball fijados, hashes de archivos y aprobación explícita de redistribución. El checkout muestra que `rnnoise_data.c`/`.h` y el blob cargable deben corresponder entre sí; esa relación todavía debe verificarse en el build real. No se ha creado ni publicado una imagen RNNoise porque no se dispone de pesos aprobados ni del dictamen correspondiente.

## Contratos y controles clave

- **Entrada:** un `VOICE_AUDIO` validado para el mismo componente y organización, checksum SHA-256, MIME admitido y límite vigente de 50 MiB. El worker vuelve a verificar checksum tras descargarlo.
- **PCM:** `s16le`, un canal, 48 000 Hz; 480 muestras por llamada. El adaptador rellena temporalmente el último cuadro, recorta el relleno al guardar y mide el retardo real del modelo para compensarlo sin cortar voz.
- **Ejecución:** rutas locales generadas por el worker; nunca argumentos de CLI enviados por el cliente. Timeout, memoria y concurrencia acotados. No registrar contenido de audio ni URLs firmadas.
- **Salida:** asset derivado con `source_asset_id`, `profile_id/version`, commit RNNoise, SHA-256 del modelo y binario, versión/configuración de FFmpeg, duración y checksum de salida. Mantener el original intacto.
- **Idempotencia:** usar fuente, checksum y versión del perfil; una nueva versión de modelo o receta requiere otro ID/versionado para no reutilizar un resultado anterior.
- **Acceso:** el bucket y las URLs de reproducción deben respetar el tenant. El GET actual devuelve `public_url`; antes de exponer el nuevo perfil hay que confirmar si ese bucket es privado y, si lo es, emitir URLs firmadas de corta duración mediante la API autorizada.
- **Estados:** `PENDING → RUNNING → SUCCEEDED/FAILED/RETRY_SCHEDULED`; fallos del motor se registran con código seguro. Una repetición de un job fallido requiere una transición explícita y probada, no solo volver a pulsar el botón.

## Pruebas y aceptación

1. **Contrato de cola:** worker base, DeepFilterNet y RNNoise no reclaman jobs ajenos; dos workers concurrentes no reclaman el mismo job; un lease vencido y un resultado tardío no publican dos assets.
2. **Adaptador:** silencio, voz limpia, archivo vacío, longitud no múltiplo de 480, archivo grande, I/O fallida, saturación de muestras y ejecución interrumpida. Comparar número de muestras y alineación en PCM antes/después.
3. **Integración:** conversión desde WAV/MP3, checksum incorrecto, MIME inválido, archivo corrupto, timeout, caída del binario y reintento; comprobar que el original sigue intacto y que los archivos temporales se eliminan.
4. **Seguridad:** ownership de componente/asset/job, perfiles no habilitados, rutas inyectadas, lectura de resultados de otro tenant, validación del manifiesto y paquete de licencia.
5. **Audio:** escuchar A/B ciego con voces y micrófonos diversos, ruido estacionario y transitorio, reverberación leve, música de fondo y un control limpio. Medir loudness, true peak, clipping, duración, desfase, inteligibilidad y coste de CPU/memoria por minuto. El especialista define los umbrales de aceptación; no fijarlos por conjetura.
6. **Operación:** medir tasa de errores por perfil, tiempo de cola, tiempo de ejecución y proporción de resultados rechazados en QA. Apagar el perfil RNNoise ante regresiones sin alterar FFmpeg base.

## Dependencias y decisión de salida

El código RNNoise está bajo BSD de tres cláusulas; los pesos descargados por este checkout no tienen una declaración separada de redistribución identificada en el análisis. La [consulta abierta a los titulares](https://github.com/xiph/rnnoise/issues/284) confirma que existe una duda práctica, pero no constituye una decisión legal. El registro de aprobación debe cubrir el modelo exacto y si se usará solo internamente o también se distribuirá la imagen. [Licencia del proyecto](https://github.com/xiph/rnnoise/blob/main/COPYING); [licencia de FFmpeg](https://ffmpeg.org/legal.html).

**Decisión actual:** preparar infraestructura común y pruebas sin activar RNNoise. Seleccionar producción únicamente después de licencia aclarada, POC auditivo y validación operativa. Si la licencia de pesos no se aclara, RNNoise permanece fuera de la imagen distribuible y se continúa con el perfil FFmpeg base y otras opciones aprobadas.
