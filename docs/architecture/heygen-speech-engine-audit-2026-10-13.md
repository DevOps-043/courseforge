# Auditoria HeyGen: rechazo de locale en voz

Fecha: 2026-10-13. Base inspeccionada: `b544f303c0374aac058fb3590efec657301176d3`.
Entorno: checkout local con cambios previos ajenos en audio y editor. Sin consultas a credenciales, cambios de base de datos, despliegue ni generaciones facturables.

## Objetivo y causa

El error reportado es HTTP 400: ElevenLabs rechaza `locale` y pide `language` base. La referencia vigente de [Generate Speech](https://developers.heygen.com/reference/generate-speech) confirma que `locale` corresponde a Starfish y que ElevenLabs usa idioma base. Al omitir `engine`, se usa la preferencia guardada de la voz; voces sin default concreto conservan Starfish. La [guia de motores](https://developers.heygen.com/docs/voices/speech) explica `available_engines` y `default_engine`.

El cliente filtra `GET /v3/voices` por Starfish pero enviaba `POST /v3/voices/speech` sin motor. El filtro de una consulta no cambia la preferencia guardada ni selecciona el motor para solicitudes posteriores. Una voz compatible con Starfish puede tener ElevenLabs como default. Esto explica el rechazo sin requerir una migracion de rutas.

No se inspecciono el job ni la voz concreta en produccion: el mensaje acredita que HeyGen resolvio ElevenLabs, pero no permite determinar cuando ni quien cambio la preferencia. No hay evidencia de una fecha de ruptura del proveedor.

## Recorrido inspeccionado

- `heygen.client.ts`: catalogo, generacion de voz, creacion de video, timeout y errores.
- `heygen-scenes.service.ts`: voz independiente de escena, voz previa al avatar y recuperacion. Las llamadas con locale no fijaban motor. La voz se sintetiza antes de enviar el video con `audio_url`.
- `heygen-video.service.ts`: voz por componente y avatar completo usan el mismo cliente. El avatar recibe el audio generado para conservar sincronizacion.
- `app/api/production/heygen/speech/route.ts`: tanto voz standalone como por componente pasan por el cliente; incluye validacion, autenticacion, rol y contexto tenant.
- `heygen-audio-import.service.ts`: recuperacion desde registro, Storage y checkpoint antes de sintetizar; no se cambio este orden.
- `heygen-normalizers.ts`: conserva `engine`/`engine_type`, pero descarta valores de `default_engine`, `available_engines`, `support_locale` y `support_pause` (solo sus nombres quedan en `synced_fields`).
- `supabase/functions/_shared/heygen.ts`: consulta renders HyperFrames; no genera esta voz.

En escenas, un fallo de voz marca el job como FAILED con `stage: voice_generation` antes de crear el avatar. El texto visible de error no demuestra que el render de avatar haya fallado: puede no haberse enviado.

## Correccion local

Se centraliza `HEYGEN_SPEECH_ENGINE = "starfish"` y se usa en el filtro del catalogo y en el body de cada sintesis del cliente. Se conserva locale, idioma, texto, velocidad y parsing de timestamps. Abarca escenas, componentes, standalone y recuperacion sin duplicar reglas en handlers.

No se sustituye automaticamente por otro motor ni se reintenta un 400. Convertir siempre `es-MX` a `es` perderia la seleccion regional y mantendria una dependencia implicita del default. La politica actual del producto ya filtra Starfish y registra trabajos de voz con `providerModel: starfish`.

## Hallazgos adicionales y limites

1. **Capacidades de voz no persistidas**: si se habilitan motores multiples, conservar capacidades tipadas, validar la seleccion server-side y persistir motor/idioma efectivos en snapshots. No basta con el nombre del motor de avatar (IV/V), que es independiente del motor TTS.
2. **Reuso de voz por texto**: `getReusableSceneVoiceAsset` valida estado, hash del texto y URLs, pero no compara voz, velocidad o locale. Puede reutilizar un audio anterior cuando esas opciones cambian. Requiere una identidad de sintesis completa y compatibilidad explicita para assets historicos; pendiente, fuera de esta correccion puntual.
3. **Timeout de escena**: tras error de `createAvatarVideo`, el flujo de escenas marca FAILED y descarta voz provisional; el flujo de video completo distingue HTTP 408 como envio desconocido. Un timeout puede ocurrir despues de aceptar el video. Conviene alinear recuperacion antes de permitir una nueva generacion facturable.
4. **Checkpoint de audio**: si no se puede importar una URL guardada, el servicio genera reemplazo tras cualquier excepcion. Clasificar expiracion frente a errores transitorios de Storage/red evitaria sintesis adicional innecesaria.
5. **Contrato en evolucion**: la documentacion incorpora Orca y modelos ElevenLabs, y distingue clones HeyGen Voice en `/v3/models/audio/tts`. Estos no deben agregarse al flujo actual suponiendo que comparten contrato. Ver [indice oficial](https://developers.heygen.com/llms.txt).

Los hallazgos 2–4 son riesgos sustentados por ramas de codigo, no causas confirmadas del incidente reportado. No se modifican jobs ni assets existentes para corregirlos en esta entrega.

## Validacion y rollout

Las pruebas del cliente verifican el motor enviado, conservacion de `es-MX`, idioma base y autodeteccion, metadata de sincronizacion y una sola llamada ante 400. Las suites de catalogo, escenas, importacion y repositorio cubren regresiones locales del flujo compartido.

Resultado local: `npx tsc -p tsconfig.remotion-test.json` aprobado; seis archivos de pruebas HeyGen ejecutados con `node --test`: 77 pruebas, 11 suites, cero fallos. `git diff --check` de los archivos modificados aprobado. No se ejecuto build completo ni pruebas facturables contra HeyGen.

Pendiente de validacion externa: desplegar el cambio y generar una escena breve con la voz afectada y locale original. Confirmar audio, duracion/timestamps, avatar desde ese audio y recuperacion del job. Una voz que ya no soporte Starfish debe fallar explicitamente; resincronizar catalogo y seleccionar otra compatible, sin fallback automatico. No reencolar trabajos en masa.

No se cambian dependencias, plan, credenciales, webhooks, consentimiento, almacenamiento ni licencias. La revision de merge/despliegue conserva el protocolo existente de cumplimiento. Para agregar ElevenLabs en el futuro, usar `engine` explicito y `language` base sin locale, con validacion de capacidades y pruebas propias.
