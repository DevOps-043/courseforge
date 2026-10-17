# CAP-029 — métrica de implementación necesaria

Fecha: 2026-10-10. **Implementación necesaria preparada: 100% según la rúbrica siguiente; ambiente y QA manual pendientes.**
Mide entrega de software de CAP029 (HTML editable), no CAP027, todo el roadmap,
tiempo invertido, cantidad de archivos/tests ni aceptación productiva.

## Método y alcance

Primera línea base explícita de esta capacidad; no comparar con porcentajes de otras
CAPs o con crédito de cierre del roadmap. Los pesos son una estimación de importancia
funcional, no horas restantes ni una certificación productiva. El cierre corresponde
a los entregables preparados e integrados, no al ambiente. Se excluyen QA manual y aplicación
de migraciones/configuración; se incluye preparar correctamente esos contratos.
Una funcionalidad sin integración necesaria no obtiene crédito de cierre completo.

| Entrega necesaria | Peso | Crédito | Base del crédito / faltante |
| --- | ---: | ---: | --- |
| Fuente inmutable, manifest/tokens/overrides, OP021–028, multifield, inspector/staging y undo/OCC | 20 | 20 | Implementados en contratos, reducer/compiler, inspector/host y pruebas; QA diferido |
| Inicialización, persistencia editorial/snapshots y recuperación durable | 15 | 15 | Transporte/journal/receipts y recuperación conectados; SQL preparado, ejecución de ambiente aparte |
| Admisión y aislamiento HTML/CSS/SVG | 15 | 15 | Admisión acotada, CSP/protocolo/scoping, medición usada Element/Range/SVG/containment y guard autorizado antes del lanzamiento HTML conectados. Cuotas existentes validadas/clonadas por el bridge, sin nuevos límites. Verificación física de kernel/browser en A02/Q01 |
| Adopción legada y trazabilidad/versiones | 10 | 10 | Inventario, operador privado autenticado PREPARE/READ_PREPARATION/STAGE_REVIEWED/READ_REGISTRATION, intención sellada antes del registro, revisión/adopción/recibo conectados y auditoría I01 del recorrido completo. Instalación/DB/browser reales separados en A01/A02/Q01; consumers transversales siguen en I04 |
| Continuidad histórica y reconstrucción independiente | 25 | 25 | Inventario/inspección, republicación inactiva/recovery y reconstrucción explícita conectados. Selección inicial exacta de medios vigentes del tenant, catálogo instalado, fonts READY, paquete/handoff/revisión independiente, candidato/create-only/journals/receipt/apertura y biblioteca/enlace posterior auditados. Perfil CSS estático acotado; SQL29 preparado, DB/ACL/revisión humana/QA reales en A01/A02/Q01 |
| Contextos de preview/publicación | 10 | 10 | Current/saved/baseline/publicación y proposal/preset conectados a autoridad/contexto exactos, issuer/CSP/canal/recursos/renewal comunes. Creador/base/status/expiry vigentes; no cambios de política/stores CAP025. Auditoría I04 y pruebas integradas; browser/SQL reales separados |
| Catálogo UX entregado e integrado | 5 | 5 | Consulta de coincidencias exactas autorizada/bounded, selector de versiones/campos y envío coordinado existente conectados al catálogo instalado. Sin permisos por metadata ni instalación/registro automático; auditoría I05 y pruebas integradas, ambiente/QA aparte |
| **Total** | **100** | **100** | **Implementación necesaria preparada; ambiente y QA manual no incluidos** |

Corte vigente I02: geometría efectiva Element/Range/SVG normalizada al parent
nativo, wrapper block/paint containment/clip-margin0, límites intrínsecos y CSP
hash-bound de referencia preparados en el runtime compartido. El usuario autorizó
el guard específico en composition-windows-render-worker-host.ts: exige cuotas
existentes antes de preparar/lanzar HTML editable desde el documento materializado.
Native sin pointers HTML conserva el comportamiento anterior. Regresión1074/1074,
dirigidas24/24 guard/bridge, compilación/tipos web/worker/lint aprobados, sin skipped.
Los últimos5 puntos corresponden a esa integración necesaria, no al número de tests.
I01–I05 preparados. Sin SQL nuevo/aplicado, habilitación,
despliegue, render físico ni QA manual. [Auditoría](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md).

