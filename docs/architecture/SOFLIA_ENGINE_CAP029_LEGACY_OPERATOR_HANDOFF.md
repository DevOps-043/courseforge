# CAP029 — operador privado del piloto legado

Fecha: 2026-10-10. Implementación preparada; **no instalada, habilitada ni ejecutada
contra un ambiente real**. Entry point: `apps/web/tools/html-preview/legacy-operator.mjs`.
Conecta preparación, revisión humana explícita y registro privado con el repositorio
de adopción existente. No agrega otro editor, catálogo UX, renderer ni motor de QA.

## Autoridad y configuración

El host inyecta configuración desde su secret store, no desde el JSON de comando:

| Variable | Uso |
| --- | --- |
| `HTML_LEGACY_OPERATOR_ENABLED` | Solo literal `true` habilita la entrada; cerrado por defecto |
| `NEXT_PUBLIC_SUPABASE_URL` | Origen HTTPS Supabase, sin path, query ni credenciales |
| `SUPABASE_SERVICE_ROLE_KEY`, `COURSEFORGE_JWT_SECRET` | Credenciales privadas; nunca argumentos, JSON de revisión ni logs |
| `HTML_LEGACY_OPERATOR_ACCESS_TOKEN` | JWT Auth Bridge HS256 vigente, `sub` UUID y `exp` obligatorios |
| `HTML_LEGACY_OPERATOR_ORGANIZATION` | Tenant seleccionado por el host y declarado en el JWT |
| `HTML_LEGACY_OPERATOR_HANDOFF_ROOT` | Directorio privado absoluto preexistente para preparaciones |
| `HTML_LEGACY_OPERATOR_INTENT_ROOT` | Directorio privado absoluto preexistente para intenciones de registro |
| `HTML_LEGACY_OPERATOR_KEY_HEX` | Clave aleatoria de32bytes/64hex del host, retenida fuera de ambos directorios |
| `HTML_LEGACY_OPERATOR_CATALOG_PATH`, `HTML_LEGACY_OPERATOR_CATALOG_SHA256` | Solo STAGE_REVIEWED: JSON local instalado independientemente, absoluto y con SHA de bytes exactos |

Las raíces deben ser físicamente distintas y no anidadas; exclusivas del operador,
fuera del repositorio/web/adjuntos/carpetas sincronizadas y separadas de los otros
operadores históricos/reconstrucción. Verificar ACL Windows: mode0600/0700 no las
certifica. La factory rechaza raíces inexistentes/symlinks/equivalentes/anidadas,
pero no instala ACL ni garantiza aislamiento contra escritores privilegiados.
Conservar la clave para recuperación; rotarla exige retener acceso autorizado a
la clave previa. No incluye eliminación/TTL, limpieza de parciales ni compensación.

El CLI valida firma/exp/tenant y rol reviewer **actual** en profiles antes de leer
el comando. Cada RPC revalida membresía/rol/draft actuales. La sesión no proviene
de la preparación. PREPARE y READ_PREPARATION necesitan source/anchor/grants nativos
actuales; READ_REGISTRATION necesita autoridad actual de lectura, no source,
compiler, runtime, catálogo o grants históricos como autorización nueva.

## Invocación manual, solo después de instalar el ambiente autorizado

