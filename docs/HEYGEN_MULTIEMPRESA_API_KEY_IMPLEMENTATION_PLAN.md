# Plan de implementacion: HeyGen multiempresa sin OAuth

Fecha: 2026-07-29

## 1. Entendimiento del objetivo

Se requiere centralizar la integracion HeyGen usando `prompt_maestro.md` como fuente de verdad, aprovechando la implementacion existente y cambiando la estrategia de autenticacion: en lugar de OAuth por usuario, cada organizacion podra conectar su propia API key de HeyGen.

El objetivo funcional es que cada empresa pueda:

- Guardar una API key propia de HeyGen.
- Validarla de forma segura.
- Sincronizar sus avatares y voces desde su cuenta HeyGen.
- Generar talking heads con su propio balance y catalogo.
- Usar el resultado dentro del flujo normal de assets y Remotion.
- Operar el modulo HeyGen de forma independiente desde `/admin/heygen`.

Restricciones clave:

- No implementar OAuth en esta fase.
- No exponer API keys al cliente.
- No guardar secretos en texto plano.
- Mantener el flujo `desktop_worker` como camino principal.
- Mantener `HEYGEN_API_KEY` global solo como fallback opcional o modo demo.
- Evitar webhooks por preferencia actual: usar REST y polling controlado.
- Respetar separacion de responsabilidades: routes delgadas, servicios de caso de uso, repositories, cliente de proveedor, validators y UI sin logica sensible.

Supuestos:

- `OAUTH_TOKEN_CRYPTO_SECRET` ya existe en produccion y puede cifrar credenciales externas.
- El scope de permisos actual distingue usuarios con capacidad de administracion/revision mediante `canReviewContent`.
- Las tablas actuales de catalogo HeyGen ya existen o estan en proceso de migracion.
- La implementacion con nombre "Jin" se refiere al trabajo actual de HeyGen.

## 2. Diagnostico tecnico

La implementacion actual ya contiene piezas utiles:

- `heygen.client.ts`: cliente server-side para API key u OAuth bearer token.
- `heygen.repository.ts`: acceso a presets, jobs y assets.
- `heygen-catalog.service.ts`: sincronizacion de avatares y voces.
- `heygen-video.service.ts`: generacion y seguimiento de talking heads.
- `heygen-video-import.service.ts`: importacion del resultado a storage.
- UI en `/admin/heygen`.
- Rutas REST bajo `/api/production/heygen/*`.

El problema principal es que la conexion esta orientada a OAuth:

- `heygen-oauth.service.ts` resuelve credenciales desde `user_cloud_storage_credentials`.
- `/api/production/heygen/sync` exige conexion OAuth y no permite fallback de API key global.
- `/api/auth/heygen/*` agrega una experiencia de "Conectar HeyGen" que no corresponde al modelo elegido.

Riesgos si se deja asi:

- Produccion pedira variables `HEYGEN_OAUTH_*` que todavia no existen.
- Los usuarios veran una promesa de login HeyGen que no esta habilitada por proveedor.
- La API key global no resuelve multiempresa ni separa consumo por organizacion.
- Si se guardan keys por organizacion sin cifrado o permisos estrictos, se introduce un riesgo critico de seguridad.

Decision tecnica:

Crear un subsistema de credenciales HeyGen por organizacion, cifrado, auditable y desacoplado del flujo OAuth. El cliente HeyGen debe recibir la API key ya resuelta por un servicio seguro; no debe decidir por si mismo desde donde viene la credencial salvo fallback global controlado.

## 3. Plan de implementacion

### Fase 0 - Limpieza de alcance OAuth

Objetivo: eliminar de la experiencia principal cualquier dependencia de OAuth.

Cambios:

- Mantener rutas `/api/auth/heygen/*` fuera del flujo visible o retirarlas si no se van a usar pronto.
- Cambiar copy de UI:
  - De "Conectar HeyGen" a "Configurar API key de HeyGen".
  - De "Conecta tu cuenta" a "Configura la API key de esta empresa".
