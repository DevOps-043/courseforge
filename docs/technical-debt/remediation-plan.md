# Plan de corrección por etapas

Plan refinado el 2026-11-04 para ejecución por unidades y continuidad entre chats.
La auditoría inicial autorizaba solo planificación. El 2026-11-05 se autorizó
ejecutar este plan por unidades, con verificaciones y commits locales recuperables.
Posteriormente el usuario pausó el objetivo exhaustivo y pidió cerrar con lo
necesario para funcionar, sin corregir al 100 %. La entrega actual termina el
arreglo de seguridad de ajustes ya iniciado y verifica el estado local; las demás
unidades quedan como backlog, sin ejecución automática ni cierre ficticio.
Publicación, despliegue y SQL remoto conservan su autorización específica.
Los roles sugeridos no son asignaciones.
Prioridad y esfuerzo están separados en el
[registro](findings.md). Sin fechas comprometidas ni promesas de capacidad.

## Orden y dependencias

**Cierre funcional actual — 2026-11-05:** F1.3.c.3.c.7.b.2.c.2 cerrado localmente:
las siete acciones de ajustes exigen identidad/tenant vigentes y revisión local
para escribir; sin fallback de rol global o cookie. Autoridad 657/657 y contrato
15/15; 30 casos de ajustes también en Node 22; verify:pr aprobado. La entrega
local termina aquí por solicitud del usuario. No retomar automáticamente la
auditoría de 159 candidatos ni las fases restantes. Si se solicita continuar,
conservar como pendientes acciones/catches, estado parcial de perfil/revalidación
e integridad de escrituras múltiples. Evidencia y límites:
[cierre .7.b.2.c.2](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c7b2c2.md).
Los lotes .7/.7.b, F1.3 y TD-26 siguen abiertos. Los cortes siguientes son registros
históricos de continuidad, no sustituyen este punto ni el tablero OpenSpec.
Las fases restantes y aceptación real se conservan como backlog; el objetivo
exhaustivo permanece pausado por solicitud del usuario.

Ruta inicial recomendada: **F0.1 → F1.1 → F1.2 → F1.3**. Después continuar las
unidades habilitadas de las fases 0–3; dejar las extracciones de UI para fase 4.
Fase 5 completa cobertura y aceptación de ambiente. La numeración agrupa objetivos,
no impone terminar toda una fase antes de comenzar la siguiente.

F0.3 quedó clasificada localmente el 2026-11-05: cuatro componentes, 26 módulos
y 46 aristas internas; el gate conserva once ciclos y 582 avisos. Ver
[continuidad F0.3](../../openspec/changes/classify-module-graph/reports/context-F0.3.md).
Habilita F3.5.a (captions) y los demás grupos de F3.5; no cierra TD-12 ni sustituye
los lotes restantes de autoridad y las fases de datos, transporte, operación y UI.

F3.5.a quedó cerrada localmente el mismo día: captions deja de formar una
componente circular, HyperFrames completo aprueba y el gate pasa a diez ciclos
con 582 avisos. Ver [continuidad F3.5.a](../../openspec/changes/decouple-caption-text-validation/reports/context-F3.5a.md).
Siguiente grupo: F3.5.b, documento/plan de captions/fuentes. TD-12 permanece abierto.

F3.5.b quedó cerrada localmente el 2026-11-05: contratos de clip/fuentes separados,
capturas de serialización/hash/errores y HyperFrames aprobados; gate con ocho
ciclos/582 avisos. Ver [continuidad F3.5.b](../../openspec/changes/decouple-composition-document-contracts/reports/context-F3.5b.md).
Siguiente grupo: F3.5.c, autoridad HTTP narrativa; después QA y resolvedor del grafo.

F3.5.c quedó cerrada localmente el mismo día: contrato neutral de autoridad,
JavaScript idéntico en cuatro módulos y 59 pruebas dirigidas aprobadas. Gate con
siete ciclos/582 avisos, una componente QA. Ver
[continuidad F3.5.c](../../openspec/changes/decouple-narrative-http-authority/reports/context-F3.5c.md).
Siguiente unidad: F3.5.d1, ejecución/materialización/supervisor de QA; TD-12 abierto.

