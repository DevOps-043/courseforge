# CAP-029 — orden SQL para aplicación manual

Fecha: 2026-10-10. Archivos preparados, **no aplicados ni certificados contra una
BD real desde esta conversación**. Este orden no demuestra que el ambiente tenga
los prerrequisitos. No ejecutar todos los archivos a ciegas ni usar `BD.sql` como
migración: es un inventario compartido, no el instalador de este bloque.

## Antes de ejecutar

1. Confirmar proyecto/ambiente Supabase y respaldo recuperable. Primero staging.
2. Cotejar historial de migraciones y definiciones reales. Los archivos contienen
   `CREATE TABLE/FUNCTION` no necesariamente reejecutables. **Omitir lo ya aplicado
   únicamente tras comprobar que su definición coincide**, no por existir el nombre.
3. Base de Courseforge previamente instalada: organizations/profiles/membresías,
   artifacts, video_compositions/revisions/drafts/documents/changes, recursos y
   enlaces de draft/revisión (production, branding, SFX) y fuentes del tenant.
   Las migraciones HTML no sustituyen la instalación de esas tablas/policies.
4. No aplicar migraciones CAP027/CAP022 del compañero como parte de esta lista.
   Mantener flags/CLI deshabilitados hasta verificar instalación y autorización.

## Base HTML, solo archivos todavía pendientes

Orden cronológico de los archivos **HTML específicos**. Las migraciones generales
de Courseforge que introducen sus tablas dependientes deben estar instaladas antes.
No es un bootstrap de una BD vacía ni una afirmación del historial remoto.

| Orden | Archivo en `supabase/migrations/` |
| ---: | --- |
| 1 | `20261005200000_html_editing_revision_store.sql` |
| 2 | `20261005210000_append_html_editing_native_document.sql` |
| 3 | `20261005220000_read_exact_html_editing_compilation.sql` |
| 4 | `20261005230000_controlled_html_editing_authority.sql` |
| 5 | `20261006000000_html_snapshot_resource_validation.sql` |
| 6 | `20261006010000_commit_html_editing_snapshot.sql` |
| 7 | `20261006020000_read_html_snapshot_operation.sql` |
| 8 | `20261006030000_html_snapshot_durable_intents.sql` |
| 9 | `20261006050000_html_editing_bootstrap_registration.sql` |
| 10 | `20261006060000_read_html_editing_bootstrap_context.sql` |
| 11 | `20261006070000_read_html_editing_restore_revision.sql` |
| 12 | `20261006080000_html_editing_operation_receipts.sql` |
| 13 | `20261006090000_html_editing_initialization_receipts.sql` |
| 14 | `20261008100000_html_editing_legacy_adoption.sql` |

No existe un paso HTML `20261006040000` en este corte; no inventarlo. La adopción
legada es parte del editor, no un permiso para reconstruir HTML no admitido.

## Bloque histórico y reconstrucción, después de la base

| Orden | Archivo en `supabase/migrations/` | Función |
| ---: | --- | --- |
| 15 | `20261009110000_read_html_editing_snapshot_history.sql` | Inventario histórico autorizado |
| 16 | `20261009120000_read_html_editing_snapshot_archive.sql` | Identidad exacta del ZIP original |
| 17 | `20261009130000_html_historical_publication.sql` | Staging/receipt y nueva revisión histórica inactiva |
| 18 | `20261009140000_read_html_historical_staging.sql` | Recuperación histórica de solo lectura |
| 19 | `20261009150000_html_reconstruction_review.sql` | Revisión independiente del contenido reconstruido |
| 20 | `20261010100000_html_reconstruction_candidates.sql` | Intento/candidato privado e inmutable |
| 21 | `20261010110000_create_html_reconstruction.sql` | Creación atómica aislada y receipt |
| 22 | `20261010120000_read_html_reconstruction_opening.sql` | Consulta actual de identidad/procedencia para apertura aislada |
| 23 | `20261010130000_html_reconstruction_contextual_css.sql` | Admisión acotada de CSS contextual estático, sin URLs de fuentes; conserva checks de autoridad/revisión/recursos |
| 24 | `20261010140000_read_html_reconstruction_library.sql` | Biblioteca paginada de recursos actualmente vinculados al borrador independiente; lectura, no anexado/importación |
| 25 | `20261010150000_html_reconstruction_resource_selection.sql` | Admisión/proyección comunes y consulta puntual autorizada de un medio del tenant por UUID |
| 26 | `20261010160000_link_html_reconstruction_resources.sql` | Enlace explícito solo al nuevo draft, recibos atómicos de éxito/rechazo y recuperación de lectura |
| 27 | `20261010170000_read_html_editing_legacy_inventory.sql` | Inventario actual paginado de fuentes/pointers/registros de slides del borrador, solo metadatos |
| 28 | `20261010180000_read_html_editing_legacy_registration.sql` | Recuperación privada de registro de piloto, cotejo del candidato íntegro, incluyendo revocados sin readopción |
| 29 | `20261010190000_html_reconstruction_selected_resources.sql` | Selección inicial explícita y exacta de medios vigentes del tenant para reconstrucción independiente; revalidación y enlaces solo al contenido nuevo |

