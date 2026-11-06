# Continuidad F1.3.c.3.c.2 — 2026-11-05

Zona America/Mexico_City; responsable Codex; base 8b06eb70, staging.
Estado: cerrado como lote HTTP local; objetivo global, F1.3 y TD-26 activos.

Siete rutas, diez métodos: storage/media GET; production/assets/[assetId]/download
GET; audio-analysis/assets/[assetId]/waveform GET/POST; audio-processing/jobs
GET/POST; sound-effects GET/POST; sound-effects/[soundEffectId]/download y preview
GET. Preservar 302/307 privados, TTL, filtros tenant, permisos de revisión, paths,
DTO, errores audio/SFX y selección de MIME/transporte existentes.

Solo se añade el mapper compartido al catch exterior de cada método. No cambia
documento/motion, ZIP, render, contratos de proveedor, ingestión o workers. Se
aplica multimedia-production-change para conservar contratos, sin render cloud.

## Evidencia

| Comando | Código / resultado | Archivo |
|---|---|---|
| Suite nueva antes de corregir | 1; 10 fallan por 500 en vez de 503, 8 escenarios de compatibilidad aprueban | f1-3c3c2-before.log |
| Auth Bridge inicial / final | 0 / 0; 106/106 y 108/108 | f1-3c3c2-auth.log / f1-3c3c2-auth-final.log |
| npm run lint | 0; 572 warnings, sin diferencias de huellas | f1-3c3c2-lint.log |
| npm run typecheck | 0 | f1-3c3c2-types.log |
| npm run test:audio-processing | 0; web y API | f1-3c3c2-audio.log |
| npm run test:security-boundaries | 0 | f1-3c3c2-security.log |
| npm run test:hyperframes --workspace=apps/web | 1; alias no resuelto @/lib/server/outbound-http | f1-3c3c2-hyperframes.log; composition-agent-model-output.test |
| npm run db:migrations:check | 0; versiones, no SQL | f1-3c3c2-migrations.log |
| npm run verify:pr | 1; arnés 26/26, OpenSpec 41/41, lint y tipos aprueban; 11 ciclos | f1-3c3c2-gate.log; Madge 2.280 archivos/582 warnings |
| docs:check y openspec:validate finales | 0 / 0 | f1-3c3c2-docs.log / f1-3c3c2-openspec.log |
| git diff --check | 0 | Advertencias CRLF, sin errores |

La suite nueva final contiene 21 tests. Sus diez casos de autoridad recorren 66
pares frontera/clase (identidad, tenant, revisión y componente según la ruta),
comprobando 503/retryable/correlación/no-store y cero clientes privilegiados,
lecturas, firmas, escrituras, jobs o auditoría posteriores al fallo. Los demás
comprueban 401/403/404, redirects privados 302/307, TTL de 600/300 segundos,
download filename y auditoría, rechazo de paths ajenos/inseguros, waveform y
PENDING/NO_AUDIO, creación 202, consulta NOT_REQUESTED y guard de org distinta.
También biblioteca/enlace/multipart, validación 400/415 y límite declarado 413,
errores propios de audio/SFX y 500 genérico sin aceptar códigos falsos de autoridad.

Se ejecutan handlers con Request/FormData/File/NextResponse reales, parser JSON,
schemas y clases de error reales. DB/Storage y operaciones de dominio se sustituyen
por dobles; se registran filtros tenant y parámetros de firma, no se firman URLs
reales. El WAV sintético multipart solo verifica la frontera HTTP: no acredita
validación ni ingestión real de bytes WAV. La waveform positiva es un marcador de
servicio para comprobar su proyección HTTP, no una derivada generada.

## Revisión, límites y continuidad

Revisión propia, sin independencia: diff de producción limitado a imports y diez
guards de catch exterior. No se altera la auditoría opcional: un fallo suyo sigue
permitiendo la descarga previamente autorizada. No cambian TTL, schemas, paths,
MIME, idempotencia, credenciales, generación, firma de workers o estado documental.
La fuente canónica actualiza únicamente la proyección de errores de autoridad.

El fallo HyperFrames reproduce el ya observado en F0.2 sobre el adaptador del
agente de composición, sin cambios en esos archivos en este lote. No se ejecutan
comandos posteriores al fallo ni se certifica suite completa. Requiere reparación
separada del runtime de pruebas como prerrequisito de F3.4; no omitir el test.

No se certifican RLS/SQL ni entrega binaria/Range del Storage real, auditoría real,
ingestión WAV, ejecución FFmpeg o render cloud por estos tests HTTP. La suite de
audio conserva su cobertura propia; su código de salida no es una prueba de
carga ni certificación de proveedores. TD-26 sigue abierto.

Siguiente unidad de autoridad: F1.3.c.3.c.3, conexiones/configuración; después
operaciones HeyGen, slides/open-design, automatización/standalone y soportes HTTP
HyperFrames. F0.3 y el resto del plan global permanecen pendientes.
Reversión: commit local del lote; preservar denegación segura. Sin SQL remoto,
uploads reales, generación pagada, despliegue ni datos de usuario.

Checkpoint: el commit que contiene este registro incluye solo rutas, pruebas,
script Auth Bridge y documentación de esta unidad. Auditoría heredada permanece
fuera. Todos los handles de verificación de la unidad están terminales. No archivar
OpenSpec: F1.3 y aceptación de ambiente siguen pendientes.