F3.5.d1 quedó cerrada localmente el 2026-11-05: descriptor de QA neutral,
cero ciclos/componentes y verify:pr completo aprobado. Se conservan 582 avisos
del analizador; TD-12 requiere aún F3.5.e (resolvedor y canarios), según
[continuidad F3.5.d1](../../openspec/changes/decouple-controlled-render-descriptor/reports/context-F3.5d1.md).

F3.5.e quedó cerrada localmente el mismo día: 8.923 aristas, cero ciclos o
referencias desconocidas y dos casos de bundler comprobados; canarios y grafo
idénticos en Node 24/22 y verify:pr aprobado. TD-12 queda resuelto pendiente de
CI/integración, según [continuidad F3.5.e](../../openspec/changes/resolve-module-graph-aliases/reports/context-F3.5e.md).
Retomar F1.3.c.3.c.4 (HeyGen) y el resto del plan; F5 conserva aceptación externa.

F1.3.c.3.c.4 quedó cerrada localmente el 2026-11-05: doce rutas/diecinueve métodos
HeyGen con proyección segura de autoridad y compensación preservada. Auth Bridge,
51 tests nuevos también en Node 22, Remotion y verify:pr aprobaron. Ver
[continuidad F1.3.c.3.c.4](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c4.md).
Siguiente unidad F1.3.c.3.c.5: slides/open-design. F1.3 y TD-26 siguen abiertos.

F1.3.c.3.c.5.a quedó cerrada localmente el 2026-11-05: biblioteca de plantillas
sin autoridad desde claims/cookies históricos, denegación explícita y error
serializable seguro. Once pruebas nuevas también en Node 22, Auth Bridge y
verify:pr aprobaron; lint pasa de 572 a 570 warnings. Ver
[continuidad F1.3.c.3.c.5.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c5a.md).
Siguiente unidad F1.3.c.3.c.5.b: otros ocho handlers de slides/open-design.
El lote padre, F1.3 y TD-26 permanecen abiertos, incluida aceptación de entorno.

F1.3.c.3.c.5.b y el lote padre quedaron cerrados localmente el 2026-11-05:
ocho handlers normalizados y namespace de HTML verificado en tres operaciones.
59 pruebas nuevas también en Node 22, Auth Bridge, Remotion y verify:pr aprobaron.
Ver [continuidad F1.3.c.3.c.5.b](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c5b.md).
Siguiente unidad F1.3.c.3.c.6: automatización/standalone; después soportes HTTP
HyperFrames e inventario restante. F1.3 y TD-26 permanecen abiertos.

F1.3.c.3.c.6.a quedó cerrada localmente el 2026-11-05: ocho operaciones de
automatización normalizadas, con 49 pruebas nuevas también en Node 22,
Auth Bridge, Remotion y verify:pr aprobados. Ver
[continuidad F1.3.c.3.c.6.a](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c6a.md).
F1.3.c.3.c.6 permanece abierto: siguiente subunidad .6.b, tres operaciones
standalone y vínculo verificable vídeo/organización. Compartir cuenta de HeyGen
no debe conceder acceso a IDs de otro tenant. La integridad de las escrituras
sucesivas de configuración también requiere su caracterización posterior.

F1.3.c.3.c.6.b y el lote padre .6 quedaron cerrados localmente el 2026-11-05:
tres operaciones standalone normalizadas y consulta de vídeo ligada a tenant/ID
mediante comprobante firmado de siete días. UI transporta el comprobante;
27 pruebas nuevas también en Node 22, Auth Bridge, Remotion y verify:pr aprobaron.
Ver [continuidad F1.3.c.3.c.6.b](../../openspec/changes/tenant-authorization-authority/reports/context-F1.3c3c6b.md).
IDs históricos sin comprobante se deniegan. Recuperación durable de standalone y
aceptación real permanecen pendientes. Siguiente unidad F1.3.c.3.c.7: soportes HTTP
HyperFrames y sus consumidores; después inventario restante. F1.3 y TD-26 abiertos.

La corrección segura de autorización no depende de arreglar todos los ciclos ni
de conciliar todo el historial SQL. TD-06 condiciona la certificación del esquema
y cualquier reparación del historial; un cambio SQL puntual puede prepararse y
probarse en una base descartable con sus dependencias explícitas. La adopción remota
sí exige conciliación del ambiente objetivo y autorización. Un bloqueo externo
no detiene unidades independientes. No se asume ejecución simultánea por agentes.