Auditoría final de consumidores R20/R22: contratos de las ocho familias, staging/
host/HTTP/gateway/CAS/undo y derivación viva/congelada compartida inspeccionados.
Compilación fresca de tests,51/51+74/74 aprobados. Retira la falta de auditoría de
esos consumidores, no una cuota del launcher ni una prueba browser/DB/píxeles.
Ese corte conservaba≈95%; el guard posterior completa I02 con el mismo denominador.
[Evidencia concreta](SOFLIA_ENGINE_CAP029_EDITORIAL_CONSUMERS_AUDIT.md).

La tabla es una rúbrica conservadora de entregables, no una medición automática de
cada línea de código. El estado de I01–I05 del expediente sigue prevaleciendo ante
un hallazgo; un bloque parcialmente implementado puede no recibir crédito adicional
hasta completar su entregable. Registrar revisión durable, por sí solo, no cierra
la persistencia/creación aislada ni aumenta artificialmente la puntuación.

## Historial de cortes

Los porcentajes y pendientes de esta sección describen su corte, no el estado vigente.

Cambio respecto a la primera línea base70%: +5 puntos por el backend completo
preparado de candidato/create-only y su journal/receipt concretos, con veinte
casos dirigidos y regresión923/923. No por el número de tests. La ejecución SQL real
queda en A01/QA, separada de la implementación preparada. No se acredita todavía
el flujo operativo CLI/UI ni el cierre integral I03; no implica75% de tiempo consumido.

## Ruta mínima de cierre — estado vigente

1. Continuidad histórica/reconstrucción I03 implementada/preparada, con original y
   borrador intactos. Instalación/revisión humana/QA reales separados, no acreditados.
2. Auditorías geométrica y de consumers completadas; guard HTML de cuotas conectado
   bajo autorización puntual. La observación física de browser/kernel no se acredita
   por la integración preparada. No añadir editores, operaciones o comodidades nuevas.
3. Catálogo UX autorizado aquí implementado/preparado reutilizando el servidor
   existente. Instalación aprobada y prueba de browser siguen en ambiente/QA,
   no son otra implementación del catálogo.
4. Consolidar evidencia y entregar a tester. Migraciones/configuración siguen bajo
   autorización del ambiente; QA no se usa para ocultar implementación pendiente.

No quedan entregables necesarios de implementación abiertos en I01–I05 según esta
auditoría. A01/A02 y Q01 siguen pendientes: instalar/reconciliar SQL, configuración
y paquete aprobados, y ejecutar QA real. Si faltan cuotas al lanzar HTML, el ciclo
de ownership conserva cuarentena/fence; operación debe reconciliar antes de reintentar.
No es válido convertir puntos en horas ni reducir seguridad por una fecha.

## Historial de cortes operativos (continuación)

Último corte I05: catálogo UX implementado/preparado, con GET autenticado de
coincidencias exactas de la fuente guardada, metadatos mínimos y selector explícito
conectado al envío durable anterior. I01/I03/I04/I05 preparados; I02 parcial.
Crédito5/5 del catálogo eleva≈90→95%, sin cambiar pesos ni requisitos. Regresión
1062/1062 y dirigidas29/29 catálogo/bootstrap, tipos y lint aprobados. La consulta
no registra/activa templates ni escribe documentos o grants. Navegador/SQL reales
siguen en A01/A02/Q01. [Auditoría I05](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md).

Actualización operativa del mismo día: workflow/CLI privado/factory conectados y
journal concreto antes del RPC de revisión, con recuperación read-only. Regresión
931/931 y CLI reconstrucción3/3/histórico3/3. Se mantiene **≈75%**, sin otorgar el
crédito restante de I03: apertura UI, estilos globales y selección de recursos
independientes aún pendientes. No aumentar el porcentaje por agregar archivos/tests.
[Operador](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md) y
[orden SQL manual completo](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).

Segundo corte operativo: consulta autorizada de apertura (SQL/adapter/GET/cliente)
preparada, siete casos dirigidos y regresión938/938 aprobados. Se mantiene≈75%: no acredita montaje
del editor independiente. El editor actual tiene acciones que exigen componente de
lección; no suministrar ID original/ficticio para eludir esa dependencia.

Tercer corte operativo: página y wrapper montan el studio existente en scope
independiente/componentIdNULL, después de autorización server actual, sin importar
fuentes/biblioteca originales. Guards de acciones component-dependent y enlace
CREATE/READ_CREATION conectados. Apertura preparada no implica browser QA real.
Se conserva≈75% hasta cerrar estilos globales y recursos/revisión restantes de I03;
no acreditar el hito25/25 solamente por añadir una página.

