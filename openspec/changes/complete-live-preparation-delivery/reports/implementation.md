# Entrega local de preparación

Fecha: 2026-11-03. Rama: codex/complete-synchronous-system, base a4062883.

La etapa final consulta sesiones programadas de la organización activa y envía láminas/prácticas aprobadas a Learning. Actor y organización salen del tenant, destino y autoridad se revalidan en Learning, y el comando se deriva del payload para soportar respuestas perdidas. Se conservan Nexus y HTML; no se envían respuestas, notas ni criterios privados.

Verificación ejecutada: typecheck correcto, 25 pruebas de course-delivery aprobadas, test:security-boundaries correcto, ESLint focalizado correcto, docs:check correcto y OpenSpec estricto del cambio nuevo correcto. El sincronizador confirmó coincidencia con el contrato canónico de Learning.

verify:pr se repitió tras declarar skip_specs: true en diagnose-font-catalog: su propuesta existente es una investigación de documentación y consultas sin cambio contractual. No se deshabilitó el validador. Pasaron adaptadores, arnés, docs, OpenSpec estricto (34 ítems), tooling (20 pruebas), lint global y tipos. La compuerta se detiene ahora en architecture:cycles: 11 ciclos del compositor multimedia, ajenos a los archivos de entrega síncrona. No se declara toda la compuerta de Engine aprobada. Salida local: .tmp/verify-synchronous-continuation.log; se conserva este resumen como evidencia versionada.

La revisión independiente detectó que readiness de Nexus permitía entregar materiales antiguos. Se corrigió en servicio y builder, con prueba de cambio a Nexus. Learning aporta HMAC/timestamp, autorización de instructor/curso y guardas SQL de revisión/estado bajo bloqueo. Su suite coordinada pasó 171 pruebas, incluida compatibilidad legacy al instalar la migración.

No se leyeron .env ni se enviaron cursos reales. Las dos migraciones aprobadas de Learning principal se aplicaron con versiones remotas 20261103184110 y 20261103184120; el reporte canónico está en docs/reports/live-activation-2026-11-03/ del repositorio Learning. No se desplegó código ni se habilitó Zoom.

La inspección remota anterior de Engine confirmó que faltaban course_delivery_workspaces, course_delivery_versions y course_delivery_runs. El usuario aprobó después «Aprobar migración y verificaciones en Engine» para emsjctbdevufloxntjll y, al no disponer de la conexión, eligió ejecutar manualmente el SQL. Sus capturas identifican Engine main y ejecución sin errores. El JSON completo aportado del postflight se verificó contra nombres, cantidades, permisos, funciones, políticas, trigger y check esperados; consultar [evidencia de ejecución manual](engine-manual-execution.md). La aplicación se considera verificada a partir de esta evidencia aportada, sin atribuir consultas remotas al agente. Falta comprobar/reconciliar el historial de migraciones, publicar Learning compatible y configurar la conexión administrada antes del piloto.

## Verificación SQL adicional y estado recuperable

Se retiró SECURITY DEFINER de las siete funciones de autoría antes de su aplicación manual: ahora usan SECURITY INVOKER con search_path vacío y relaciones calificadas. Se amplió scripts/test-course-delivery-sql.mjs para ejecutar el flujo como service_role con BYPASSRLS sin superusuario ni ownership, incluidas inserción de modelo, historial del trigger y políticas negativas de promoción de settings legacy. Las mismas consultas preflight/postflight se ejecutan sobre el fixture mínimo.

Resultado: 14 pruebas SQL aprobadas y 25 pruebas de course-delivery aprobadas. Runtime PostgreSQL local reutilizado mediante COURSE_DELIVERY_PGLITE_PATH; sin instalación de dependencias ni cambios de lockfile. El guard de migraciones aprobó 213 archivos SQL. Hash SHA-256 de los bytes locales del archivo preparado: BCED3A382158989504260B5A2C47C4F692603D5865169261B2C9F78A452F0EB5. Este hash no prueba ejecución remota.

verify:pr volvió a ejecutarse sobre esta continuación (salida local .tmp/verify-synchronous-activation.log). Pasaron adaptadores, arnés, documentación, OpenSpec, tooling, lint global y tipos. architecture:cycles volvió a detener la compuerta con los mismos 11 ciclos del compositor multimedia; no se cambiaron esos archivos respecto de la base a4062883. Los pasos posteriores de la compuerta no se presentan como ejecutados por ese comando. docs:check se repitió tras el cierre documental: 228 documentos verificados. En Hub aprobaron docs:check y docs:system:check; se verificaron los enlaces locales del documento Video SDK de Learning.

La revisión independiente alcanzó la calificación de relaciones, search_path y permisos SELECT/UPDATE requeridos por FOR UPDATE, sin un P1/P2 confirmado en esa parte. Se interrumpió por falta de créditos antes de completar su cierre; no se presenta como revisión completa de activación. La revisión propia adicional comprobó los siete privilegios RPC, escrituras e historial con rol de backend y la denegación al navegador mediante las pruebas SQL. El postflight aportado confirma el catálogo y los privilegios de los objetos nuevos; los grants de dependencias previas y la cuenta real no se volvieron a consultar por el agente.

La entrega inicial admite los límites del aula y rechaza excesos sin truncar. La reversión retira entrega nueva conservando preparación recibida, autoría e historial. El cambio no se archiva ni el piloto se marca como realizado.

## Candidato publicado para pruebas, 2026-11-05

La rama codex/complete-synchronous-system ya se publicó en Hub, Learning y Engine. Engine integró los siete commits nuevos de staging 37dcf7dc conservando el trabajo remoto. Se retiraron los once ciclos en el cambio remove-composition-import-cycles. npm run verify aprobó tras el merge (297 pruebas, tipos/lint y cero ciclos), junto con 358 pruebas HyperFrames; la suite Learning se repitió con 171 aprobadas. Hub aprobó build:app, runtime estable Electron 44.5.1 y smoke audiovisual con todos sus indicadores correctos. La composición exacta de comandos y los límites de publicación están en [el reporte de pruebas](testing-release.md). Publicar Git no acredita URL Netlify ni piloto; estos siguen pendientes.