| Etapa | Objetivo e IDs | Dependencias y responsable sugerido | Aceptación y pruebas | Reversión |
|---|---|---|---|---|
| 0 | Restablecer evidencia confiable: TD-08, clasificación TD-12, inventario TD-31 | Platform/QA por asignar; checkout/lockfile limpios | npm ci aislado, lint/typecheck y grafo reproducibles; separar fallos reales de sandbox. Mapa de suites con exclusiones justificadas; canario hace fallar el gate. No desactivar reglas. | Revertir ajustes de configuración por commit, mantener gate y baseline explícito. |
| 1 | Cerrar frontera de autorización y precondiciones de datos: TD-26 y TD-06 | Security/DB por asignar; confirmar autoridad de membresías, sesiones legacy, historial SQL | Matriz rol/tenant/cookie/ausencia/fallo; cero escrituras ajenas. Recreate/upgrade descartables y permisos RLS/Storage con anon/auth/service-role. Reconciliar versiones antes de renombrar. | Gate seguro ante autoridad no disponible; piloto/expiración de sesiones compatible. Para SQL, respaldo y forward-fix aprobado por ambiente; sin DROP remoto automático. |
| 2 | Integridad de publicación y límites de transporte: TD-28 y TD-27 | Backend/DB por asignar; etapa 1, contrato inbox, tests concurrentes | Transacción/CAS de guardado; dos conexiones con barreras y fallos de commit. Lectura incremental cancela al límite; multipart compatible; HMAC usa bytes originales. Acreditar reintentos sin duplicación y estados inciertos recuperables. | Mantener outbox inmutable y modo de edición restringida durante entrega; flag para upload nuevo. Límites gateway efectivos durante transición. |
| 3 | Correctitud operativa y regresiones: TD-29/30/15/31, final TD-12 | Backend/QA/SRE por asignar; etapas 0–2, DB aislada y datasets | Indicadores iguales al SQL de referencia con cardinalidad mayor al máximo REST. Fallos visibles como indisponibles; canarios sensibles redactados; suites críticas y escenarios SQL incluidos en CI. Grafo pasa con warnings clasificados. | Feature flag del nuevo agregado/lector; UI degradada explícita; preservar trazabilidad y suite anterior hasta equivalencia. |
| 4 | Reducir acoplamiento del editor: TD-10 | Frontend/arquitectura por asignar; caracterización y pruebas del flujo intervenido | Extracciones verticales con guardado concurrente/ACK tardío, preview, cancelación y undo estables; un ciclo de vida por unidad. | Un commit reversible por extracción; preservar formatos/hashes y migraciones aditivas. |
| 5 | Completar cobertura y aceptación: TD-20, pendientes de coverage.md y aceptación externa de otros IDs | QA/SRE/DB/docs por asignar; unidades locales verificadas y ambiente autorizado | Cada superficie tiene revisión fechada; documentos coinciden con código; evidencia de permisos, operación y despliegue antes del cierre dependiente de ambiente. | Rollout piloto, criterios de parada y reversión por cambio; preservar datos e historia. |

Cada corrección coherente requiere un cambio OpenSpec con alcance y escenarios
antes del código; puede abarcar varias unidades cuando comparten el contrato.
Entrega con revisión adversarial proporcional, evidencia y
autorización específica para despliegues, publicación o migraciones remotas.

## Unidad de ejecución y ventana de contexto

**Una unidad de la tabla siguiente es el alcance predeterminado de un chat de
implementación.** Una fase abarca varios chats; un chat puede necesitar más de una
sesión. No se promete completar una unidad en un turno ni se mide capacidad en
tokens sin conocer el modelo y su contexto efectivo. Si una unidad supera lo
revisable, dividirla en `.a`, `.b` conservando sus criterios y dependencias.

El [registro de hallazgos](findings.md) conserva severidad y aceptación; este plan
conserva secuencia y límites; el OpenSpec de cada corrección conserva contrato,
tareas, diff y evidencia. No copiar todo el informe histórico en cada chat.

### Paquete mínimo de entrada

