# HeyGen HyperFrames: orquestación durable

## Resultado

El render y la importación ya no dependen de una pestaña abierta ni de una
función que espere durante todo el proceso. El flujo operativo es:

```text
Next.js solicita y persiste el render
        │
        ├── HeyGen webhook firmado ──► cola durable de importación
        │
        └── Supabase Cron ───────────► reconciliación de respaldo
                                            │
                                            ▼
                              importación TUS reanudable por rangos
                                            │
                                            ▼
                              DB + Storage + Supabase Realtime
```

Los webhooks reducen la latencia. El cron es el mecanismo de recuperación si
HeyGen no entrega un evento. Ninguna Edge Function espera a que termine el
render: cada ejecución reclama trabajo mediante un lease, realiza una unidad
acotada y persiste su checkpoint.

Supabase Edge Functions también son serverless. La durabilidad no proviene de
mantener una función viva, sino de PostgreSQL, Cron, leases idempotentes y los
checkpoints TUS que permiten continuar en otra invocación.

## Entrega de medios para cursos largos

Los snapshots nuevos usan `asset_delivery_mode = REMOTE_VARIABLES`. El ZIP de
HyperFrames contiene únicamente HTML, el runtime de animación y manifiestos;
no contiene MP4, audio ni imágenes de Producción. Cada etiqueta multimedia usa
`data-hf-src` y recibe en el momento del envío una URL HTTPS del Storage
interno. Los objetos públicos conservan una URL versionada por checksum; los
del bucket privado `production-render-sources` reciben una firma de 24 horas
generada justo antes de crear el render.

La revisión persiste exclusivamente `storageBucket`, `storagePath`, tamaño y
checksum. No persiste URLs firmadas ni credenciales temporales. Esto mantiene
el snapshot reproducible y evita que una URL expirada invalide un reintento.

Las revisiones anteriores que no declaran modo de entrega continúan tratándose
como `EMBEDDED`; no se reinterpretan ni se reciclan como snapshots remotos.
El límite de 200 MiB se conserva para el ZIP. Los medios remotos pueden sumar
más de 200 MiB y cada video puede ocupar hasta 2 GiB, sujeto al límite global
de Storage configurado para el proyecto. Las cargas de navegador desde 6 MiB
usan TUS en bloques de 6 MiB, con reintentos y recuperación del upload previo;
las cargas pequeñas conservan el endpoint estándar.

Antes de congelar o enviar, Courseforge estima la salida según duración y
perfil. A partir de 10 minutos muestra una recomendación de segmentación; si la
estimación supera 2 GiB bloquea el render y calcula el mínimo de segmentos. Un
curso de 30 minutos puede seguir publicándose como varias lecciones o bloques,
sin rehacer el curso completo cuando falla una sola fuente.

## Componentes

- `heygen-hyperframes-webhook`: valida HMAC-SHA256 sobre el body crudo,
  timestamp y event id; nunca confía en una URL entregada por el webhook.
- `reconcile-hyperframes-renders`: consulta trabajos pendientes por lotes y
  agenda la importación al detectar `completed`.
- `import-hyperframes-video`: vuelve a pedir a HeyGen la URL firmada vigente,
  valida su host, descarga rangos de 6 MiB y los sube mediante TUS. Procesa un
  máximo de 24 MiB por trabajo e invocación.
- PostgreSQL: contiene la máquina de estados, leases, reintentos, deduplicación
  de eventos y finalización transaccional de `production_jobs`,
  `production_assets`, `material_components` y la solicitud HyperFrames.
- Realtime: informa al editor sobre render, importación, éxito o fallo. La UI no
  es responsable de hacer avanzar el proceso.

## Despliegue

Este proyecto usa Supabase alojado en la nube. Las funciones se publican desde
este repositorio con Supabase CLI; no se copian manualmente al editor web.

### 1. Vincular y auditar la base remota

Desde la raíz del repositorio:

```bash
npx supabase login
npx supabase projects list
npx supabase link --project-ref PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
```

El `dry-run` debe mostrar únicamente las migraciones realmente pendientes. En
producción, no continuar si aparecen migraciones históricas inesperadas y no
usar `db reset --linked`, `--include-all` ni `migration repair` para forzar el
resultado. Después de validar el plan:

```bash
npx supabase db push
```

Esto aplica
`20260821160000_durable_hyperframes_render_orchestration.sql`, habilita
`pg_cron`/`pg_net`, publica la tabla de seguimiento en Realtime y crea los dos
cron jobs. Mientras Vault no esté configurado, los cron hacen no-op.

La migración
`20260825120000_expand_hyperframes_media_delivery_limits.sql` actualiza los
buckets `production-assets` y `production-videos` y la cola privada de
importación a 2 GiB. También crea `production-render-sources` como bucket
privado para activar gradualmente la entrega firmada sin romper URLs públicas
históricas. Antes de aplicarla, el límite global de archivos del
proyecto Supabase debe permitir al menos 2 GiB; si el plan no lo permite, usar
el máximo disponible y ajustar conjuntamente la constante del worker y el
constraint de base de datos.

La aplicación no guarda tokens TUS ni URLs firmadas en las tablas de snapshots.
Los primeros sólo viven en el almacenamiento local administrado por
`tus-js-client`; las segundas se resuelven en el servidor en cada intento.
Las cargas nuevas de voz, música, B-roll y avatar se guardan en el bucket
privado. El editor conserva una URL autenticada de Courseforge que valida
usuario, empresa y componente y responde con una redirección firmada de diez
minutos; los slides y videos finales públicos conservan su flujo histórico.

### 2. Configurar secretos de las Edge Functions