- Retirar validaciones que exijan `HEYGEN_OAUTH_*`.
- Documentar que OAuth queda como fase futura no activa.

DoD:

- Ningun flujo del modulo HeyGen solicita OAuth para operar.
- La UI no promete login de HeyGen.
- Produccion no necesita variables `HEYGEN_OAUTH_*`.

### Fase 1 - Modelo de datos para credenciales por organizacion

Objetivo: guardar una API key HeyGen por organizacion sin exponerla.

Tabla recomendada:

```sql
create table if not exists public.production_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  encrypted_secret text not null,
  secret_last4 text,
  status text not null default 'ACTIVE',
  validation_status text not null default 'NEVER_VALIDATED',
  last_validated_at timestamptz,
  last_validation_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint production_provider_credentials_provider_check
    check (provider in ('heygen')),
  constraint production_provider_credentials_status_check
    check (status in ('ACTIVE', 'REVOKED')),
  constraint production_provider_credentials_validation_status_check
    check (validation_status in ('NEVER_VALIDATED', 'VALID', 'INVALID'))
);

create unique index if not exists production_provider_credentials_org_provider_active_uidx
  on public.production_provider_credentials (organization_id, provider)
  where status = 'ACTIVE';

create index if not exists production_provider_credentials_org_provider_idx
  on public.production_provider_credentials (organization_id, provider, status);
```

Notas:

- `encrypted_secret` se cifra con `OAUTH_TOKEN_CRYPTO_SECRET`.
- `secret_last4` solo se usa para UX y auditoria.
- `metadata` puede guardar informacion no sensible: cuenta, wallet, plan, limits si HeyGen lo devuelve.
- No usar `NEXT_PUBLIC_*` para secretos.

RLS:

- Lectura limitada a usuarios de la organizacion si solo se muestran metadatos.
- Escritura/revocacion solo por service role desde endpoints server-side autorizados.
- Nunca permitir lectura del secreto cifrado desde cliente.

DoD:

- La API key queda cifrada.
- Solo existe una credencial activa por organizacion/proveedor.
- Se puede revocar sin borrar auditoria.

### Fase 2 - Repository y servicio de credenciales

Objetivo: centralizar guardado, validacion, lectura y revocacion de API keys.

Archivos propuestos:

```txt
apps/web/src/domains/production/providers/credentials/provider-credentials.repository.ts
apps/web/src/domains/production/providers/credentials/provider-credentials.service.ts
apps/web/src/domains/production/providers/credentials/provider-credentials.validators.ts
apps/web/src/domains/production/providers/credentials/provider-credentials.types.ts
```

Responsabilidades del repository:

- `getActiveCredentialMetadata(organizationId, provider)`.
- `getActiveEncryptedSecret(organizationId, provider)`.
- `upsertActiveCredential(...)`.
- `markCredentialValidationSucceeded(...)`.
- `markCredentialValidationFailed(...)`.
- `revokeCredential(...)`.

Responsabilidades del service:

- Validar formato minimo de API key sin asumir estructura privada.
- Cifrar/descifrar con `encrypt` / `decrypt`.
- Validar credencial llamando a HeyGen con un endpoint ligero.
- Redactar errores.
- Devolver metadatos seguros.

Contrato de salida:

```ts
type ProviderCredentialStatus = {
  connected: boolean;
  provider: "heygen";
  last4: string | null;
  status: "ACTIVE" | "REVOKED" | null;
  validationStatus: "NEVER_VALIDATED" | "VALID" | "INVALID" | null;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
};
```

DoD:

- La logica de credenciales no vive en rutas ni componentes.
- Los tests prueban cifrado, revocacion, validacion fallida y no exposicion de secretos.

### Fase 3 - Resolver de cliente HeyGen por organizacion

Objetivo: reemplazar `getHeygenClientForUser` por un resolver de API key organizacional.

Archivo propuesto:

```txt
apps/web/src/domains/production/providers/heygen/heygen-credential-resolver.service.ts
```

Contrato:

```ts
async function getHeygenClientForOrganization(params: {
  organizationId: string;
  allowGlobalFallback?: boolean;
}): Promise<{
  authMode: "organization_api_key" | "global_api_key";
  client: HeygenClient;
  credentialLast4: string | null;
}>;
```

Orden de resolucion:

1. API key activa de `production_provider_credentials`.
2. `HEYGEN_API_KEY` global si `allowGlobalFallback = true`.
3. Error seguro: `HEYGEN_ORGANIZATION_CREDENTIAL_REQUIRED`.

Cambios en `HeygenClient`:

- Permitir API key explicita.
- Evitar que el constructor lea `HEYGEN_API_KEY` implicitamente salvo cuando se cree como fallback global.
- Mantener `accessToken` solo si se decide conservar compatibilidad futura, pero no usarlo en esta fase.

DoD:

- Sync y generacion usan API key de la organizacion.
- Fallback global es explicito y trazable.
- Los logs indican `authMode`, no el secreto.

### Fase 4 - API REST de conexion sin OAuth

Objetivo: exponer endpoints seguros para administrar la API key HeyGen por organizacion.

Rutas:

```txt
GET    /api/production/heygen/connection
POST   /api/production/heygen/connection
DELETE /api/production/heygen/connection
POST   /api/production/heygen/connection/validate
```

`GET /connection`

- Devuelve estado seguro.
- No devuelve API key.

`POST /connection`

Payload:

```json
{
  "apiKey": "string"
}
```

Flujo:

1. Autenticar usuario.
2. Validar organizacion activa.
3. Verificar permiso admin/owner/reviewer autorizado.
4. Validar API key con HeyGen.
5. Cifrar y guardar.
6. Guardar `last4`, `last_validated_at`, `validation_status`.
7. Devolver estado seguro.

`DELETE /connection`

- Revoca credencial activa.
- No borra presets historicos por defecto.
- Marca conexion HeyGen como desconectada.

`POST /connection/validate`

- Revalida la key activa sin reemplazarla.
- Actualiza `validation_status`.

DoD:

- Un admin puede conectar/desconectar HeyGen sin OAuth.
- Un usuario sin permisos no puede guardar ni revocar API keys.
- El cliente nunca ve la API key despues de enviarla.

### Fase 5 - Adaptar sync/catalogo a API key por organizacion

Objetivo: que `/api/production/heygen/sync` use la credencial organizacional.

Cambios:

- Reemplazar `getHeygenClientForUser` por `getHeygenClientForOrganization`.
- `allowGlobalFallback` debe ser configurable:
  - `false` para produccion multiempresa.
  - `true` solo para modo demo/dev si se decide.
- Actualizar `heygen_workspace_connections`:
  - `api_key_last4`.
  - `last_sync_status`.
  - `last_sync_error`.
  - `account_label` si `GET /v3/users/me` lo permite.

DoD:

- Sync trae avatares de la cuenta asociada a la API key de esa organizacion.
- Si no hay credencial, responde 409 con mensaje accionable.
- Si la credencial es invalida, marca validation failed sin exponer key.

### Fase 6 - Adaptar generacion talking head

Objetivo: que todos los jobs HeyGen usen la API key de su organizacion.

Rutas afectadas:

```txt
POST /api/production/heygen/videos
GET  /api/production/heygen/jobs/[jobId]
POST /api/production/heygen/standalone/videos
GET  /api/production/heygen/standalone/videos/[videoId]
```

Reglas:

- Jobs ligados a un componente deben usar `organizationId` del componente.
- Jobs standalone deben usar organizacion activa.
- `input_snapshot.auth_mode` debe registrar:
  - `organization_api_key`
  - `global_api_key`
- No registrar API key, ni hashes reversibles del secreto.
- Idempotency key debe incluir parametros del video, no el secreto.

DoD:

- Un job de empresa A no puede usar credencial de empresa B.
- El polling de status usa la misma organizacion del job.
- El resultado se importa a storage propio.

### Fase 7 - UI del modulo `/admin/heygen`

Objetivo: centralizar la gestion independiente de HeyGen desde el menu lateral.

Cambios de UI:

- Bloque "Conexion HeyGen".
- Estado:
  - No configurado.
  - Conectado y validado.
  - Conectado pero invalido.
  - Error de validacion.
- Formulario:
  - Campo password para API key.
  - Boton "Validar y guardar".
  - Boton "Revalidar".
  - Boton "Desconectar".
  - Mostrar `****1234`, nunca la key completa.
- Acciones:
  - "Sincronizar catalogo" habilitado solo si hay credencial valida o fallback global permitido.
  - Generacion standalone habilitada solo si hay credencial valida.

Eliminar o esconder:

- Boton "Conectar HeyGen" OAuth.
- Copy que hable de login OAuth.
- Dependencia visual de `HEYGEN_OAUTH_*`.

DoD:

- Un admin configura HeyGen desde el modulo independiente.
- El sistema explica claramente si falta API key.
- Los usuarios no admin pueden ver estado limitado o solo usar presets ya configurados.

### Fase 8 - Integracion con flujo normal de assets

Objetivo: mantener HeyGen como proveedor de assets del flujo normal, no como pipeline paralelo.

Cambios:

- Desde Produccion Visual, el CTA "Crear asset HeyGen" debe redirigir a `/admin/heygen` con contexto o abrir panel embebido.
- Soportar query params seguros:

```txt
/admin/heygen?componentId=<uuid>&mode=talking-head
```

- El modulo debe:
  - cargar el componente si hay `componentId`,
  - validar ownership,
  - permitir generar talking head contextual,
  - regresar o enlazar al artefacto/componente.

DoD:

- HeyGen funciona independiente.
- HeyGen funciona desde componente de curso.
- La generacion contextual no permite acceso cruzado entre organizaciones.

### Fase 9 - Configuracion de produccion

Variables requeridas para este modelo:

```env
OAUTH_TOKEN_CRYPTO_SECRET=
RENDER_PROVIDER=desktop_worker
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
COURSEFORGE_JWT_SECRET=
```

Variables recomendadas:

```env
NEXT_PUBLIC_APP_URL=
PRODUCTION_API_URL=
```

Variable opcional:

```env
HEYGEN_API_KEY=
```

Uso de `HEYGEN_API_KEY`:

- Fallback global para demo/dev.
- Fallback controlado si una organizacion aun no configura API key.
- No debe sustituir el modelo multiempresa en produccion salvo decision consciente.

Variables no requeridas en esta fase:

```env
HEYGEN_OAUTH_AUTHORIZE_URL
HEYGEN_OAUTH_CLIENT_ID
HEYGEN_OAUTH_CLIENT_SECRET
HEYGEN_OAUTH_REDIRECT_URI
HEYGEN_OAUTH_SCOPE
HEYGEN_OAUTH_TOKEN_URL
HEYGEN_OAUTH_USERINFO_URL
```

DoD:

- Produccion opera sin variables OAuth.
- Produccion no depende de AWS, CodeBuild, Express legacy ni webhooks.
- Cada organizacion puede operar con su propia API key.

## 4. Implementacion propuesta por orden

### Paso 1 - Crear migracion de credenciales

- Agregar `production_provider_credentials`.
- Agregar indices y constraints.
- Agregar RLS defensiva.

### Paso 2 - Crear capa generica de credenciales

- Repository.
- Service.
- Validators.
- Tests unitarios.

### Paso 3 - Crear resolver HeyGen por organizacion

- `heygen-credential-resolver.service.ts`.
- Tests:
  - usa credencial organizacional.
  - falla si no hay credencial.
  - usa fallback global solo cuando se permite.

### Paso 4 - Refactorizar rutas HeyGen