En cada unidad leer las instrucciones obligatorias y el contexto vigente, después
solo el hallazgo aplicable, su fila en este plan, el cambio OpenSpec activo y el
último registro de continuidad. Abrir fuentes y tests de esa frontera y sus
dependencias antes de editar; una lista corta es una guía de entrada, no permiso
para ignorar consumidores. Usar búsquedas dirigidas y rangos de símbolos para los
archivos grandes, sin omitir invariantes de los contratos.

Paquetes de dominio (rutas relativas a la raíz):

| Paquete | Lecturas de entrada además de las obligatorias |
|---|---|
| Q | `package.json`, `apps/web/package.json`, `apps/web/eslint.config.mjs`, `.github/workflows/quality.yml`, `scripts/quality/gate-plan.mjs`, testing.md y logs del fallo que se va a reproducir. |
| S | security-and-tenancy.md, `tenant-context.ts`, `artifact-action-auth.ts`, `utils/auth/session.ts`, `utils/auth/platform-role.ts`, login/switch-organization, tests Auth Bridge y `reports/reproduce.mjs` de la auditoría. Archivos server bajo `apps/web/src/lib/server/`. |
| D | `scripts/check-migration-versions.mjs`, migraciones concretas y dependientes, auditoría DB de octubre y schemas/RPC consumidores. BD.sql es contexto, no prueba del esquema efectivo. |
| P | Rutas `api/save-draft` y `api/publish`, schemas, outbox service/claim/reconciliación, guard de temario y tests de publicación; dominio bajo `apps/web/src/domains/publication/`. |
| H | `api-contract.ts`, sus consumidores y tests; ruta SCORM upload para multipart; webhook y `_shared/http.ts` de Edge cuando corresponda. `outbound-http.ts` es referencia de límites de respuesta, no sustituto de límites de entrada. |
| A | `domains/admin-dashboard/dashboard-data.ts`, sus consumidores/UI/tipos y consultas/índices efectivos del entorno de prueba. |
| O | `generate-artifact-background.ts`, `operational-logger.ts`, tests y consumidores del resultado del job. |
| M | Fuente canónica HyperFrames, ADR motion y OpenSpecs que afecten la capacidad concreta, `NativeCompositionPreview.tsx`, controlador a extraer, cola de guardado y tests correspondientes. Leer skills multimedia aplicables antes de intervenir. |

Las referencias cortas de estos paquetes están desarrolladas en [cobertura](coverage.md).
No requieren leer todas las suites multimedia para corregir un parser HTTP aislado.

### Presupuesto orientativo, sin asumir una capacidad fija

Reservar desde el inicio espacio para verificar y entregar continuidad. Como guía
de planificación, destinar aproximadamente un cuarto del contexto útil a lectura,
un tercio a implementación y el resto a validación, revisión y registro. No son
mediciones del consumo real ni límites automáticos del sistema. Conservar salidas
largas en reports/ y traer al chat solo comando, código, resumen y evidencia relevante.

Antes de una compactación prevista o al perder claridad sobre decisiones/archivos,
actualizar el registro de continuidad. También hacerlo cuando aparezca otro dominio,
un contrato incompatible, una investigación amplia o un bloqueo externo. No iniciar
otra corrección si no queda capacidad para probarla. La compactación conserva el
objetivo: releer el registro y seguir; no repetir trabajo ya acreditado.

## Unidades de corrección

La matriz siguiente define alcance y dependencias, no el estado actual. Consultar
los tableros de [base de ejecución](../../openspec/changes/remediation-execution-baseline/tasks.md),
[autoridad tenant](../../openspec/changes/tenant-authorization-authority/tasks.md) y
[restauración de lint](../../openspec/changes/restore-lint-gate/tasks.md) para
responsables, avances y evidencia. El [runtime de pruebas HyperFrames](../../openspec/changes/restore-hyperframes-test-runtime/tasks.md)
conserva F3.4.a, prerrequisito de la matriz CI detectado al ejecutar las suites.
Los tamaños son previsiones de alcance contextual: pequeña
= una frontera; media = una frontera y sus consumidores; dividir = unidad que debe
subdividirse después de caracterizar. No son estimaciones nuevas de días ni una
suma adicional a los esfuerzos del registro.