En Supabase Dashboard, abrir **Edge Functions → Secrets** y guardar:

- `OAUTH_TOKEN_CRYPTO_SECRET`: el mismo valor hexadecimal de 64 caracteres que
  usa Netlify. No generar otro; si Netlify solo tiene
  `GOOGLE_OAUTH_CRYPTO_SECRET`, crear `OAUTH_TOKEN_CRYPTO_SECRET` con ese mismo
  valor para conservar la compatibilidad con credenciales ya cifradas.
- `COURSEFORGE_EDGE_INVOCATION_KEY`: una clave aleatoria nueva de al menos 32
  bytes. No reutilizar la anon key, publishable key ni service-role key.

`SUPABASE_URL` y `SUPABASE_SECRET_KEYS` son provistos automáticamente por
Supabase Cloud. No deben copiarse al frontend.

También pueden cargarse con CLI:

```bash
npx supabase secrets set OAUTH_TOKEN_CRYPTO_SECRET=HEX_DE_64_CARACTERES
npx supabase secrets set COURSEFORGE_EDGE_INVOCATION_KEY=CLAVE_ALEATORIA
npx supabase secrets list
```

### 3. Desplegar las funciones cloud

```bash
npx supabase functions deploy heygen-hyperframes-webhook --use-api
npx supabase functions deploy reconcile-hyperframes-renders --use-api
npx supabase functions deploy import-hyperframes-video --use-api
```

`supabase/config.toml` ya declara `verify_jwt = false`. El webhook verifica la
firma de HeyGen y los otros dos endpoints verifican la clave privada del cron.
`--use-api` permite empaquetar en Supabase sin depender de Docker local.

### 4. Configurar Vault para el cron

En **Supabase Dashboard → SQL Editor**, guardar la URL del proyecto y la misma
`COURSEFORGE_EDGE_INVOCATION_KEY` configurada en Edge Functions:

   ```sql
   select vault.create_secret(
     'https://PROJECT_REF.supabase.co',
     'courseforge_project_url'
   );

   select vault.create_secret(
     'REEMPLAZAR_POR_CLAVE_ALEATORIA',
     'courseforge_edge_invocation_key'
   );
   ```

Antes de crear, se pueden comprobar los nombres existentes sin mostrar sus
valores:

```sql
select id, name, created_at, updated_at
from vault.secrets
where name in ('courseforge_project_url', 'courseforge_edge_invocation_key');
```

Si ya existen, actualizarlos con `vault.update_secret` en lugar de crear
duplicados.

### 5. Desplegar la aplicación y registrar HeyGen

1. Publicar en Netlify la versión web que contiene esta implementación.
2. Confirmar que Netlify usa el mismo `OAUTH_TOKEN_CRYPTO_SECRET`.
3. En Courseforge, volver a guardar la API key de HeyGen de cada organización
   desde Integraciones. Courseforge registrará el endpoint, cifrará el signing
   secret de un solo uso y guardará únicamente la referencia pública.
4. Ejecutar un render corto, cerrar el editor inmediatamente y confirmar que el
   proceso termina e importa el video sin una sesión de navegador.

La migración programa reconciliación cada minuto e importación cada 30 segundos.
Si los secretos de Vault aún no existen, el wrapper de cron no envía solicitudes.

## Recuperación de renders previos

La migración asigna `callback_id` a solicitudes existentes y establece su
próxima reconciliación inmediatamente. Un render anterior con
`provider_status IN ('PENDING', 'RUNNING')` y `provider_render_id` válido será
consultado por el cron, incluso si nunca tuvo webhook. Así se recuperan los MP4
que HeyGen ya terminó pero Courseforge no importó.

## Verificación operativa

```sql
-- Renders que siguen esperando al proveedor.
select id, provider_render_id, provider_status, next_reconcile_at,
       reconcile_retry_count, last_provider_check_at
from public.hyperframes_render_requests
where provider_status in ('PENDING', 'RUNNING')
order by created_at;

-- Importaciones visibles para soporte sin exponer URLs TUS privadas.
select id, provider_render_id, provider_status, import_status,
       webhook_received_at, updated_at
from public.hyperframes_render_requests
where import_status <> 'NONE'
order by updated_at desc;

-- Historial de ejecución de los cron jobs.
select jobid, status, start_time, end_time, return_message
from cron.job_run_details
where jobid in (
  select jobid from cron.job
  where jobname in (
    'courseforge-reconcile-hyperframes',
    'courseforge-import-hyperframes-video'
  )
)
order by start_time desc
limit 50;
```

Los logs de las Edge Functions son JSON estructurado y contienen ids de
solicitud/importación, nunca API keys, signing secrets, URLs firmadas ni bodies
de webhook.

## Alertas recomendadas

- `reconcile_retry_count >= 5` durante más de 15 minutos.
- `import_status = 'FAILED'`.
- jobs en `WAITING_PROVIDER`, `RUNNING` o `RETRY_SCHEDULED` sin actualización
  durante más de una hora.
- fallos consecutivos del cron o respuestas HTTP no exitosas en `pg_net`.
- Storage cerca del límite de cuota o videos mayores al límite de 2 GiB del
  bucket `production-videos`.

## Rollback seguro

Para detener procesamiento sin perder estado:

```sql
select cron.unschedule('courseforge-reconcile-hyperframes');
select cron.unschedule('courseforge-import-hyperframes-video');
```

No borrar filas de seguimiento ni objetos parciales durante un incidente. Los
leases expiran y los checkpoints TUS permiten reanudar después de corregir el
problema. Para reactivar, volver a ejecutar únicamente los dos bloques
`cron.schedule` de la migración.