Desde `apps/web`, compilar primero el código; continuar únicamente con exit0:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
node tools/html-preview/legacy-operator.mjs --request D:/ruta-privada/request.json --sha256 SHA256_DE_LOS_BYTES_DEL_JSON
```

No se carga dotenv ni código JS arbitrario. El comando admite exactamente esos
cuatro argumentos: JSON absoluto, archivo regular sin symlinks/hardlinks, UTF8
estricto, SHA y lectura acotada por handle; máximo16KiB. Timeout total120s, sin
reintentos. Preparación acotada a límites existentes de piloto/candidato; intención
metadata-only<=8192bytes. El catálogo tiene su propio presupuesto compartido.

### 1. Preparar sin instalar ni adoptar

```json
{
  "action": "PREPARE",
  "candidateId": "UUID_NUEVO_RESERVADO",
  "documentId": "UUID_DEL_DRAFT",
  "clipId": "ID_DE_SLIDE",
  "templateId": "ID_DE_TEMPLATE",
  "templateVersion": 1,
  "expectedDocumentHash": "SHA256_NATIVO_GUARDADO"
}
```

Usar base guardada inventariada y emisión existente; nunca inventar revisionId.
Source/anchor/grants se obtienen del RPC autorizado, no del comando. Dos lecturas
actuales rodean la preparación y deben coincidir. El instrumentador/verificador
existente conserva el original y genera un candidato aparte. Perfil/versiones,
source/template/targets/compiled SHA y nativeAnchor quedan ligados a provenance.

Se guarda `<HANDOFF_ROOT>/<candidateId>/artifact.json`, create-only, fsync y
readback: envelope v1 con preparación íntegra y HMAC separado por dominio. La salida
`PREPARED_LEGACY_PILOT_REQUIRES_REVIEW` entrega locator/pins/perfil/revisiones,
**sin** source/encodedPilot/grants. Ni compilación, ni hash, ni sello son aprobación.
Conservar locator y UUID en expediente privado. Si se pierde la salida, consultar
`{"action":"READ_PREPARATION","candidateId":"UUID"}`: carga la preparación
sellada y la reproduce contra autoridad actual; no la modifica ni crea otra.
Una base/perfil/grant cambiado falla explícitamente, no renueva la aprobación.

### 2. Revisar bytes exactos y registrar una sola vez

El revisor autorizado accede al artifact privado, compara original/candidato y
verifica manifest/accesibilidad y autorización de instalación en el ambiente
aislado aprobado. No ejecutar source en un navegador normal ni marcar revisiones
por haber compilado. El workflow no realiza esa comparación humana ni certifica
paridad visual. Registrar evidencia real en el expediente privado.

Instalar/aprobar el catálogo host-owned de forma independiente. El CLI **no** lo
genera desde el paquete, lo copia ni instala templates. Source/version/declaraciones
del catálogo vigente deben coincidir exactamente con el piloto reproducido.

```json
{
  "action": "STAGE_REVIEWED",
  "locator": "OBJETO_LOCATOR_COMPLETO_DEVUELTO_POR_PREPARE",
  "approval": {
    "evidenceSha256": "SHA256_EVIDENCIA_REAL",
    "completedReviews": ["VISUAL_COMPARISON", "MANIFEST_AND_ACCESSIBILITY", "AUTHORIZED_INSTALLATION"]
  },
  "confirmation": "REGISTER_REVIEWED_LEGACY_PILOT_WITHOUT_ADOPTING_OR_INSTALLING"
}
```

Ejemplos son esquemas de campos, no JSON ejecutable: sustituir locator por objeto
íntegro, UUIDs y hashes por valores comprobados. Reviewer se deriva de sesión
actual; no se acepta reviewerId en approval. Puede ser otro actor autorizado del
mismo tenant que el preparador; la evidencia no se transfiere a un actor del JSON.

Revalidar preparación/contexto/catálogo antes de guardar intención durable sellada
en `<INTENT_ROOT>/<candidateId>/review-intent.json`; readback exacto **antes** del
RPC. El repositorio existente reproduce/reautoriza otra vez y despacha un único
`record_html_editing_legacy_candidate`. La salida confirmada es
`LEGACY_CANDIDATE_REGISTERED_NOT_ADOPTED`; no modifica native ni inicializa/adopta.
La revisión y confirmación del inspector existentes usan luego ese candidateId;
su commit separado mantiene CAS/locks y native+HTML+recibo en una transacción.

### 3. Recuperar sin reenviar

Ante salida perdida/error/timeout después de guardar intención, ejecutar únicamente
`{"action":"READ_REGISTRATION","candidateId":"UUID"}`. Lee HMAC/locator,
comprueba el candidato registrado completo contra intención, y retorna metadata
RECORDED o NOT_FOUND. Puede leer un registro revocado o cuya base ya cambió; no
concede autorización actual de adopción (`currentGrant:false`). Requiere mismo
reviewer/tenant y autoridad actual de draft. No recompila ni carga el catálogo.

La intención se conserva incluso tras éxito, NOT_FOUND, revocación, error o
denegación. NOT_FOUND **no** prueba rollback ni permite reenvío; repetir STAGE con
la misma intención falla create-only antes del write. Tampoco usar otro UUID,
borrar/editar el artifact o aprobar un paquete reconstruido para ocultar incertidumbre.
PREPARE perdido usa READ_PREPARATION, registro perdido usa READ_REGISTRATION,
adopción perdida usa recovery del inspector; son resultados distintos.

## SQL, evidencia y límites

SQL incremental28 `20261010180000_read_html_editing_legacy_registration.sql`,
después de27 en el orden completo; dependencia directa de14. Solo lectura privada
service-only bajo autoridad actual, conserva registros revocados. No se aplicó.

Validación local:11 casos del operador y28 de preparación/adopción/coordinador,
más3 casos CLI con JWT real firmado para fixtures/red simulada. Incluye recorrido
de candidato registrado→review→commit/pointer→recibo histórico, original intacto,
drift, tenant/role, intent previo, sustituciones y ACK perdido. No prueba
PostgreSQL/RLS/locks/rollback reales, ACL, revisión humana ni browser/render.

[Auditoría I01](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md),
[adopción existente](SOFLIA_ENGINE_CAP029_LEGACY_ADOPTION_INTEGRATION.md),
[orden SQL](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md),
[puertas de ambiente/QA](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md).