| Unidad / fase | Hallazgo, objetivo y límite de cambios | Entrada / dependencia | Salida verificable y tamaño |
|---|---|---|---|
| F0.1 — base de ejecución | Revalidar HEAD, cambios previos, runtime y fallos; preparar mapa de comandos, sin reinstalar sobre trabajo ajeno ni corregir producto | Q; auditoría y estado Git actual | Línea base fechada, responsables de cambios locales distinguidos y fallos reproducidos sin secretos. Pequeña. |
| F0.2 — lint | TD-08: corregir configuración/resolución efectiva de ESLint y caracterizar warnings, sin upgrade general ni relajar reglas | Q; F0.1; instalación limpia solo en entorno descartable autorizado | Lint ejecutable y canario de regla rechazado; warnings y diferencias Node 22/local documentados. Media. |
| F0.3 — grafo | TD-12: clasificar 11 ciclos/577 warnings de la base y distinguir type-only/runtime; no reestructurar todos los módulos | Q + fuentes de un ciclo a la vez; F0.1 | Inventario de aristas/consumidores y grupos de corrección, con comando y resultado fresco. Pequeña; no cierra TD-12. |
| F1.1 — contrato de autoridad | TD-26: confirmar fuente server-side de membresías/roles, revocación y compatibilidad de sesiones; preparar pruebas negativas | S; F0.1 | OpenSpec y fixtures de las tres ramas, ausencia de rol, autoridad caída y usuario válido; definir resultado seguro antes del código. Media. |
| F1.2 — resolver tenant | TD-26: retirar autoridad de cookies de navegación en resolver; conservar DTO de UI | S; F1.1 | Cookie manipulada no eleva rol ni agrega membresía, error explícito seguro y login válido preservado; seguridad/Auth Bridge/tipos. Media. |
| F1.3 — acceso privilegiado | TD-26: eliminar fallback no validado de cf_active_org y revisar consumidores del helper por lotes | S; F1.2 | Matriz de accesos ajenos y propios, sin contexto, claim vacío y artefacto legacy; tests de frontera no consultan org ajena con service-role. Dividir consumidores por flujo si crecen. No cierre productivo aún. |
| F1.4 — historial SQL | TD-06: plan de conciliación, versiones/checksums y reconstrucción local, sin renombrar ni aplicar remoto | D; F0.1 | Manifest de dependencias y discrepancias locales; procedimiento aprobado para obtener estado de cada ambiente, sin secretos. Media; tramo remoto en F5.3. |
| F2.1 — carrera reproducible | TD-28: reproducir save/publish con dos conexiones y barreras; fijar invariantes de payload/estado | P + D; F1.1 y esquema descartable preparado | Test falla por interleaving demostrado, o registro se ajusta si la hipótesis se refuta; ambos órdenes y worker activo caracterizados. Media. |
| F2.2 — escritura atómica | TD-28: implementar CAS/RPC y adaptar guardado/reserva, sin rediseñar publicación | P + D; F2.1 y acceso tenant corregido F1.3 | Conflicto explícito, carreras/reintentos/republish pasan; outbox/hash/idempotencia preservados. Media; adopción externa en F5.3. |
| F2.3 — JSON incremental | TD-27: corregir los dos parsers compartidos y probar límites, sin migrar multipart/Edge en el mismo chat | H; F0.1; consumidores inventariados | Límite exacto/UTF-8/fragmentado/abort, cancelación y lector compartido compatibles; tests API y seguridad. Media. |
| F2.4 — upload SCORM | TD-27: acotar multipart o diseñar upload firmado, elección sustentada por plataforma y consumidores | H + S; F1.3, F2.3 y contrato upload existente | Presupuesto efectivo probado, autorización/rutas tenant y compensación de fallos; mantener parser ZIP y jobs firmados. Dividir contrato/storage/UI si se elige upload directo. |
| F2.5 — webhook Edge | TD-27: límite incremental conservando bytes HMAC, sin cambiar semántica de eventos | H + D; F2.3; runtime de tests Edge disponible o límite documentado | Firma válida/inválida, tamaño y cancelación, duplicados/timestamp y respuestas compatibles; no cerrar sin pruebas del runtime pertinente. Media. |
| F3.1 — dashboard degradado | TD-30: separar indisponible de cero real en lector y UI | A; F0.1 | Matriz error/vacío/datos por sección y logger redactado; sin agregado SQL nuevo. Media. |
| F3.2 — dashboard exacto | TD-29: agregado tenant-aware o paginación consistente, con decisión medida | A + D; F3.1 y esquema local preparado | Dataset sobre límite REST coincide con SQL de referencia; índices solo con EXPLAIN y línea base de latencia. Media. |
| F3.3 — operación BASE | TD-15: logger y errores seguros en un job y su consumidor | O; F0.1 | Canarios sintéticos no se filtran; inicio/fallo/fin correlacionados; recuperación y mensaje público preservados. Media. |
| F3.4 — matriz CI | TD-31: conectar suites críticas por riesgo sin duplicar ejecución equivalente | Q; F0.2; dependencias de cada suite disponibles | Mapa flujo→tests→CI, canarios de regresión y tiempos; exclusiones justificadas. No representa cobertura RLS completa. Media. |
| F3.5 — ciclos por grupo | TD-12: una extracción neutral de contratos o dependencia dirigida por grupo | Q + paquete del grupo; F0.3, pruebas de caracterización | Grafo y suites del grupo sin regresión ni ignores nuevos. Repetir como F3.5.a/b… hasta cubrir el inventario; no un chat para once ciclos. Dividir. |
| F3.6 — contratos SQL en CI | TD-31/06: pruebas aisladas de tenant/roles/claims/concurrencia para los cambios intervenidos | D + Q; F1.4, F2.2 y F3.4 | PostgreSQL/Supabase descartable con permisos reales; probar upgrade y contratos intervenidos, sin afirmar reconstrucción íntegra si aún faltan dependencias. Media. |
| F4.1 — caracterización editor | TD-10: delimitar persistencia, inserciones, preview/render y tests de interacción | M; pruebas relevantes ejecutables, F0.3 | Diagrama de responsabilidades, consumidores y contratos de controladores; reproducción de ACK tardío/conflicto/cancelación/undo. Media. |
| F4.2 — persistencia | TD-10: extraer guardado/recuperación y estado asociado, sin cambiar formato/hash | M; F4.1; ciclos del grupo resueltos cuando lo exija la extracción | Tests de cola/ediciones locales durante ACK/rebase y QA proporcional; coordinador delega ese ciclo de vida. Media. |
| F4.3 — inserciones | TD-10: extraer un controlador de inserción y referencias de assets | M; F4.2 | Inserción/captions/SFX según alcance elegido, fallos parciales y undo caracterizados. Dividir por capacidad si no comparten ciclo de vida. |
| F4.4 — preview/render | TD-10: separar coordinación de preview de entrega/render con contratos actuales | M; F4.1 y extracciones necesarias previas | Paridad, cancelación y estado de render verificados; QA/browser/corpus requerido. Separar preview y render en subunidades. No usar líneas eliminadas como aceptación. |
| F5.1 — cobertura restante | TD-20 y auditoría abierta: revisar un módulo/flujo pendiente por lote | coverage.md y fuentes de ese flujo; puede avanzar tras F0.1 sin esperar F4 | Inventario actualizado con revisor/fecha/profundidad y hallazgos nuevos separados de B2026-11-04. Repetir por módulo; dividir production por capacidad. |
| F5.2 — fuentes documentales | TD-20: reconciliar solo las fuentes afectadas por cada corrección | Paquete del cambio + documentación; acompaña cada unidad y revisión final | README/contexto/contratos consistentes con evidencia, historial preservado y docs:check; no segunda fuente de verdad. Pequeña por cambio. |
| F5.3 — aceptación de ambiente | TD-06 y criterios pendientes de los otros IDs: conciliación remota autorizada, rollout piloto, RLS/E2E/carga | Cambios locales pertinentes verificados, ambiente y permisos específicos | Cambio y versión desplegada registrados; mediciones antes de SLO, aceptación y rollback ensayados; cierres por hallazgo, no por terminar chats. Dividir por ambiente/flujo. |

