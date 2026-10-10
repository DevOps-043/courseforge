# CAP-029 — auditoría de continuidad histórica

Fecha: 2026-10-10. I03 **implementado/preparado; ambiente y QA pendientes**.
No habilita aceptación productiva de CAP029. En el corte original de esta auditoría
I02/I04/I05 seguían abiertos; sus integraciones posteriores quedan preparadas según
el [expediente vigente](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md). A01/A02/Q01 pendientes.
Alcance: inventario, inspección, revisión, preparación, handoff, staging y registro
de revisión nueva no activa, y reconstrucción explícita independiente de contenido
actualmente admitido. No cambiar el borrador actual ni ejecutar HTML antiguo.

## Matriz de cobertura y salidas explícitas

| Caso | Comportamiento existente comprobable en código | Continuidad / pendiente |
| --- | --- | --- |
| Sin marca snapshot | Inventario conserva registro; no entra a inspección HTML | Investigación autorizada; no convertir automáticamente |
| Metadatos o pins ausentes/inválidos | Inventario conserva registro; no firma/descarga desde pins inferidos | Procedencia por investigar; no obtener pins del borrador actual |
| ZIP o bundle alterado / scope distinto | Pin exacto y revisión autorizada rechazan; sin compilación/ejecución | Bloqueo de integridad/identidad; no sobrescribir hashes para continuar |
| ZIP/formato desconocido o excesivo | Preflight/lectura acotada y schema rechazan | Preservar original; no extracción o reparación automática |
| V1 íntegro con contenido actualmente admitido | Revisión desde documento histórico exacto, recursos vigentes y bundle separado | Flujo implementado: preparador→handoff→aprobación independiente→staging→revisión no activa; ejecución real/QA pendientes |
| Perfil anterior íntegro y contenido actualmente admitido | Mismo flujo; muestra perfiles/pins y exige revisión, no restore original | Implementado con las mismas condiciones; no paridad visual inferida por SHA |
| Perfil vigente | Diagnóstico exige comprobaciones de contenido/autoridad; no lo migra por revisión histórica | Mantener flujo vigente, no recompilación histórica tácita |
| Fuente archivada sustituida o native/pointers inconsistentes | Lectura exacta/compilador y revisión rechazan | Bloqueo; no adoptar latest ni fuentes del ZIP como autoridad |
| Grants/medios/fuentes revocados durante preparación | Refrescos finales descartan candidato; staging/commit vuelven a validar | Sin aprobación reutilizable que salte permisos vigentes |
| Borrador actual difiere del histórico | Documento histórico exacto; registro SQL no actualiza borrador/active | Semántica elegida implementada; SQL preparado sin aplicar |
| ACK incierto en staging/commit | Locator/journal previo al write y recuperación metadata-only | Conservar seguimiento; no segundo write ni compensación automática |
| Archivo histórico íntegro cuyo contenido NO admite el compilador vigente | Republicación exacta bloqueada; lector de origen no compila/ejecuta el contenido antiguo. Nueva fuente explícitamente autorada, instalada/admitida actualmente y aprobada de manera independiente | Reconstrucción implementada/preparada: PREPARE→handoff→REVIEW durable→STAGE→CREATE aislado→receipt/opening/editor. No conversión automática ni reproducción fiel; instalación/revisión humana/QA reales pendientes |
| Nuevos medios del tenant no vinculados al origen | Intención cerrada opcional y conjunto exacto de referencias; RPC service-only reautoriza origen/actor/tenant y metadata actual. No paths/grants desde request/ZIP | Preparación inicial integrada con imagen/video/audio/branding/SFX y fonts READY. SQL29 revalida y crea links solo al nuevo draft/revisión. Sin selección permanece autoridad anterior por links del origen |
| Recurso cambia/revoca tras preparar o aprobar | Refresh final y verificador de autoridad antes/después de staging y antes de create bloquean; SQL repite origen/revisión/conjunto/pins bajo locks | Candidato no se reconstruye con otros bytes ni se reinterpreta aprobación. Pérdida de ACK recupera resultado histórico de lectura, no grant actual |

## Evidencia y límites

- `composition-html-editing-snapshot-history.contract.ts` y panel de inventario:
  metadataStatus y registros preservados; paginación acotada y reautorización.
- `composition-html-editing-snapshot-inspection.server.ts`, ZIP reader y bundle:
  archivo/tamaño/SHA/scope, diagnóstico sin ejecución y rechazo de formatos.
- `composition-html-editing-snapshot-republication-review.server.ts` y sus tests:
  native/pointers exactos, relectura de autoridad, rechazo de fuente sustituida,
  cancelación y perfil vigente sin falso upgrade.