Los pasos17–18 pertenecen al recorrido histórico exacto, no son autorización para
la reconstrucción. El recorrido reconstruido depende directamente del lector16,
la base de identidad/recursos y los pasos19→20→21. Para instalar ambos recorridos
del bloque completo conservar el orden15→29. El paso22 requiere21; no permite
abrir un recibo como si fuese autorización de estado actual ni inicializa contenido.
El paso23 reemplaza únicamente el validador privado introducido en20 y conserva
sus controles. Aplicarlo después de22 y desplegar el código del perfil
`courseforge-html-static-fragment-v3-contextual-css` antes de habilitar entradas.
No editar ni volver a aplicar20 para introducir esta actualización. SQL no analiza
CSS: admisión estática, presupuesto y aislamiento pertenecen al compilador host.
El paso24 reutiliza la autorización y locks del lector22 y la unicidad/index
`(draft_id,production_asset_id)` de la base; no instala un catálogo de plantillas,
no obtiene Storage URLs ni agrega enlaces. No requiere un índice duplicado.
El paso25 requiere22/24: reemplaza el lector24 para compartir exactamente la
admisión y proyección de metadatos con la selección puntual. No editar ni repetir24
después de25. El paso26 requiere25 y la base de enlaces del draft; serializa contra
ediciones nativas, comprueba hash/versión y recurso actuales y registra el resultado
junto al enlace en la misma transacción. Nunca escribe el documento ni el original.
No instala uploads ni el catálogo UX reservado. Flag nuevo
`COMPOSITION_HTML_RECONSTRUCTION_RESOURCE_LINK_ENABLED` cerrado por defecto;
las consultas/recuperación requieren apertura, no habilitar escrituras para leer.
Comprobar antes de25 que `to_regprocedure('pg_catalog.sha256(bytea)')` no sea NULL;
no se instala ni requiere una extensión adicional para estos hashes.
El paso27 usa autoridad/registro HTML de la base y la identidad nativa actual;
no depende de haber creado contenido reconstruido. Conservar orden completo para
esta instalación; no altera25/26 ni registra/adopta candidatos. Requiere SHA nativo,
como25/26. Flags nuevos `COMPOSITION_HTML_LEGACY_INVENTORY_ENABLED` (server) y
`NEXT_PUBLIC_COMPOSITION_HTML_LEGACY_INVENTORY_ENABLED` (panel), ambos cerrados
por defecto y subordinados a sus flags de inspector. No activados aquí.
El paso28 depende directamente del store14 y de la autoridad actual del draft;
no exige reconstrucción ni sustituye lectura vigente de candidato/adopción. RPC
service-only, mismo reviewer/tenant/draft/clip/candidato; resultado histórico incluso
revocado. No recompila, revalida source o transforma el registro en grant actual.
`HTML_LEGACY_OPERATOR_ENABLED` y raíces/clave/catálogo son instalación separada;
no se habilitan al aplicar SQL. [Operador](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md).
El paso29 requiere16/20/21/23/25 y se aplica después de28 en esta secuencia. Añade
un lector privado service-only y sustituye únicamente los helpers de validación
de candidato y enlace de reconstrucción. No repetir20/21/23 después de29: restauraría
definiciones anteriores. Candidatos sin `target.resourceSelection` conservan la
autoridad por enlaces del draft origen. Con selección explícita se comprueban
origen/actor/tenant, conjunto exacto, estado e identidad actuales, placement de
branding y límites; fonts mantienen la política existente READY del tenant.
No registra medios, descarga archivos, instala catálogo ni cambia el original.
SQL preparado, no aplicado; requiere desplegar el adapter/contrato correspondiente
antes de habilitar PREPARE/STAGE/CREATE. No habilitar flags por aplicar este SQL.