F1.4, F2.1, F2.3 y F3.1 son candidatas a continuar si una unidad depende de acceso
externo todavía no disponible. Esto define independencia del trabajo, no autoriza
subagentes ni crear chats automáticamente. F2.4/F2.5 y F4 requieren sus skills y
contratos de dominio antes de elegir implementación concreta.

## Protocolo de inicio, corte y continuidad

1. **Inicio:** identificar unidad y OpenSpec, comprobar HEAD/estado Git y cambios
   previos; contrastar el registro de continuidad con el árbol real. Reproducir
   solo la evidencia pertinente si cambió la base o no es transferible.
2. **Contrato:** fijar criterio observable, archivos/consumidores, no objetivos y
   rollback. Un OpenSpec por corrección coherente puede tener varias unidades;
   registrar IDs de unidad en sus tareas, sin duplicar especificaciones.
3. **Implementación:** una frontera por vez. Si aparece otro problema, anotarlo
   con evidencia y continuar solo si es requisito de la misma aceptación; de lo
   contrario, agregar una unidad posterior sin ampliar silenciosamente el alcance.
4. **Verificación:** ejecutar suites proporcionales y compuerta requerida. Si un
   fallo conocido corta verify:pr, registrar ese código y ejecutar separadamente
   los checks de la unidad. No llamar «verde» al conjunto ni relajar el gate.
