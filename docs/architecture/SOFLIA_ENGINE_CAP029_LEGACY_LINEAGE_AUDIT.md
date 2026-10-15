# CAP029 — auditoría de trazabilidad del legado

Fecha: 2026-10-10. Lectura del worktree actual, no inventario de una BD real.
Objetivo I01: recorrido original→piloto→revisión/instalación autorizada→pointer
verificable, manteniendo fuente/versión originales. No ampliación de operaciones.

| Requisito | Evidencia actual | Estado |
| --- | --- | --- |
| Descubrir slides guardadas sin asumir que son editables | RPC27, repository/GET/client y panel del recovery center: hash/bytes/pointer/registro, tenant actual, cursor ligado a native hash/version | Implementado/preparado; DB/browser pendientes |
| Fuente original exacta e IDs semánticos del candidato | `html-editing-legacy-instrumentation.server.ts`: original inalterado, candidato aparte, target map acotado, IDs existentes preservados | Implementado; no aprobación visual inferida |
| Versiones y hashes reproducibles | Provenance v1 incluye instrumentationVersion, compiler/geometry/isolation profile, nativeAnchor, original/candidate/template/targets/compiled SHA; verificador reproduce paquete completo con entrada autorizada | Implementado; perfiles anteriores incompatibles requieren nueva revisión, no reinterpretación |
| Catálogo independiente vigente | `prepareHtmlEditingLegacyAdoption` resuelve template/source/version y compara declaración instalada con el piloto regenerado | Implementado; instalación real separada |
| Preparación/registro del piloto operables | Workflow/factory/CLI privados conectan preparador existente, doble lectura autorizada, HMAC/readback y `stageReviewedCandidate` con catálogo independiente; identidad reviewer desde JWT/profile actuales | Implementado/preparado; instalación y revisión humana reales pendientes |
| Registro incierto recuperable sin readopción | Intención metadata-only durable antes del RPC; SQL28/repository/READ_REGISTRATION cotejan candidato completo, incluso revocado, sin compiler/catálogo/source/grants históricos | Implementado/preparado; no reenvío ni borrado ante NOT_FOUND |
| Commit original→native pointer y recibo atómicos | Migración14, repository, transporte/coordinador: CAS base, aprobación actual, fuente original, inicial editorial y native/receipt; checks exactos después | Implementado/preparado; transacción PostgreSQL real pendiente |
| Revisión/confirmación y recuperación del usuario | Inspector, panel/candidatos y recovery center conectados, fuente en texto escapado, SEND separado, GET ante incertidumbre | Implementado; QA browser/tenant real pendiente |

El inventario no expone sourceHtml, encodedPilot, grants, Storage paths o URLs.
Registro revocado y hash distinto permanecen visibles; no se borran ni se corrigen.
Pointer presente no acredita pointer válido. La verificación del inspector/reader
sigue siendo necesaria y reautoriza recursos actuales.

Consulta sobre una base guardada concreta, no todo el catálogo de componentes ni
historial remoto. Límite nativo500 clips, página20/lookahead21, cursor ordinal bajo
hash+versión. Una actualización exige reiniciar; sin acumulación masiva ni N+1 HTTP.
SQL no renderiza ni sanitiza HTML para fingir compatibilidad. Falta revisión de
emisión no oculta slides, pero impide el piloto actual; no inventar revisionId.

Resultado actualizado: **I01 completo a nivel de implementación preparada** para
el perfil admitido. El faltante comprobado de callers operativos queda cubierto
por el operador concreto; no por reclasificar código faltante como QA. La auditoría
liga inventario→original/nativeAnchor→piloto reproducido→catálogo independiente/
revisión registrada→confirmación del inspector→nuevo native pointer/recibo. El
source original queda en la versión anterior; template/source/manifest/revision SHA
y provenance se cotejan sin aceptar fuentes/grants del cliente. Registro y adopción
son acciones separadas; ni HMAC, hash o registro autorizan adopción automáticamente.

Las versiones del piloto identifican instrumentador, compilador estático, geometría
y aislamiento/sanitización; no certifican versión física del browser/renderer.
Ese pin/evidencia de ejecución corresponde al contrato render/CAP027 y Q01, sin
otro motor ni modificación de su reserva. La política geométrica/cascada restante
es I02; consumidores preset/proposal son I04; catálogo UX externo es I05, no parte
del mecanismo de catálogo independiente ya usado por adopción. No atribuir esos
cierres a I01. Perfiles anteriores no se reinterpretan: requieren revisión nueva.

A01 conserva aplicación SQL y evidencia PostgreSQL/RLS/locks/rollback/concurrencia;
A02 conserva ACL/clave/catálogo/runtime/flags y piloto autorizado instalados; Q01
conserva comparación visual/accesibilidad/browser del tester. No se ejecutó ninguno
de esos pasos reales ni se aprobaron evidencias humanas desde esta conversación.

Validación local del inventario:11/11 dirigidas y991/991 regresión, tipado/lint
aprobados. RPC simulado y SQL/montaje estáticos, no evidencia de RLS/locks reales,
interacción React ni ejecución de migración. No se obtuvieron datos remotos.

Validación del operador:39/39 dirigidas (11 nuevas de workflow/handoff/SQL y28 de
preparación/adopción/coordinador), CLI legado3/3 e histórico/reconstrucción3/3 cada
uno. Recorrido cruzado concreto desde el candidato recién registrado hasta review,
commit/pointer y replay histórico sin recompilar ni segundo commit; los RPC son
fakes, no una simulación que certifique atomicidad real. Regresión1002/1002, tipado
web y lint dirigidos aprobados. [Runbook privado](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md).

[Estado/QA](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md),
[orden SQL manual](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).
