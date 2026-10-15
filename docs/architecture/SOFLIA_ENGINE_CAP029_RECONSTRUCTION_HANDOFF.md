# CAP-029 — handoff privado de contenido reconstruido

Estado: handoff/revisión, journal y backend de creación preparados; **no** creación
ejecutada, publicación ni flujo operativo instalado. No hay ruta HTTP
o comando CLI de reconstrucción habilitado por este documento.
Actualización2026-10-10: workflow/factory/CLI privado, apertura independiente y
selección inicial explícita integrados; I03 implementado/preparado, ambiente/QA
pendientes. [Operador vigente](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md).

## Entradas y uso previsto

- `createHtmlHistoricalReconstructionArchivePreparer` produce contenido nuevo,
  procedencia autorizada y paquete completo. No utilizar un artefacto de publicación
  histórica como entrada ni convertir/reparar un ZIP antiguo a este formato.
- `createHtmlReconstructionHandoff({rootDirectory, integrityKey})` requiere un
  directorio absoluto **preexistente**, privado por ACL del sistema operativo, y
  clave de integridad de 32 bytes gestionada por el host fuera de ese directorio.
  No obtener root/key desde navegador, HTTP, metadata o paths del artefacto.
- `save({candidateId, artifact})` conserva ZIP y metadata exactos. Devuelve locator
  con identidad de origen/destino y hashes, sin paths, fuentes o credenciales.
  El candidato no se considera aprobado ni creado por tener locator/recibo local.
- `load(locator)` recupera las mismas bytes tras reinicio, sin adquisición, compilación
  ni ejecución. Verifica sello, estructura, scope y pins; no acredita grants actuales,
  disponibilidad de Storage, permisos SQL, calidad visual o autoridad de creación.

## Archivos y límites

Subdirectorio UUID del candidato dentro del root privado:

- `candidate.zip`: bytes del paquete de contenido nuevo.
- `artifact.json`: scope, candidato, procedencia, documento/revisiones nativas/HTML,
  identidades de recursos, contratos y metadata del paquete. No contiene grants,
  aliases de autoridad, credenciales o aprobación del reviewer.
- `handoff.json`: locator y sello HMAC; escrito **al final**.

Límites centralizados en `HTML_RECONSTRUCTION_POLICY`; metadata incluye documento
nuevo y revisiones además del bundle, por lo que no usa el menor límite de staging
histórico. Lecturas son acotadas y requieren archivos regulares sin hard-links ni
symlinks, root/candidato resueltos, y nombres fijos, nunca paths provenientes de JSON.
Writes create-only con fsync/readback. No sobrescribir, borrar, reanudar ni adoptar
directorios parciales; un save incierto requiere inspección, no otro save automático.

Windows necesita ACL restringida: mode 0600/0700 no la sustituye. El mecanismo no
defiende contra otro proceso del mismo usuario o un writer privilegiado autorizado
en el root. fsync/readback no promete durabilidad universal ante corte eléctrico;
la pérdida de recibo no permite reconstruir/reintentar una creación externa.

## Revisión independiente

Dominio HMAC de reconstrucción distinto del histórico; compartir el mecanismo de
archivos no comparte sello, schema, aprobación ni semántica de publicación.

`readReviewedHtmlReconstructionHandoff` recibe locator, identidad del reviewer
autenticada **por el host** y aprobación estricta ligada a:

1. candidateId;
2. SHA del ZIP completo;
3. SHA exacto de metadata (incluye origen y destino);
4. evidencia SHA y las tres revisiones requeridas de contenido nuevo, procedencia
   y creación autorizada.

Revisión de republicación histórica, hash de otro candidato, metadata distinta o
reviewer diferente son rechazados. El resultado se denomina
`REVIEW_BOUND_RECONSTRUCTION_NOT_CURRENT_AUTHORITY_OR_CREATION`: no es un recibo
persistido de aprobación ni aprobación automática de la app.

## Registro durable de revisión preparado

`HtmlReconstructionReviewRepository` es un adapter exclusivo del host privado:

- `recordReviewed` carga primero el handoff sellado y liga aprobación, origen,
  destino, ZIP y metadata exactos al reviewer autenticado. Registra únicamente
  una atestación pequeña, no el documento/ZIP/candidato completo ni grants.
- `read(record, authenticatedReviewerId)` consulta la identidad exacta después
  de una respuesta incierta. No carga archivos, recompila, sube Storage ni repite
  la escritura. NOT_FOUND no autoriza otra operación.
- `revoke` retira explícitamente la revisión sin borrar su identidad. Volver a
  registrar el mismo candidato no elimina la retirada. No cambia el histórico,
  borrador, componente o selección de publicación.

Conservar la aprobación y el record exactos en el journal privado del operador
antes de invocar la escritura. El handoff ya conserva el origen pero no la aprobación
humana. La integración de ese journal con el comando privado de creación está conectada;
este adapter no instala un CLI, ruta pública o journal operativo automáticamente.

Migración propia preparada: `20261009150000_html_reconstruction_review.sql`, prefijo
libre comprobado antes de crear el archivo. **Sin aplicar**. Tabla privada con RLS y
sin acceso directo incluso de service_role; RPC service-only revalida membership/rol
vigentes y origen exacto bajo locks del lector histórico. No compila el HTML antiguo.
Identidad inmutable por tenant/candidateId; conflictos de evidencia/origen/reviewer
rechazados, read conserva estado de retirada. SQL no acredita que hubo revisión
humana: el host confiable verifica el sello y autentica al revisor fuera del payload.

Receipt/record dice `RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY`.
No prueba permisos actuales de recursos/catálogo, ausencia de UUIDs en DB, Storage
persistido, aprobación para publicación ni creación transaccional. La futura creación
debe volver a comprobar estas condiciones y bloquear una revisión retirada.

## Trabajo obligatorio posterior

Registro de revisión/candidato, journal y transacción create-only para composición
aislada/draft/revisiones/links/procedencia preparados en el corte 2026-10-10; ver
[contratos y límites actuales](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_IMPLEMENTATION.md).
CLI, apertura UI y recuperación por recibo integrados; instalación real pendiente.
Las RPC repiten autoridad SQL vigente; host repite catálogo actual. No tratar los
adapters preparados como un comando operativo ya instalado.
No reutilizar tablas/recibos de append histórico ni modificar borrador/componente original.
CSS contextual estático sin dependencias y selección inicial explícita del tenant
integrados. CSS arbitrario/fontUrls no admitidos; geometría efectiva sigue en I02.

## Evidencia y límites

Seis casos nuevos cubren reinicio sin recompilación, captura por valor, manipulación
de archivos/locator/clave/dominio histórico, parcial/hard-link, revisión exacta y
configuración/traversal/cancelación/metadata inconsistente. Pruebas con fixtures y
directorios temporales privados; las seis regresiones del handoff histórico siguen
pasando tras extraer el mecanismo común. No certifica ACL de producción, aprobación
humana real, SQL/RLS/concurrencia, creación persistente, decode/render ni QA manual.

Corte 2026-10-10: veinte casos adicionales de candidato/persistencia/journal
aprobados; regresión923/923, CLI histórico3/3 e inspector5/5 repetidos. Filesystem
temporal real y DB/Storage con fixtures, SQL inspeccionado estáticamente. No se
instaló la configuración ni se ejecutó creación en DB/Storage reales.