Cuarto corte: preparación aislada de CSS contextual y presupuesto CSS conjunto,
seis casos nuevos/regresión948/948/tipado/lint dirigidos aprobados. No habilitado
todavía en reconstrucción: integración de ambos targets/ledger/perfil/cascada
pendiente. Se conserva≈75%, sin contar este preparador como soporte global completo.

Quinto corte: CSS contextual estático sin recursos conectado al compilador compartido
preview/render y a reconstrucción, perfil static-fragment-v3-contextual-css y SQL
incremental paso23 preparados. Fuente/identidad original preservadas. ≈75% conservado:
I03 sigue parcial por recursos independientes y revisión operativa, I02 por cascada/
geometría efectiva; este avance no equivale a soporte de CSS global arbitrario.
Evidencia final:950/950 CAP029/contratos,56/56 persistencia/compilador compartido,
tipado web y lint dirigidos aprobados. Comparación SQL estática, no aplicación real.

Sexto corte: biblioteca de recursos actualmente vinculados conectada al editor
independiente, con lector autorizado/keyset, HTTP, cliente y colección bounded.
SQL paso24 preparado. No se importan bibliotecas ni se enlazan medios nuevos.
Métrica≈75% conservada porque la entrega integral I03 sigue parcial; seleccionar
metadata ya vinculada no sustituye adquisición autorizada de recursos independientes.
Evidencia:18/18 apertura/biblioteca dirigidos y regresión964/964, sin skipped/fallos;
tipado web y lint dirigidos aprobados. SQL estático, no aplicación ni browser QA real.

Séptimo corte: consulta por UUID y vinculación explícita de medios ya registrados
en el tenant al nuevo draft, conectadas mediante SQL/repository/HTTP/cliente,
journal antes de POST, recibo atómico y recuperación GET/cierre verificado. No
inserción automática ni cambios del original/documento/versiones. Rechazos por
base/recurso/límite tienen recibo negativo; incertidumbre conserva seguimiento.
Label Unicode corregido entre PostgreSQL/codepoints y presupuesto nativo UTF16.
SQL pasos25–26 preparados, no aplicados. Se conserva **≈75% (±10 puntos)**: este
subavance no cierra I03 completo ni cambia los pesos. La preparación inicial
continúa limitada a recursos autorizados del draft de origen; faltan integración
de revisión operativa y auditorías I01/I02/I04/entrega externa I05. No nuevos
requisitos opcionales, duplicación del catálogo reservado ni crédito por tests.
Evidencia local: regresión980/980;34/34 dirigidas; tipado y lint dirigidos aprobados.
Sin SQL/RLS/locks/Storage reales ni QA browser/manual.

Octavo corte: inventario actual de slides guardadas conectado al recovery center,
con fuenteSHA/bytes, pointer presente y registro template/version/source/revocado,
anclado a hash/versión nativa y revisión de emisión (puede faltar). SQL27 preparado,
RPC/HTTP/cliente/panel metadata-only, página20/cota500 y rechazo de base cambiada.
Sin render/admisión automática ni descarte de legado sin registro. Se conserva≈75%:
I01 no se cierra con un inventario. La búsqueda de consumidores confirma que
`SupabaseHtmlLegacyAdoptionRepository.stageReviewedCandidate` solo tiene callers
en pruebas; falta recorrido operativo de preparación/revisión/registro, no QA.
No cambiar este requisito a instalación de ambiente ni inferir autorización
de un paquete/digest. [Auditoría](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md).
Evidencia:11/11 dirigidas y991/991 regresión, tipado/lint aprobados. SQL27 sin aplicar,
montaje inspeccionado estáticamente, sin QA de browser ni prueba DB real.

Fuentes: [plan de cierre](SOFLIA_ENGINE_CAP029_COMPLETION_PLAN.md),
[puerta I01–I05 / ambiente / QA](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md),
[reconstrucción](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_IMPLEMENTATION.md).

Noveno corte: **≈80%**, +5 puntos por cerrar el entregable de adopción legada y
trazabilidad I01 a nivel de implementación preparada, no por archivos/tests ni
solo por agregar un CLI. El caller operativo faltante usa el preparador/repositorio
existentes, autentica JWT/profile/tenant actuales, conserva preparación íntegra e
intención metadata-only selladas/create-only/readback, exige revisión explícita y
catálogo independiente y permite lectura histórica sin reenviar. Auditoría cruza
registro→review→commit/pointer→recibo preservando original, fuente y perfiles.
39/39 pruebas dirigidas, regresión1002/1002 y CLI9/9; tipado/lint aprobados.
Instalación, SQL/ACL/revisión humana y QA reales no ejecutados.
[Auditoría](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md),
[operador](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md). I02/I03/I04 parciales,
I05 externo pendiente. Mismos pesos/denominador; margen±10, no estimación de horas.