5. **Corte:** guardar evidencia y decisiones antes de cambiar de chat o compactar.
   Preferir terminar una unidad en estado verificable. Si es necesario cortar
   antes, registrar archivos incompletos, último paso válido y siguiente acción;
   no fingir aceptación ni borrar trabajo para simular un checkpoint limpio.
6. **Entrega:** usar la [plantilla de continuidad](../../openspec/changes/audit-technical-debt-2026-11/reports/remediation-context-template.md)
   dentro del OpenSpec de la corrección. Registrar commit recuperable cuando las
   políticas/permisos lo permitan; si no existe, declarar HEAD y lista exacta del
   diff pendiente. No crear worktrees, hacer reset/stash ni integrar automáticamente.

El registro de continuidad contiene referencias, no copias de código, salidas
completas ni secretos. Objetivo orientativo: 1–2 páginas por unidad; si crece,
separar evidencia de decisiones vigentes. El nuevo chat debe poder reconstruir
el estado desde archivos y Git sin depender de memoria conversacional.

Texto de arranque reutilizable para una corrección futura:

> Ejecuta únicamente la unidad `<ID>` de docs/technical-debt/remediation-plan.md.
> Lee las instrucciones obligatorias, el hallazgo y el OpenSpec/registro de continuidad
> indicado en `<ruta>`. Contrasta HEAD y cambios locales antes de editar. Implementa
> y verifica sus criterios dentro del checkout principal, preservando trabajo previo.
> Actualiza tareas, evidencia y continuidad. Si la unidad requiere dividirse, conserva
> su aceptación y registra subunidades. No despliegues, publiques ni apliques SQL remoto.

Este texto es una plantilla para cuando se autorice implementar la unidad; su
presencia en documentación no inicia ejecución ni concede permisos externos.

## Tablero de ejecución

El estado de cada unidad se llevará en tasks.md del OpenSpec de corrección, con
enlace al registro de continuidad. Antes del primer cambio, crear allí una fila
`unidad | hallazgos | responsable | estado | HEAD base | evidencia | siguiente paso`.
Usar los estados del registro de hallazgos; no inventar «fase terminada» cuando
solo terminó la parte local. Este plan conserva todas las unidades planificadas
hasta que exista esa evidencia; no contiene progreso de implementación acreditado.

Cerrar una unidad no cierra automáticamente su hallazgo. En particular TD-26
requiere F1.1–F1.3 y aceptación de sus criterios de entorno; TD-27 requiere las
fronteras JSON/SCORM/Edge incluidas; TD-10 requiere los ciclos de vida definidos,
no solo una extracción. El avance se informa por aceptación de hallazgos y por
unidades verificadas, con denominadores separados y sin sumar porcentajes de chats.

## Metas basadas en línea base

Las cifras siguientes son conteos de criterios observados, no objetivos de
rendimiento. Para las variables sin datos se define primero la medición.

