# CAP-029 — handoff privado de revisión histórica

## Alcance

El workflow `createHistoricalHtmlOperatorWorkflow` conecta el preparador autorizado,
el handoff privado en disco y `HistoricalHtmlPublicationRepository`. No es una ruta
HTTP ni una herramienta de aprobación pública. No activa revisiones, cambia el
borrador ni ejecuta HTML. El entrypoint privado es
`apps/web/tools/html-preview/historical-operator.mjs`; requiere configuración y
autorización explícitas del ambiente. Su disponibilidad no acredita instalación.

## Configuración del host

- Directorio privado absoluto preexistente, fuera de repositorios, contenido web,
  carpetas compartidas/sincronizadas y archivos adjuntos públicos. Acceso exclusivo
  al proceso/operador autorizado. En Windows comprobar ACL; mode0600/0700 no basta.
- Clave de integridad de32 bytes aleatorios del secret store del host. Mantenerla
  separada del directorio; nunca incluirla en JSON, ZIP, browser, argumentos/logs.
  Conservar la misma clave para leer el handoff después de reiniciar. Rotarla hace
  ilegibles los handoffs anteriores salvo procedimiento de retención de claves.
- Preparador con identidad/tenant/runtime y Supabase suministrados por el host
  autenticado, no extraídos de archivos importados o peticiones de aprobación.
- Repositorio service-only y store create-only existentes. Migraciones/flags y
  permisos del ambiente requieren aprobación separada; este documento no los activa.

## Flujo obligatorio

1. `workflow.prepareForReview(input)` adquiere y verifica el original/documento
   exacto/recursos vigentes. Escribe un subdirectorio con UUID de candidato:
   `candidate.zip`, `artifact.json`, `handoff.json`. Retorna un locator de metadatos.
   Los archivos son create-only, sincronizados y releídos; receipt escrito al final.
   Conservar locator en el expediente privado del operador.
2. El revisor independiente inspecciona **esos bytes exactos**. Comparación visual
   histórica, contenido/accesibilidad actuales y autorización de republicación
   requieren evidencia real. No abrir/ejecutar ZIP en un browser normal para hacer
   esta revisión; usar exclusivamente el ambiente de revisión aislado aprobado.
   El sello HMAC acredita integridad del handoff, no aprobación ni seguridad del HTML.
3. La aprobación aporta reviewer autenticado, SHA del ZIP completo revisado, SHA de
   evidencia y las tres revisiones requeridas. No aprobar solo el bundle interno,
   un nombre de archivo o una comparación de hashes de salida.
4. `workflow.stageAfterReview({locator, approval, signal})` carga los bytes sellados
   sin invocar al preparador. El repositorio verifica payload/autoridad actual y
   persiste locator de intento **antes** de su primer write remoto; realiza staging
   create-only y revalidación. Entregar candidateId/candidateSha256 registrados al
   panel histórico autorizado, que registra una revisión nueva **no activa**.
5. Respuesta incierta de staging: usar `workflow.readStaging(locatorDeStaging)`.
   El locator de handoff local y el locator de staging son contratos distintos.
   No repetir staging, subir de nuevo, borrar un posible orphan o reconstruir tras
   aprobación. NOT_FOUND no demuestra que un write remoto no ocurrió.

## Fallos y límites

- Un directorio existente, receipt incompleto, ZIP/JSON alterados, clave incorrecta,
  identidad distinta, symlink o archivo no regular se rechazan. No limpiar/reanudar
  automáticamente; conservar evidencia y reconciliar con el operador.
- Los reads son acotados por tamaños y usan handles; no extraen ni ejecutan ZIP.
  La clave sella identidad + SHA de metadata + SHA ZIP. No protege frente a un
  atacante con la clave, acceso al proceso o privilegios de administrador.
- El directorio debe estar bajo control exclusivo del host; no ofrece aislamiento
  contra carreras de escritores privilegiados. Fsync de archivos/readback no es
  certificación de persistencia ante pérdida de energía en cualquier filesystem.
  La pérdida local antes del staging no autoriza reconstrucción/reaprobación tácita.
- Sin borrado/TTL automático. Retención, copia segura y eliminación del expediente
  deben definirse en el ambiente; nunca eliminar como compensación de un ACK incierto.
- Tests locales/fakes no prueban ACL de Windows, Storage/RLS/SQL, permisos del revisor,
  comparación visual, decodificación de fuentes/medios ni rollback/concurrencia reales.

## Uso del entrypoint privado

Desde `apps/web`, compilar el código local antes de invocarlo:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
node tools/html-preview/historical-operator.mjs --request D:/ruta-privada/request.json --sha256 SHA256_DEL_JSON
```

No se carga dotenv ni se importan adaptadores JS arbitrarios. El host inyecta estas
variables desde su secret store/configuración, nunca como argumentos del CLI:

- `HTML_HISTORICAL_OPERATOR_ENABLED=true` (deshabilitado por defecto).
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `COURSEFORGE_JWT_SECRET`.
- `HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN`: JWT Auth Bridge vigente, HS256, sub UUID
  y exp obligatorios. No es un token GoTrue. Se comprueba organización declarada y
  rol reviewer actual en profiles; los RPC vuelven a comprobar autoridad actual.
- `HTML_HISTORICAL_OPERATOR_ORGANIZATION`: UUID del tenant seleccionado por el host.
- `HTML_HISTORICAL_HANDOFF_ROOT`, `HTML_HISTORICAL_HANDOFF_KEY_HEX`: raíz privada y
  clave de32bytes codificada como64 caracteres hex, separada del expediente.
- Solo PREPARE requiere `HTML_HISTORICAL_OPERATOR_RUNTIME_PATH` absoluto y
  `HTML_HISTORICAL_OPERATOR_RUNTIME_SHA256`: archivo JSON host-owned con
  renderProfile, renderExecution y animationRuntimeSha256 admitidos. No elegirlos
  desde el request del usuario ni inventar pins para superar una comprobación.

El JSON de comando es estricto y su SHA se comprueba antes de parsearlo (128KiB,
UTF8 estricto, archivo regular sin symlinks/hardlinks, lectura por handle acotada):

- PREPARE: action, compositionId, draftId, revisionId, candidateId. Actor/tenant se
  instalan desde autenticación; no se aceptan en el JSON. Retorna locator local.
- STAGE: action, locator local y approval con reviewedProjectHash, evidenceSha256,
  completedReviews. Reviewer se fija al principal autenticado, nunca desde JSON.
  Esta acción realiza writes remotos: requiere autorización operativa explícita.
- READ_STAGING: action y locator de staging completo (no el locator local).
  Requiere mismo tenant/reviewer y consulta solo metadata, sin preparar/subir.

Salida JSONL: PREPARED_FOR_INDEPENDENT_REVIEW, STAGING_ATTEMPT_LOCATOR_NOT_ACK,
STAGED_NOT_PUBLISHED o resultado de recuperación. Capturar la salida en el
expediente privado: el locator previo al write ayuda a reconciliar, pero stdout no
reemplaza el journal backend durable. Error: UNCONFIRMED, retryable:false, exit1;
conservar seguimiento y no repetir staging. No imprimir secretos ni stack traces.

## Estado

Handoff privado, workflow y entrypoint implementados; configuración/instalación y
ejecución autenticada real siguen diferidas al ambiente autorizado. I03/CAP-029
mantienen auditorías pendientes; QA manual final no está habilitado por este documento.
