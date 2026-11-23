# Reparación local de producción y revisión integrada

Fecha: 2026-11-23. Checkout inicial limpio, rama staging. Sin commits, push,
despliegues, SQL remoto, generación de HeyGen ni consumo real de proveedores.

## Diagnóstico y cambios

- Confirmado en código: B-roll pedía JSON genérico mientras su prompt remitía a
  un esquema no enviado. Ahora envía JSON Schema estricto y conserva validación
  Zod, mínimo de tomas, respuesta completada y fallo ante salida vacía. Un error
  de contrato muestra código y campos, sin copiar el contenido del proveedor.
- La acción verifica autorización del componente antes de reservar el job y
  reactiva fallos explícitos. El worker reclama el estado pendiente antes de
  consumir el proveedor y no marca como fallido un trabajo de otro ejecutor.
- Confirmado en código: el alta reutilizada de slides omitía submissionStatus,
  por lo que el cliente no entraba en el mismo seguimiento. Se unifica la
  respuesta y los consumidores siguen cualquier 202 con identificador de job.
- La reserva de despacho usa CAS; el worker reclama pendiente/en cola por job,
  componente y tipo antes del trabajo costoso. La colisión de idempotencia usa
  la misma clave completa con versión documental que la inserción.
- Un reintento explícito reserva de nuevo el despacho del mismo job cuando lleva
  más de 90 segundos en cola. Los trabajos recientes o RUNNING no se reenvían;
  perder el ACK del despacho no sobrescribe un worker activo o terminado.
- GET distingue ausencia de trabajo de cola y comprueba errores al leer assets.
  Ambas pantallas recuperan el último job tras recarga. El seguimiento tiene
  cancelación, límite de cinco minutos y timeout de quince segundos por consulta.
  La tarjeta permite consultar sin generar, y una respuesta sin deck no se guarda
  como DECK_READY. La cola operativa de staging no tiene causa raíz confirmada;
  estos cambios reparan defectos reproducibles de contrato y recuperación.
- Producción integra sesiones desplegables y tres vistas nativas. El participante
  no recibe soluciones o notas en su proyección visible; el facilitador conserva
  respuestas, criterios, preparación, confusiones, notas y documentos reservados.
  Se muestran revisión, pendientes y contenido desactualizado; corrección y QA
  conservan sus comandos existentes en Materiales. Exportar queda como descarga
  opcional, y sólo usa draft cuando la aprobación vigente está pendiente.

## Evidencia ejecutada

- `npm run test:production-asset-flow`: 73 pruebas de impartición, 19 de contratos
  y jobs, cinco estados SSR de la revisión integrada; código 0.
- `npm run test:remotion -w apps/web`: código 0.
- `npm run test:hyperframes -w apps/web`: código 0.
- `npm run typecheck`: código 0 durante implementación; la compuerta vuelve a
  comprobarlo sobre el estado final.
- `npm run verify:pr`: código 0 sobre el código final, con TEMP/TMP del proceso
  ubicados en `.tmp/asset-flow-process-temp`. Incluye lint, tipos, grafo sin ciclos
  ni referencias sin resolver, guard de migraciones, seguridad, audio, cobertura
  e impartición. El arnés conserva un caso omitido por falta de soporte de enlaces
  del entorno; no se alteró esa prueba.
- Primera compuerta detectó una prueba de build que no materializaba el manifiesto
  en el TEMP del sandbox. Sin modificar esa prueba ni su implementación, los cuatro
  casos pasan usando `.tmp/asset-flow-process-temp` como TEMP/TMP del proceso.
- Lint detectó una tolerancia obsoleta en curation-v2/workflow.ts (archivo sin
  cambios); se retiró la entrada, sin ampliar excepciones. Lint: cero errores,
  558 warnings existentes, cero diferencias con baseline.
- Navegador: se intentó abrir la vista local en 127.0.0.1:4321; Chrome devolvió
  ERR_CONNECTION_TIMED_OUT. No se acredita QA visual ni interacción de pestañas.
  Se conservan la prueba SSR y la vista reproducible en
  `scripts/qa-production-asset-flow.cjs`. Servidor de prueba detenido al finalizar.

## Revisión adversarial

Realizada por el mismo agente, sin revisión independiente. Se comprobaron:
exclusión de workers repetidos, reintento de fallidos, colisión de reserva con
versión documental, cancelación durante sondeo, ausencia de jobs, preservación de
assets anteriores y separación explícita de audiencias. La revisión detectó y
corrigió un conteo de sesiones que no consideraba la falta o vigencia del plan.
Las exportaciones y entregas siguen construyendo la bibliografía obligatoria;
sólo la vista local de autoría, cuyo snapshot no incluye fuentes, omite su
construcción y remite a Fuentes y a las exportaciones completas.

## Límites y recuperación

Pendiente: desplegar bajo autorización y hacer un piloto mínimo con un deck y
prompts, verificar logs correlacionados del worker y probar cambio de audiencia
en navegador. Los trabajos en cola sólo se reenvían por solicitud explícita y
reserva vencida; no se consideran fallidos por agotar el sondeo. El error de suma
detectado en el contenido del curso de prueba no se corrigió mediante escrituras
remotas ni reescritura automática de material aprobado.

Rollback: revertir este diff como unidad. No hay migración ni transformación de
contenido existente; el contrato del documento y sus aprobaciones se conservan.