- `composition-html-editing-historical-candidate.test.ts`: ZIP V1/perfil anterior
  completos, recursos vigentes, revocación de medios/fuentes, sin writes.
- `composition-html-editing-historical-handoff.test.ts`, operator command y CLI:
  bytes persistidos, integridad, aprobación separada, identidad host y no rebuild.
- Repositorio/contratos/SQL de publicación histórica: registro inactivo, recibos,
  verificación actual y no UPDATE draft/native/active. SQL estático/fakes no prueban
  RLS, locks, rollback o concurrencia real.
- `composition-html-editing-historical-continuity.ts` conectado al inventario e
  inspección: siguiente acción explícita para cada diagnóstico, no autoridad.

Los tests de fuente sustituida **no prueban** que una fuente auténtica admitida por
un compilador histórico sea admitida actualmente. Tampoco demuestran que todos los
registros reales fueron inventariados. La última fila no se cierra con más tests
del camino compatible, borrando originales, relajando sanitización o llamándola QA.

## Decisión del usuario

El usuario eligió **reconstrucción explícita como contenido nuevo, con revisión
independiente**. No es reproducción exacta ni republicación del documento histórico:
debe conservar original/borrador actual y crear contenido aislado con procedencia
explícita. La aprobación del archivo anterior no aprueba la nueva fuente. El flujo
de reconstrucción está conectado al operador privado y editor independiente; el
rechazo seguro por sí solo no acredita ese recorrido. No instalar un ejecutor antiguo
ni intervenir CAP027. Mantener originales y bloqueo de reproducción exacta. I01 e
I03 implementados/preparados; los pendientes I02/I04/I05 de aquel corte se resolvieron
posteriormente según el expediente vigente. A01/A02/Q01 siguen como ambiente/QA.

## Auditoría del recorrido operativo — 2026-10-10

1. Origen: lector autorizado de ZIP exacto/diagnóstico sin compiler histórico;
   identidad metadata-only. Archivo desconocido/corrupto queda fuera, sin reparación.
2. Contenido nuevo: IDs separados/componentIdNULL; plantilla actual instalada por
   host, fuente propia y base/hash exactos. Multipágina/CSS contextual estático sin
   dependencias permitido bajo perfil vigente. FontUrls/CSS con recursos ajenos al
   ledger permanecen rechazados: no se promete soporte arbitrario ni fidelidad.
3. Recursos: selector contractual cerrado no es autoridad. Referencias reales y
   native kinds/branding determinan conjunto exacto; fuente textual de un alias no
   concede permiso. RPC acotada, metadata/pins actuales y fonts READY. Selección
   ausente no amplía grants ni cambia contratos anteriores. No descarga de medios.
4. Paquete/revisión: compilador compartido, ZIP íntegro sellado create-only, approval
   nueva ligada al SHA de ZIP+metadata+procedencia, journal antes de RPC. Revisión
   humana obligatoria; el fixture de approval no acredita que se realizó.
5. Staging/creación: repositorios concretos verifican autoridad actual, claim/journal
   antes de writes, upload create-only/readback; SQL preparado revalida y crea nuevo
   contenido/links/procedencia/receipt en una transacción sin UPDATE del original.
   No reensambla ZIP aprobado, importa component/source ni activa publicación.
6. Recuperación/apertura: journals sobreviven reinicio; READ_REVIEW/READ_CREATION
   metadata-only tras ACK perdido no repiten RPC de escritura, compiler o Storage.
   Receipt no es grant: opening reautoriza nuevo contenido y entrega editorPath;
   página monta studio existente con biblioteca propia y guards componentNULL.

Evidencia: diez pruebas nuevas (nueve selección/autoridad + una ruta integrada);
regresión1012/1012, CLI9/9, tipado y lint dirigidos aprobados. La ruta integrada usa
factory, preparador/compiler, handoff/journals, repositorios y archive store reales
con filesystem temporal; RPC/Storage/session son fixtures. Comprueba seis medios
iniciales fuera del origen, fuente READY, reinicio, pérdida de ACK, una sola escritura
de revisión/upload/create y original intacto; recovery sigue siendo lectura incluso
si la autoridad de medios ya fue retirada. Apertura/UI adicional tiene pruebas propias.
No prueba RLS/locks/concurrencia/rollback PostgreSQL, ACL instalada, decode/render,
interacción browser, revisión humana ni QA real. SQL29 preparado, no aplicado.
Las evidencias previas V1/perfil anterior/ZIP inválido siguen pasando en la regresión.
Este cierre de I03 no retiró por sí mismo I02/I04/I05: sus auditorías e integraciones
posteriores figuran en el expediente vigente, sin certificar ambiente ni QA.