- `/sync`.
- `/videos`.
- `/jobs/[jobId]`.
- `/standalone/videos`.
- `/standalone/videos/[videoId]`.
- Remover dependencia de `heygen-oauth.service.ts` en rutas productivas.

### Paso 5 - Crear endpoints de conexion

- `GET /connection`.
- `POST /connection`.
- `DELETE /connection`.
- `POST /connection/validate`.

### Paso 6 - Refactorizar UI `/admin/heygen`

- Sustituir OAuth por API key.
- Mostrar estado seguro.
- Habilitar sync/generacion segun conexion.

### Paso 7 - Integrar redireccion contextual desde assets

- CTA en flujo normal.
- Query params `componentId` + `mode`.
- Validacion server-side antes de cargar contexto.

### Paso 8 - Pruebas y regresion

- Unitarias de credenciales.
- Unitarias de resolver HeyGen.
- Integracion de sync con credencial organizacional.
- Integracion de generacion/polling.
- UI states principales.

## 5. Riesgos y validaciones

### Riesgos

- API keys mal protegidas: riesgo critico. Mitigacion: cifrado, no logs, no retorno al cliente, service role controlado.
- Usuario sin permisos guardando credenciales: riesgo alto. Mitigacion: permisos admin/owner.
- Una organizacion usando key de otra: riesgo alto. Mitigacion: resolver siempre por `organization_id`.
- Fallback global ocultando mala configuracion: riesgo medio. Mitigacion: `allowGlobalFallback` explicito y deshabilitado en produccion multiempresa.
- Consumo inesperado de creditos HeyGen: riesgo medio. Mitigacion: estimacion previa, confirmacion y auditoria por job.
- Polling excesivo: riesgo medio. Mitigacion: backoff, botones deshabilitados, no polling global infinito.

### Validaciones tecnicas

Ejecutar:

```bash
npm run test --workspace=apps/web -- src/domains/production/providers/heygen
npm run test:remotion --workspace=apps/api
```

Validacion manual:

1. Admin sin API key ve estado "No configurado".
2. Admin guarda API key invalida y recibe error seguro.
3. Admin guarda API key valida y ve `last4`.
4. Sync muestra avatares/voices de esa cuenta.
5. Generacion standalone crea job.
6. Generacion desde componente crea job contextual.
7. Polling completa/importa MP4.
8. Asset aprobado aparece como `avatar_video`.
9. Usuario de otra organizacion no puede leer ni usar esa credencial.
10. Logs no contienen API keys.

## 6. Mejoras adicionales recomendadas

Obligatorias para salir con calidad:

- Cifrado de API key por organizacion.
- Permisos admin para guardar/revocar.
- Resolver de credencial centralizado.
- Error claro si falta configuracion.
- Tests de seguridad basicos.

Deseables despues del MVP:

- Presupuesto mensual por organizacion.
- Límite de duracion por talking head.
- Historial de validaciones de credencial.
- Auditoria en `pipeline_events`.
- Rotacion asistida de API key.
- Soporte OAuth futuro mediante una interfaz comun de auth provider.
- Subtitulos como asset separado `SUBTITLE`, generado por HeyGen si existe o por Courseforge desde scripts.

## Criterios de aceptacion del MVP actualizado

1. Produccion no requiere `HEYGEN_OAUTH_*`.
2. Cada organizacion puede guardar su API key HeyGen.
3. La API key se valida antes de quedar activa.
4. La API key se guarda cifrada y nunca vuelve al cliente.
5. Sync usa la API key de la organizacion.
6. Generacion talking head usa la API key de la organizacion.
7. Fallback global solo se usa si esta habilitado explicitamente.
8. El modulo `/admin/heygen` funciona de forma independiente.
9. El flujo de assets puede redirigir a `/admin/heygen` con contexto.
10. Jobs, assets e iteraciones mantienen trazabilidad por organizacion.
11. No se rompe upload local, import desde Drive ni Remotion.
12. Las pruebas cubren credenciales, sync, generacion, polling e importacion.