Consulta preliminar **de solo lectura** antes del bloque nuevo:

```sql
SELECT name, to_regclass(name) AS installed_relation
FROM unnest(ARRAY[
  'private.composition_html_templates', 'private.composition_html_revisions',
  'public.video_compositions', 'public.video_composition_revisions',
  'public.video_composition_drafts', 'public.video_composition_draft_documents',
  'public.video_composition_draft_changes'
]) AS name;

SELECT name, to_regprocedure(name) AS installed_function
FROM unnest(ARRAY[
  'private.assert_html_editing_actor(uuid,uuid)',
  'public.read_html_editing_compilation(uuid,uuid,uuid,text)',
  'private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb)'
]) AS name;

SELECT to_regprocedure('pg_catalog.sha256(bytea)') AS native_sha256;
```

NULL significa prerrequisito ausente; detenerse. Un valor noNULL solo demuestra
existencia, **no equivalencia de definición, permisos o corrección funcional**.
Revisar también recursos/columnas/RLS dependientes y comparar definiciones contra
los archivos. Tras el paso16 debe existir
`public.read_html_editing_snapshot_archive(uuid,uuid,uuid,uuid,uuid)`.

## Aplicación y verificación

Ejecutar **un archivo completo por vez**, respetando su BEGIN/COMMIT. Ante error,
detener la secuencia y cerrar/rollback de la transacción fallida; no borrar tablas,
quitar validaciones ni saltarse el archivo. Registrar nombre, resultado y ambiente
en el expediente/historial acordado. Ejecutar SQL manualmente no implica que la
herramienta de migraciones actualice su historial automáticamente.

Después comprobar RLS activado y acceso directo revocado en tablas privadas,
EXECUTE solo service_role en RPC públicos, restricciones/FK/índices y definiciones
exactas. Validar con usuarios/tenant de staging: acceso cruzado denegado, revocación,
IDs existentes, rollback completo, concurrencia e incertidumbre recuperada por
receipt. No introducir credenciales reales en el expediente.
Para25–26 verificar además: RPC puntuales service-only; helpers y tabla privada
sin acceso directo; UUID de otra empresa denegado; recurso revocado; cambio de
base; límite250; colisión de operación y enlace; carrera con save; pérdida de ACK
y GET del recibo sin repetir POST. Rechazos BASE_CHANGED/RESOURCE_CHANGED/LIMIT
deben dejar recibo negativo, sin enlace/documento nuevo. Recibo ausente no prueba
rollback ni autoriza reenvío. Revisar que JSON/digest coincidan con los contratos.
Para27 cotejar el RPC service-only y lecturas bajo locks draft/actor/composición;
versión del documento igual a current_version; página20/cota500/cursor ordinal
ligado a hash+versión. Probar tenant cruzado/revocación/archivado, no emisión activa,
base modificada entre páginas, registro revocado/sin pointer/fuente distinta,
entrada malformada y fin/vacío. No debe exportar HTML, paquetes o URLs ni escribir
documento/registro. Un inventario no sustituye la verificación exacta del inspector.
Para28 verificar EXECUTE service-only/sin acceso directo a tabla; current actor y
draft válidos, reviewer distinto/tenant cruzado denegados; registro ausente y
revocado; lectura tras adopción/cambio de base sin exigir source/grants/catálogo.
Comparar candidato completo, no solo UUID. La intención durable local permanece
ante NOT_FOUND/403/error y la recuperación no escribe ni permite repetir registro.
Para29 verificar además: EXECUTE service-only y helpers sin acceso directo; origen
o tenant ajeno denegados; selección faltante/extra/duplicada/clases mezcladas y
branding contradictorio rechazados; recurso revocado o identidad cambiada bloquean
staging/creación; ausencia de selección conserva el camino anterior. Probar medios
no enlazados al origen, fonts READY vigentes, enlaces solo al NUEVO draft/revisión,
rollback atómico y pérdida de ACK sin repetir creación. Las pruebas locales con
RPC/Storage simulados y checks SQL estáticos no certifican estas propiedades en DB.

Rollback de despliegue: deshabilitar entrada/flags y conservar auditorías/candidatos
para reconciliación; no hay script de DROP/destrucción autorizado. Un ZIP huérfano
tras fallo de staging no se elimina como compensación automática.

Instalar SQL no habilita catálogo, ACL de host, Storage ni UI; tampoco concluye
CAP029 o sustituye QA. [Métrica](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md).
