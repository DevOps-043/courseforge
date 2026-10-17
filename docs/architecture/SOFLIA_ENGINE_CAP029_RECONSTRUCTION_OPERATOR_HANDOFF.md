# CAP-029 — operador privado de reconstrucción independiente

Fecha: 2026-10-10. Implementado CLI/workflow/factory; **no instalado ni ejecutado
contra DB/Storage reales**. No es republicación histórica fiel ni endpoint público.
No instala ejecutores viejos, aplica migraciones, activa contenido o cambia original.

## Configuración privada necesaria

El host inyecta configuración, sin dotenv ni credenciales en argumentos/JSON:

- `HTML_RECONSTRUCTION_OPERATOR_ENABLED=true`: deshabilitado por defecto.
- `NEXT_PUBLIC_SUPABASE_URL` HTTPS, `SUPABASE_SERVICE_ROLE_KEY`, `COURSEFORGE_JWT_SECRET`.
- `HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN`: JWT Auth Bridge HS256 vigente,
  sub/exp requeridos; organización declarada y rol actual reviewer en profiles.
- `HTML_RECONSTRUCTION_OPERATOR_ORGANIZATION`: UUID del tenant seleccionado.
- `HTML_RECONSTRUCTION_HANDOFF_ROOT`, `HTML_RECONSTRUCTION_REVIEW_ROOT`,
  `HTML_RECONSTRUCTION_OPERATION_ROOT`: tres directorios privados preexistentes,
  absolutos, físicamente disjuntos (no iguales, anidados ni symlinks).
- `HTML_RECONSTRUCTION_KEY_HEX`: clave externa de32bytes/64hex. HMAC de dominios
  separados para candidato, revisión e intento; clave fuera de esos directorios.
- Para PREPARE/STAGE/CREATE: `HTML_RECONSTRUCTION_CATALOG_PATH` absoluto y
  `HTML_RECONSTRUCTION_CATALOG_SHA256` del catálogo aprobado **instalado por el
  host**, nunca proveniente del request/archive. Cada invocación vuelve a cargarlo.
- Solo PREPARE: `HTML_RECONSTRUCTION_RUNTIME_PATH` y
  `HTML_RECONSTRUCTION_RUNTIME_SHA256` para renderProfile/renderExecution/
  animationRuntimeSha256 del host.

ACL real restringida en Windows obligatoria; mode0600/0700 no la demuestra. Raíces
fuera de repositorios, web, carpetas compartidas/sincronizadas. El factory comprueba
paths/identidad física, no instala ni certifica ACL. Configuración del catálogo es
snapshot administrado por invocación, no un registro SQL linealizable; revocación
de configuración requiere procedimiento del host. No asumir que HMAC es approval.

## Invocación

