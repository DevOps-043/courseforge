# Continuidad F1.3.c.3.b.2 — 2026-11-04

Zona America/Mexico_City; responsable local Codex. Rama staging; HEAD base
d5e3a713. Se preservan documentación heredada de auditoría y logs previos.
Estado: cerrado como unidad de firma local. TD-26 y aceptación Storage pendientes.

## Objetivo y alcance

Cerrar firma genérica sobre paths arbitrarios de thumbnails/production-videos.
La fuente real y el último turno del chat 01a1a898-ece8-74d3-b514-477d96c65bfd
coinciden en esta siguiente unidad. Sin SQL remoto, instalación, despliegue,
proveedores reales ni uploads de prueba. TD-26 sigue abierto.

Antes del cambio cinco pruebas negativas fallan (exit 1, f1-3c3b2-before.log):
la firma no valida artefacto, permite path ajeno y upsert, acepta metadata ausente
y propósitos alternativos. No es evidencia de explotación remota.

## Contrato y archivos

- signed-upload-url/route.ts: artefacto autorizado ForTenant; path generado por
  UUID bajo tenant/artefacto, extensión MIME permitida, upsert false; rechaza
  firma genérica de production-videos y purpose production-video, y cruces de
  thumbnail con otros buckets/purpose.
- domains/publication/thumbnail-upload-policy.ts: máximo 5 MiB y MIME/extensión
  existentes en migración del bucket; política sin dependencias de servidor.
- CourseDataForm/PublicationClientView: pasan artifactId y purpose; cliente
  conserva uso del path/URL devueltos y upsert false. Solo consumidor encontrado
  de thumbnails. No se encontraron consumidores genéricos de production-videos.
- storage-upload-ownership.test.ts: handler/parser/mapper/política reales;
  identidad, autorización de artefacto y Storage simulados sin credenciales.
  Script Auth Bridge incluye la suite; test previo de autoridad carga política.
- OpenSpec: requisitos, diseño, tablero y este registro. Contrato canónico de
  producción documenta exclusión de firma genérica; no cambia render/importación.

## Evidencia

| Comando | Código | Resultado y límite |
|---|---|---|
| tsc auth + node --test storage-upload-ownership antes del cambio | 1 (tests) | Cinco pruebas rechazan fuente insegura; f1-3c3b2-before.log |
| npm run test:auth-bridge --workspace=apps/web | 0 | 75/75 pruebas y contrato previo; f1-3c3b2-auth.log |
| Auth Bridge final tras admitir thumbnail sin nombre de cliente | 0 | 75/75; dos requests generan paths distintos; f1-3c3b2-auth-final.log |
| npm run typecheck | 0 | f1-3c3b2-types.log |
| npm run test:security-boundaries | 0 | f1-3c3b2-security.log |
| npm run test:publication --workspace=apps/web | 0 | f1-3c3b2-publication.log |
| npm run db:migrations:check | 0 | f1-3c3b2-migrations.log; versiones de 214 archivos, sin SQL |
| npm run test:hyperframes --workspace=apps/web | 1 | f1-3c3b2-hyperframes.log; compila y ejecuta pruebas hasta MODULE_NOT_FOUND en composition-agent-model-output |
| npm run verify:pr, sandbox | 1 | f1-3c3b2-gate.log; git init de fixtures falla por permisos de temporal |
| npm run verify:pr con subprocesos habilitados | 2 | f1-3c3b2-gate-retry.log; 40 ítems OpenSpec y 20 tests arnés aprobados; se detiene en fallo ESLint previo de react-hooks/immutability |
| npm run docs:check final | 0 | f1-3c3b2-docs-final.log |
| git diff --check | 0 | Sin errores, advertencias de conversión CRLF |

La suite HyperFrames se interrumpe por alias @/lib/server/outbound-http desde
composition-agent-provider.service.js. git diff d5e3a713 sobre ese servicio,
composition-agent-model-output.test.ts, tsconfig.hyperframes-test.json y
outbound-http.ts no muestra cambios. No se corrige el runner en este lote y no
se acredita ejecución de los comandos posteriores al fallo. Los logs completos
quedan locales; este documento conserva el resumen versionado.

## Revisión propia y pendientes

Sin independencia: revisión del mismo agente con criterios de seguridad/API/
adversarial-review. El servidor ignora el path de miniatura para escritura y
valida organización del artefacto incluso después del helper. No se cambian
objetos históricos, DTO ni el helper compartido de upload.

SQL versionado: 20260128130000 crea thumbnails público con máximo 5 MiB y cuatro
MIME; 20260318000000 abrió INSERT; 20260908121000 lo retira. La migración
20260228120000 conserva INSERT amplio authenticated para production-videos con
nombre que el endurecimiento no retira. Lectura estática no certifica políticas
efectivas; falta aceptación anon/auth/service y eventual reparación SQL en
entorno descartable. No aplicar ni diseñar reparación amplia sin reconciliar
políticas/grants de ese entorno. Queda pendiente aceptación de Storage además
de roles/RLS de TD-26; no se cierra seguridad integral del almacenamiento.

Otros propósitos conservan contratos previos; no se certifica ownership integral
de production-assets (incluye comprobación por subcadena de componentId).
Los tamaños/MIME enviados son metadata; faltan upload real y QA de publicación.
No se ensayan TUS, replay/TTL de URLs firmadas, limpieza de objetos huérfanos ni CI.

Reversión por commit local de unidad; no hay mutaciones de datos. Conservar
denegación segura si se revierte UI: no reabrir firma arbitraria por compatibilidad.
Siguiente unidad: F1.3.c.3.c, errores HTTP de producción con sus contratos propios.

## Continuidad

Implementación y verificaciones de firma terminadas. Se conserva el checkout
principal; commit recuperable solo con archivos de esta unidad, excluyendo
README, auditoría, system-context y logs heredados. Consultar git log para el ID
del commit que contiene este registro. No archivar el OpenSpec: F1.3 sigue abierto.
