# Slides pendientes: diagnóstico y reparación

2026-11-23. El usuario aportó log de las 17:02:17: AuthIdentityLookupError /
AUTH_LOOKUP_UNAVAILABLE desde getAuthBridgeSession al invocar
getAuthorizedMaterialComponentAdminForTenant en el worker. El código confirma
dependencia de cookies/identidad HTTP fuera del contexto de Next.js.

A las 17:05:12, el mismo identificador de invocación muestra nonce_consumido.
Es compatible con un reintento de la misma solicitud después de consumir el
nonce en el primer intento. No se elimina ni debilita la protección contra replay.

Cambios locales: verificación de reserva firmada, membresía/rol actuales y
componente de la organización sin sesión HTTP. Error previo a generación persiste
FAILED sólo en la reserva verificada pendiente/en cola. Eventos con jobId y
componentId identifican recepción, autorización, final y error. jobId pasa a ser
obligatorio; el emisor HTTP actual ya lo envía siempre.

Verificación: cinco pruebas de autorización/ámbito/diagnóstico pasan; comando
reproducible `npm run test:slide-worker-session`. La suite
test:security-boundaries pasó durante implementación; se agregó luego un canario
que prohíbe volver al helper dependiente de sesión y exige las nuevas guardas.
Tipos y lint focalizado pasan. `npm run verify:pr` terminó con código 0: lint
sin errores ni diferencias de baseline, tipos, grafo sin ciclos, guard de
migraciones y suites de seguridad, audio, cobertura e impartición. TEMP/TMP se
ubicaron en `.tmp/slides-worker-process-temp` para evitar el fallo conocido del
sandbox al ejecutar el canario de captura de despliegue. El arnés mantiene un
caso omitido por falta de soporte de enlaces del entorno.

Límites: navegador no disponible en este chat. No se consultó el estado real de
production_jobs ni se generaron assets, desplegaron cambios o alteraron registros.
El log confirma el fallo del worker, no el resultado final de generación con el
arreglo. Tras despliegue autorizado, reintentar el mismo job con nonce nuevo y
observar worker_authorized, estado RUNNING y resultado de QA.

Revisión del mismo agente: sin autorización por organización aportada solamente
por el cliente; se contrasta con job persistido, creador, curso, componente, tipo,
proveedor, membresía y rol. Una solicitud ajena no marca FAILED otro job. El
componente y la reserva sólo se leen; el pipeline y sus validadores no se relajan.