| Problema | Línea base del corte | Meta verificable | Método y momento |
|---|---|---|---|
| TD-26 | Tres ramas inseguras reproducidas bajo precondiciones explícitas | Cero concesiones basadas en cookie; todos los casos negativos definidos rechazan | Reproducción sobre fuente modificada + tests HTTP/SQL aislados en etapa 1. No convertir las assertions que hoy prueban el fallo en checks de seguridad verdes. |
| TD-28 | Lectura + upsert separados; carreras reales no medidas | Cero violaciones en matriz determinista de interleavings y stress local | Barreras con dos conexiones; guardar semilla, orden y resultados; medir frecuencia real solo después de instrumentar. |
| TD-08 | verify termina 2 en lint local | lint/typecheck de instalación limpia aprobados; nueva infracción bloqueada | CI descartable con lockfile y canario. No acreditar restauración de todo verify mientras TD-12 u otro paso falle. |
| TD-06 | Cuatro grupos duplicados / tres dumps exceptuados; 214 SQL | Cero ambigüedades sin resolución documentada en ambientes inventariados | Manifest de versiones/checksums y comparación schema-only autorizada. No fijar «0 archivos duplicados» antes de elegir baseline seguro. |
| TD-27 | 65.536 B consumidos para máximo 1.024 B en ambos parsers | Rechazo con cancelación incremental sin consumir la cola completa | Fuente real + stream fragmentado/cancel spy; documentar cota de un chunk y buffering del proveedor. Registrar RSS/concurrencia antes de elegir presupuesto de memoria. |
| TD-29 | Tres consultas agregadas en JS sin paginar; límite REST desconocido | Cero discrepancias frente al agregado SQL autorizado por tenant | Dataset mayor al máximo configurado, estados combinados e IDs repetidos; medir p50/p95 y filas/bytes antes de optimizar índices. |
| TD-30 | Diez ubicaciones señaladas omiten error; impacto runtime no medido | Ningún error inyectado se muestra como cero/vacío válido | Matriz consulta × error/éxito-vacío/éxito-con-datos; UI y logger verificados. No usar número de líneas tocadas. |
| TD-31 | Cuatro suites completas críticas no invocadas por gate/workflow | Sin exclusiones críticas carentes de prueba equivalente y documentada | Trazar scripts/imports/CI; mutation canaries por flujo; medir duración antes de fijar presupuesto. No afirmar cobertura por cantidad de test files. |
| TD-12 | 11 ciclos / 577 warnings de Madge | Gate aprobado y warnings explicados o resueltos | Mismo comando/versión/HEAD; distinguir type-only de runtime, sin ignores nuevos para obtener verde. |
| TD-10 | Coordinador contiene persistencia/recuperación, inserciones, preview y render | Cada ciclo de vida tiene controlador caracterizable y dependencias dirigidas; escenarios definidos pasan | Diagrama de responsabilidades/imports y tests de integración UI, revisados por QA. Tamaño físico solo orienta inspección. |
| TD-15 | Job BASE tiene error crudo y metadatos URL en salida | Canarios sensibles ausentes; inicio/fallo/fin correlacionables | Captura de logger con SDK falsos y luego observación autorizada; antes de SLO de recuperación, medir tiempo de diagnóstico/recuperación real. |
| TD-20 | Contradicciones de rutas comprobadas y dos auditorías históricas de bases distintas | Inventario/README/contexto coinciden; histórico etiquetado; fuentes restantes con vigencia | docs:audit, revisión semántica y docs:check por corte. Otras guías pendientes no quedan cerradas por un enlace. |

## Instrumentación y operación pendientes

Antes de proponer latencia, throughput, costo o capacidad, registrar volumen por
tenant, mezcla de tráfico, p50/p95/p99 por flujo, bytes/RSS, duración de colas,
intentos, conflictos de versión, tiempo de recuperación y costo por artefacto.
SRE/DB/QA deben seleccionar corpus anonimizado, ambiente descartable, límites de
gasto y SLO de negocio. Ejecutar carga incremental con stop conditions acordadas.
No hay línea base operacional ni acceso a producción en esta fase; por eso no
se fijan porcentajes de mejora ni capacidad de usuarios simultáneos.

## Revisión y cierre

En cada entrega: actualizar estado, evidencia, fecha y cambio, después medir
criterios. Revisión semanal sugerida del backlog; cadencia por confirmar con el
equipo. No es una automatización creada. Un hallazgo que depende de despliegue
permanece resuelto pendiente de verificación hasta acreditar la aceptación allí.
Un hallazgo nuevo se agrega al lote siguiente sin reescribir el denominador B2026-11-04.
