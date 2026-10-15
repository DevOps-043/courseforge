# Incidente: sincronizacion del catalogo HeyGen

Fecha: 2026-10-13. Alcance: una organizacion configurada en el entorno Supabase
de las credenciales locales. Cambios ajenos de audio/editor presentes en el
checkout no forman parte de esta correccion.

## Causa confirmada

Dos ejecuciones del 13 de octubre persistieron `Error desconocido al sincronizar
HeyGen.` La ultima exitosa consultada fue el 24 de septiembre, con 84 avatares
y 2 voces. El identificador mostrado junto al estado en la UI es `account_label`,
no un ID de ejecucion.

La consulta real de HeyGen obtuvo 84 variantes privadas y 2 voces privadas,
paginacion completa y sin IDs duplicados. Una sincronizacion real, autorizada
expresamente por el usuario, reprodujo el error en `reconcileCatalogSnapshot`:

```text
42883: function public.reconcile_heygen_core_catalog_snapshot(uuid, uuid,
timestamp with time zone, jsonb, jsonb, jsonb) does not exist
```

La inspeccion del esquema REST confirmo que existen las funciones
`reconcile_heygen_private_catalog_snapshot` y `reconcile_heygen_catalog_snapshot`,
pero falta `reconcile_heygen_core_catalog_snapshot`. La cadena privada -> core ->
legacy esta rota. No se pudo determinar por que se omitio o retiro la funcion;
el historial de despliegue de migraciones no estaba disponible.

El reconciler privado es transaccional: el error de dependencia revierte su
transaccion. Los numeros visibles no acreditan una sincronizacion nueva ni
eliminaciones recientes en HeyGen.

## Correccion

- Migracion `20261013150000_restore_heygen_core_catalog_reconciler.sql`: restaura
  exactamente el cuerpo de la funcion core de `20260920004500`, comprueba la
  dependencia legacy y revoca ejecucion a PUBLIC/anon/authenticated antes de
  concederla a service_role. No modifica filas durante su instalacion.
- `heygen-catalog-errors.ts`: transforma codigos de errores Supabase lanzados
  como objetos en diagnosticos acotados y seguros. No expone SQL, details, hints
  ni contenido de registros. El codigo 42883 pide aplicar migraciones.
- `heygen-catalog.service.ts`: registra etapa, codigo, request y syncRunId;
  conserva el fallo original si guardar FAILED tambien falla. Usa la hora real
  de cierre para registrar el fallo y preserva clases de errores existentes.
- Tests: reproduccion de 42883 como objeto, etapas posteriores a reconciliacion,
  doble fallo y exclusion de mensajes/codigos inseguros.

No se amplia el fallback no transaccional existente ni se alteran credenciales,
RLS, modelos, voces seleccionadas o exclusiones. El cambio previo de Starfish
es independiente.

## Validacion local y limites

Compilacion `npx tsc -p tsconfig.remotion-test.json` aprobada. Las seis suites de
archivos HeyGen ejecutadas con `node --test` aprobaron 81 pruebas en 12 suites.
ESLint de los tres archivos TypeScript de catalogo modificados aprobado, sin
diagnosticos; `git diff --check` de los cambios versionados aprobado.
La reparacion contiene sin cambios el SQL core anterior y sus grants restrictivos.
No hay runtime PostgreSQL local. La reparacion SQL fue aplicada por el usuario
y posteriormente validada contra el proyecto afectado mediante una sincronizacion
real autorizada, con resultado SUCCEEDED.

Validacion remota: 2026-10-13 09:10:43 America/Mexico_City
(`2026-10-13T15:10:43.411Z`). Funcion core publicada, error de sincronizacion nulo,
84 variantes de avatar y 2 voces, 27 variantes y 9 voces ausentes previamente
persistidas, 0 assets ausentes. Las exclusiones locales conservan exactamente
los mismos valores antes y despues de la sincronizacion. La fecha de ultima
sincronizacion completa avanzo desde `2026-09-24T15:29:51.154Z`.

La reproduccion remota creo una ejecucion FAILED de diagnostico. No genero
audio/video ni cambio el catalogo mediante la reconciliacion fallida. No se
reescribieron las ejecuciones historicas.

## Despliegue y comprobacion

1. Aplicar exclusivamente el archivo de reparacion en el SQL Editor o con el
   proceso autorizado de migraciones. No aplicar todas las migraciones pendientes
   para este incidente. Registrar su instalacion en el proceso de despliegue del
   equipo si se ejecuta manualmente.
2. Comprobar la funcion:

```sql
select to_regprocedure(
  'public.reconcile_heygen_core_catalog_snapshot(uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)'
);
```

3. Ejecutar una sincronizacion desde la UI o mediante el servicio autorizado.
   Confirmar SUCCEEDED, fecha actualizada, 84 variantes y 2 voces si el catalogo
   no cambio, y preservacion de exclusiones locales.
4. Desplegar el codigo de diagnostico para que futuros errores guarden etapa y
   codigo. La reparacion SQL corrige esta causa incluso con el cliente anterior.

La clave service_role permite usar los RPC publicados, pero no instalar SQL.
No hay token de administracion ni conexion SQL configurados. El control del
navegador fallo dos veces al cargar su politica de headers; no se pudo utilizar
una sesion de dashboard como alternativa. Se entrego el archivo SQL al usuario
para aplicacion. El usuario confirmo su ejecucion; la verificacion posterior
confirmo la funcion y la sincronizacion exitosa. El fallo remoto por dependencia
ausente queda resuelto. El despliegue del codigo local de diagnostico sigue
siendo un paso independiente.

## Rollback y seguimiento

La reparacion es compatible con el codigo anterior. No eliminar la funcion al
revertir el cambio de diagnostico: hacerlo reintroduce el incidente. No eliminar
tablas, presets ni exclusiones. Como seguimiento, validar dependencias SQL tras
desplegar migraciones para detectar cadenas parcialmente instaladas.
