# Waveforms por lotes en GitHub Actions

## Alcance y arquitectura

Netlify encola los análisis en Supabase. `.github/workflows/process-audio-queue.yml` ejecuta el worker en un runner temporal de GitHub, sin desplegar un servicio en Google Cloud. El comando nuevo es `npm run process:audio-queue -w apps/api`, después de compilar la API y disponer de FFmpeg/FFprobe.

Staging y main comparten Supabase y, por tanto, una única cola. El ambiente seleccionado determina la rama del código y los secretos del runner, **no el origen de los trabajos**. Un worker con código de staging puede procesar trabajos creados desde main. No se ofrece aislamiento de datos ni ejecución por ambiente. Para exigirlo posteriormente, separar proyectos de Supabase o añadir una identidad de ambiente al contrato, idempotencia y claim atómico de los trabajos.

Solo se reclama `waveform-analysis-v2`; los tratamientos de voz y DeepFilterNet mantienen sus workers actuales. No se reemplazan los audios originales. Las mismas comprobaciones de organización, componente, checksum, almacenamiento y leases siguen aplicándose.

## Configuración de GitHub

Crear GitHub Environments `staging` y `main`. En ambos configurar:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Secret | `NEXT_PUBLIC_SUPABASE_URL` | URL del Supabase compartido |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio del Supabase compartido |
| Variable | `SUPABASE_PROJECT_REF` | Referencia aprobada del proyecto, usada para verificar la URL |
| Variable | `FFMPEG_PACKAGE_VERSION` | Versión exacta del paquete FFmpeg disponible y aprobada en Ubuntu 24.04 |
| Variable | `AUDIO_WORKER_ENABLED` | `true` para habilitar ese ambiente; ausente/`false` lo deshabilita |

La versión de FFmpeg no es la del ZIP Windows usado localmente. Consultar `apt-cache policy ffmpeg` en Ubuntu 24.04 y aprobar la versión antes de configurar la variable. Si desaparece del repositorio, el workflow falla en lugar de cambiar silenciosamente de binario. El paso de instalación imprime las versiones usadas.

Variables del repositorio:

| Nombre | Activación inicial | Promoción |
| --- | --- | --- |
| `AUDIO_WORKER_SCHEDULE_ENABLED` | Ausente o `false` durante la prueba manual; luego `true` | Se conserva |
| `AUDIO_WORKER_ACTIVE_ENVIRONMENT` | `staging` | Cambiar a `main` después de validar y promover el código |

Los secretos de ejecución solo se proporcionan a la validación, consulta ligera de la cola y ejecución del worker; no a instalación npm, build ni tests. El workflow tiene permiso de GitHub `contents: read`; no utiliza tokens de GitHub para invocarse desde Netlify. Restringir quién puede cambiar las ramas confiables, environments y variables; la rama seleccionada ejecutará código con acceso a la base compartida. No activar en pull requests ni forks.

## Activación primero en staging

1. Publicar el modo batch y su script npm en la rama `staging`.
2. Incorporar el archivo del workflow a la rama predeterminada `main`. GitHub requiere el workflow en la rama predeterminada para su activación y ejecución programada. Esta incorporación no exige activar el worker con código de main: el checkout del runner sigue seleccionando `staging`.
3. Configurar el Environment `staging` y poner `AUDIO_WORKER_ENABLED=true`. Dejar `main` deshabilitado.
4. En Actions → Process shared audio queue → Run workflow, seleccionar la rama del workflow `main` y el input de ambiente `staging`.
5. Encolar una waveform desde la app y verificar `PENDING → RUNNING → SUCCEEDED`, los avisos del editor y el derivado. El resumen `audio_batch_finished` muestra cantidades y motivo de salida.
6. Si la prueba pasa, configurar las dos variables del repositorio para programar staging.

## Promoción a main

1. Promover a main el mismo código batch validado en staging.
2. Configurar el Environment `main`, habilitarlo y hacer una ejecución manual con ambiente `main`.
3. Cambiar `AUDIO_WORKER_ACTIVE_ENVIRONMENT=main`. Habrá una sola programación activa, usando main. Deshabilitar el Environment `staging` si ya no se necesita la ejecución manual de esa versión.

No se crean dos schedulers para la misma base. Todas las invocaciones de este workflow, manuales o programadas, usan el mismo grupo de concurrencia y `cancel-in-progress: false`. GitHub puede reemplazar una ejecución pendiente con otra del mismo grupo; la cola persistente conserva el trabajo. Los leases protegen además frente a otros consumidores, incluido el worker local. Detener el worker local cuando se quiera comprobar exclusivamente el procesamiento de Actions.

## Límites, operación y rollback

- Programación cada 10 minutos, fuera del minuto cero. GitHub puede retrasar o descartar invocaciones programadas: no hay garantía de respuesta inmediata. La espera de 10 minutos de la pantalla puede agotarse antes de que arranque Actions; “Volver a consultar” reutiliza el análisis.
- Antes de instalar FFmpeg o compilar se consulta si hay una waveform elegible. Si no hay ninguna, se termina sin procesar ni construir. La comprobación es informativa; el claim atómico sigue siendo la autoridad frente a carreras.
- Cada ejecución toma un trabajo a la vez, hasta 12 trabajos o 20 minutos. El presupuesto se comprueba entre trabajos, permitiendo terminar el que ya tiene lease. El job de Actions tiene un límite duro de 45 minutos que incluye instalación y pruebas. No es un proceso permanente y no espera indefinidamente nuevos trabajos.
- Las solicitudes del cliente de Supabase tienen un timeout de 60 segundos. El decode mantiene el timeout existente de 7 minutos. Si se interrumpe de forma forzada un trabajo, los leases expiran según la política existente (una hora) y el siguiente runner puede recuperarlo; esta recuperación no es inmediata.
- Un error al reclamar falla la ejecución, no se interpreta como cola vacía. Fallos de análisis se registran por job y provocan resultado fallido del workflow al terminar el lote. Los reintentos programados mantienen su política existente.
- Logs en GitHub → Actions → ejecución → Process bounded waveform batch. Revisar `audio_batch_started`, `audio_processing_batch`, `audio_batch_finished`, `waveform_analysis_failed` y `waveform_analysis_retry`. No subir audios, secretos ni snapshots de trabajos como artifacts de Actions.
- Repositorios privados consumen minutos de Actions incluso cuando el runner solo consulta una cola vacía. Revisar el consumo antes de aumentar frecuencia o paralelismo.
- Para desactivar la programación, poner `AUDIO_WORKER_SCHEDULE_ENABLED=false`; para volver a la versión de staging, cambiar la variable de ambiente activo si esa versión sigue habilitada y es compatible. No cancelar una ejecución en curso salvo necesidad operativa. No hay migraciones ni cambios destructivos de datos en esta entrega.

## Validación local

`npm run build -w apps/api` y `npm run test:audio-processing -w apps/api` verifican tipos y políticas de salida del lote: cola vacía, límite de trabajos, presupuesto temporal, señal de parada, fallo al reclamar y límites inválidos. Las pruebas usan un claim simulado y no procesan datos remotos. La prueba real de Actions y las instalaciones Linux requieren publicar/configurar el workflow; una validación local no demuestra que los secretos, permisos, cuota o versión apt del runner estén configurados.