Décimo corte: **≈85%**, +5 por completar el entregable necesario de I03, no por
número de pruebas. PREPARE admite intención opcional cerrada `resourceSelection`,
exacta respecto a referencias reales; RPC vigente independiente de links del origen,
revalidación después de compilar y antes/después de staging/creación, con pins y fonts
READY. Sin selección conserva semántica/digests previos. Recorrido integrado mediante
factory/preparador/compiler/handoff/repositorios/journals/store concretos y remoto
simulado comprueba pérdida de ACK de revisión/creación, reinicio y recovery de lectura,
sin recompilar/subir/crear otra vez ni tocar el original. SQL29 preparado sin aplicar.
I03 implementado/preparado según [auditoría](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md).
Regresión1012/1012, CLI9/9, tipado web y lint dirigidos aprobados. A01/A02/Q01 no
ejecutados. I02/I04 parciales e I05 externo siguen pendientes: 5+5+5=15 puntos.
Margen±10, mismos pesos; no permite afirmar 85% de tiempo consumido ni fecha de cierre.

Undécimo corte: **≈85% conservado**. Cerrada una brecha concreta de I02: sizing
CSS fijo/min-sizes/origins podía sustituir atributos SVG sin entrar en el envelope
viewBox. Lector bounded y segundo recorrido de ancestros conectados a admisión/
compilador compartidos; perfil geometry-v9-css-viewport. Siete casos nuevos y uno
de ambos targets. No crédito por número de pruebas: sizing relativo/intrínseco,
cascade/layout completo y contención independiente siguen pendientes en I02.
I04 continúa sin contexto HTML exacto en previews de presets/propuestas; I05 sin
entrega local aceptada del catálogo reservado. Lectura del otro chat confirmó
trabajo CAP027, no cesión de esas reservas ni autorización para escribir allí.
[Auditoría geométrica](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md). Sin SQL nuevo/aplicado,
flags/runtime/catálogos habilitados, render ni QA manual. Evidencia final1020/1020
regresión,32/32 dirigidas, compilación/tipado y lint aprobados. Reserva puntual de
wiring HTML para previews solicitada al usuario, todavía no concedida en este corte.

Duodécimo corte: **≈85% conservado**. Comprobación de layout usado y readiness
compartida en ambos targets; preview consume fuentes/imágenes/layout antes de
ready/play/seek, con fallo explícito y sin fallback. No otorga los5 puntos restantes
de I02: consumo en executor original, matriz SVG/paint/cuotas siguen pendientes.
geometry-v10-computed-readiness diferencia el perfil, sin reescribir históricos.
El usuario autorizó ahora las integraciones HTML puntuales del executor, previews
de propuestas/presets y catálogo UX; no política/stores CAP025 ni resto del worker.
Se conserva denominador/pesos y necesidad de completar I02/I04/I05. Sin SQL nuevo,
flags/deploy/render físico ni QA manual. Evidencia final se registra en el expediente.

Decimotercer corte: **≈85% conservado**. Reader HTML de la sesión original conectado
en executor y captura de preview, con consumo de ready/assert y rechazo de bytes
inválidos antes de los consumidores, incluso después de terminar checkpoints de
texto. No renderer/ABI adicional ni cambios de política CAP025. Seis casos nuevos,
regresión1036/1036 y selección62/62; tipos web/worker/tests y lint aprobados.
I02 todavía no recibe sus5 puntos finales: matrices SVG, paint/cuotas no cerrados.
I04/I05 ya autorizados pero aún no implementados en este corte. Sin SQL nuevo ni
aplicado, habilitación, ejecución física o QA manual. Siguiente integración mínima:
contextos HTML seguros de propuestas/presets y catálogo UX, sin ampliar operaciones.

Decimocuarto corte: **≈90%±10**. +5 por integración completa/preparada I04: lectura
actual del candidato/base, proyección de bindings exactos, issuer/CSP/canal UI y
capabilities/renewal/GET binario reautorizados. No stores/política CAP025 nuevos,
SQL, flags ni deploy. Regresión1050/1050 y dirigidas73/73, tipado web/worker/tests
y lint aprobados; fixture integrado de página→renewal→recurso con puertos simulados.
UI inspeccionada/tipada, no browser observado. Restan I02(5) e I05(5), no más
recomendaciones adicionales. [Auditoría I04](SOFLIA_ENGINE_CAP029_PREVIEW_CONTEXT_AUDIT.md).