Desde `apps/web`, compilar versión local correspondiente:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
node tools/html-preview/reconstruction-operator.mjs --request D:/ruta-privada/request.json --sha256 SHA256_DEL_JSON
```

Archivo JSON local explícito, regular, sin symlink/hardlink, UTF8, tamaño máximo
16MiB y SHA exacto. No se aceptan adaptadores JS, rutas de fuentes, credenciales,
actor, organización, runtime o grants como campos del comando. Error retorna solo
UNCONFIRMED/no-retry: no interpretar como prueba de que la operación no ocurrió.

## Acciones separadas

1. `PREPARE`: compositionId/draftId/revisionId de origen, candidateId nuevo y
   `reconstruction:{target,document,expectedDocumentHash}` del contenido nuevo
   explícitamente autorado. target contiene IDs nuevos y selección de plantilla
   por clip y puede incluir `resourceSelection` explícita descrita abajo.
   Reutiliza preparador/admisión actual; no convierte automáticamente
   fuente antigua. Guarda ZIP/metadata sellados y devuelve locator.
2. Revisión independiente de **esos bytes exactos** en ambiente aislado aprobado:
   contenido/accesibilidad, procedencia y autorización de nueva creación. No abrir
   HTML histórico en navegador común ni declarar revisión visual por tests/hashes.
3. `REVIEW`: locator y approval sin reviewerId (host autenticado lo incorpora),
   candidateId, reviewedProjectHash, reviewedMetadataSha256, evidenceSha256 y las
   tres completedReviews exactas del contrato. Conserva `review-intent.json`
   create-only/fsync/readback/HMAC **antes** del RPC de revisión.
4. `READ_REVIEW` con candidateId reconcilia ACK perdido usando ese journal. No
   recompila/carga ZIP ni repite revisión. NOT_FOUND no permite repetir escritura.
   `WITHDRAW_REVIEW` requiere candidateId y confirmation
   `WITHDRAW_NEW_CONTENT_REVIEW`; conserva revisión histórica revocada.
5. `STAGE` con candidateId y operationId nuevo exige revisión remota vigente exacta,
   carga candidato sellado, verifica autoridad actual y usa journal antes del claim.
   Upload create-only con readback; persiste candidato sin crear composición.
6. `READ_STAGING` con operationId consulta intento/candidato. No upload/retry/adopción.
7. `CREATE` con operationId y confirmation exacta
   `CREATE_INDEPENDENT_CONTENT_WITHOUT_ACTIVATING_OR_CHANGING_ORIGINAL`.
   Relee candidato durable/autoridad, preserva creación intent antes del RPC y crea
   composición separada, componenteNULL, revisión no activa y documento inicial.
8. `READ_CREATION` con operationId recupera receipt, sin repetir creación/Storage/
   compiler. El receipt identifica éxito histórico, no estado actual/publicación.

Creación no asigna el contenido a la lección original ni lo abre automáticamente.
Consulta browser de solo lectura preparada:
`GET /api/production/hyperframes/drafts/{draftId}/html-reconstruction-opening?compositionId={compositionId}`.
Requiere flags `COMPOSITION_HTML_RECONSTRUCTION_OPENING_ENABLED=true` e
`COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED=true`, deshabilitados por defecto;
no activados aquí. Deriva identidad de sesión/tenant, cuotas propias y RPC
service-only actual. Devuelve identidad aislada y hash/versión actuales separados
del hash inicial; no fuente/documento/paths/approval ni acceso basado solo en receipt.
No requiere acceso actual al origen como sustituto del acceso al contenido nuevo.
La página `/admin/assembly/reconstruction/{draftId}?compositionId={compositionId}`
monta el studio existente después de autenticar/reautorizar identidad actual; query
estricta separada del path, sin actor/tenant desde URL. `CREATE` y `READ_CREATION`
RECORDED retornan `editorPath` como pista de navegación, nunca como permiso.
No navega automáticamente ni incorpora la biblioteca del componente original.
Studio usa componentIdNULL explícito: no generar/preensamblar/recuperar escenas del
componente original, separar audio o procesamiento de voz por ese componente.
Preserva edición nativa/HTML y readers/saves normales del nuevo draft. Waveform
por componente no se consulta en este scope; ninguna identidad ficticia sustituye
la autorización. Biblioteca actual y enlace puntual de recursos nuevos del tenant
ya están conectados; no se importa la biblioteca original. La preparación inicial
de recursos independientes está conectada, separada del enlace posterior a creación.
No usar initialize/getOrCreate del componente original como sustituto.

Sin cleanup/resume/overwrite/adopción de parciales. Fallo de journal/readback impide
write remoto; preservar evidencia. Pérdida de clave/journal requiere reconciliación
operativa explícita, no reconstruir silenciosamente el candidato aprobado.

## Evidencia y límites

Ocho casos dirigidos del workflow con journals concretos, repositorio de creación
real y autoridad concreta contra fixtures; tres del CLI (incluido JWT real y fetch
simulado); tres regresiones CLI histórico. La revisión remota del workflow usa fake;
el adapter tiene sus pruebas propias. Ninguna prueba aplica SQL, instala ACL,
autoriza un ambiente, decodifica/renderiza medios o acredita revisión humana.

[Orden SQL manual](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).
CSS contextual estático sin recursos ya está conectado a ambos targets y a
reconstrucción bajo el perfil static-fragment-v3-contextual-css, con migración
incremental paso23 preparada (no aplicada). FontUrls y dependencias CSS siguen
rechazadas; no confundir este alcance con soporte global arbitrario.
Revisión operativa integrada y preparación inicial de recursos independientes
completadas a nivel de implementación preparada; instalación/revisión humana/QA reales
pendientes. I03 implementado, no CAP029 completa.
[Estado general](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md).

## Biblioteca del editor independiente — 2026-10-10

La página abre el studio con los medios actualmente vinculados al NUEVO borrador,
en vez de suministrar una biblioteca vacía. Reutiliza el selector/inserción/reemplazo
existentes; no importa biblioteca de componentes ni catálogo UX reservado.
GET `html-reconstruction-library` tiene autorización actual, quotas, límite de bytes
y páginas keyset de20. Páginas siguientes requieren hash/version de la base; un
cambio exige actualización explícita, sin retry ni mezcla de páginas. Total<=250
(contrato actual de manifest); cancelación al salir y bloqueo de consultas solapadas.

Lectura de metadatos no es grant de edición: los handlers normales siguen verificando
enlaces/identidades. No thumbnail/signed URL desde este lector. No adjunta un medio
nuevo ni escribe el borrador, Storage o el original. Error/vacío/carga son explícitos.
Para instalar: SQL paso24 tras el bloque previo, con flags existentes cerrados hasta
validar staging. Pruebas automatizadas con RPC simulado y SQL estático; no prueba UI
real ni SQL aplicado. El siguiente corte añade anexado posterior a creación;
En este corte histórico faltaban preparación inicial y revisión operativa; el
corte siguiente de selección inicial las conecta sin importar enlaces del origen.

## Vincular un medio registrado de la empresa — 2026-10-10

SQL25→26 después de24, según runbook; no aplicados aquí. Para habilitar escritura
se requieren opening+inspector+mutations y
`COMPOSITION_HTML_RECONSTRUCTION_RESOURCE_LINK_ENABLED=true`; cerrado por defecto.
No requiere habilitar este último flag para consultar medios o recuperar recibos.

En el editor independiente: consultar seguimiento local, introducir UUID de un
medio registrado del tenant, consultar/revisar metadata y confirmar «Vincular al
borrador nuevo». No sube archivos, importa fuente ni inserta en timeline; después
usar el selector/inserción/reemplazo existentes. Refresca biblioteca tras confirmación.
Las páginas no son un snapshot transaccional de enlaces: ante cambios concurrentes
de biblioteca, actualizar explícitamente desde la primera página, sin mezclar bases.

Pendiente: consultar recibo sin reenviar; cerrar tracking solo tras nueva consulta
autorizada. Un rechazo confirmado por base/recurso/límite puede cerrarse y revisarse
otra selección. NOT_FOUND, auth revocada, ausencia de lock/storage o tracking corrupto
no autorizan segundo POST ni borrado. No borrar revisiones/recibos backend.

Validación local34/34 dirigidas y980/980 regresión; fake RPC/SQL estático y montaje
estructural no prueban RLS/locks ni UI real. QA pendiente: sesión/tabs/refresh/ACK
perdido/revocación, carrera save/link y colisiones/límite, comprobando original y
documento intactos. No habilitado ni instalado; ver cierre posterior de I03 abajo.

## Selección inicial independiente — 2026-10-10

Después de instalar SQL29 tras28 y desplegar código/contratos correspondientes,
PREPARE admite este campo opcional dentro de `reconstruction.target`:

```json
{
  "resourceSelection": {
    "scope": "CURRENT_TENANT_RESOURCE_SELECTION_NOT_GRANTS",
    "productionAssetIds": [],
    "soundEffectAssetIds": [],
    "branding": {"introAssetId": null, "outroAssetId": null}
  }
}
```

Reemplazar listas con UUIDs de medios registrados/actualmente admitidos del tenant
que usa el documento NUEVO. `productionAssetIds` reúne imágenes HTML y medios
nativos PRODUCTION; SFX y branding tienen clases separadas. Intro/outro requieren
placement coincidente. Conjunto exacto, sin IDs extra, faltantes, ambiguos o más
de250; no fields de Storage/URLs/grants/actor/tenant. Lista vacía solo si no hay
referencias de ese tipo. Sin este campo se conserva el camino anterior de enlaces
del origen; nunca ampliar autoridad automáticamente ni reescribir artefactos previos.

El host analiza referencias reales antes del RPC único service-only; verifica
tenant/origen/selección/pins/conjunto/placement/MIME y refresca al finalizar el
paquete. Fonts conservan adquisición tenant READY y checksum/readback, no vienen
de grants históricos. Antes/después de staging y antes de CREATE se reautoriza;
SQL repite checks y crea links solo del nuevo draft/revisión. No sustituye upload,
catálogo de plantillas ni aprobación. Cambios después de revisar exigen candidato
nuevo/revisión nueva, no reconstruir ZIP aprobado o reutilizar evidencias.

Auditoría I03 de implementación preparada: selección inicial→factory/preparador/
compiler→handoff/journal→review durable→stage/store create-only→create aislado→
recovery/opening/editor conectados. Diez casos nuevos y1012/1012 regresión; CLI9/9,
tipado/lint dirigidos aprobados. RPC/Storage son simulados; pérdida de ACK de
review/create y reinicio verifican que no se repiten escrituras. No instalación,
SQL/RLS/ACL/Storage/browser reales, revisión humana o QA ejecutados.
[Auditoría](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md).
