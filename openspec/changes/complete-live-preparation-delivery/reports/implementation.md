# Entrega local de preparación

Fecha: 2026-11-03. Rama: codex/complete-synchronous-system, base a4062883.

La etapa final consulta sesiones programadas de la organización activa y envía láminas/prácticas aprobadas a Learning. Actor y organización salen del tenant, destino y autoridad se revalidan en Learning, y el comando se deriva del payload para soportar respuestas perdidas. Se conservan Nexus y HTML; no se envían respuestas, notas ni criterios privados.

Verificación ejecutada: typecheck correcto, 25 pruebas de course-delivery aprobadas, test:security-boundaries correcto, ESLint focalizado correcto, docs:check correcto y OpenSpec estricto del cambio nuevo correcto. El sincronizador confirmó coincidencia con el contrato canónico de Learning.

verify:pr se repitió tras declarar skip_specs: true en diagnose-font-catalog: su propuesta existente es una investigación de documentación y consultas sin cambio contractual. No se deshabilitó el validador. Pasaron adaptadores, arnés, docs, OpenSpec estricto (34 ítems), tooling (20 pruebas), lint global y tipos. La compuerta se detiene ahora en architecture:cycles: 11 ciclos del compositor multimedia, ajenos a los archivos de entrega síncrona. No se declara toda la compuerta de Engine aprobada. Salida local: .tmp/verify-synchronous-continuation.log; se conserva este resumen como evidencia versionada.

La revisión independiente detectó que readiness de Nexus permitía entregar materiales antiguos. Se corrigió en servicio y builder, con prueba de cambio a Nexus. Learning aporta HMAC/timestamp, autorización de instructor/curso y guardas SQL de revisión/estado bajo bloqueo. Su suite coordinada pasó 171 pruebas, incluida compatibilidad legacy al instalar la migración.

No se leyeron .env ni se enviaron cursos reales. Las dos migraciones aprobadas de Learning principal se aplicaron con versiones remotas 20261103184110 y 20261103184120; el reporte canónico está en docs/reports/live-activation-2026-11-03/ del repositorio Learning. No se desplegó código ni se habilitó Zoom.

La inspección remota de Engine confirmó que faltan course_delivery_workspaces, course_delivery_versions y course_delivery_runs. Su migración 20261026160000_synchronous_course_delivery.sql requiere autorización separada; no estaba incluida en la aprobación de Learning. Faltan ese esquema, publicar Learning compatible y configurar la conexión administrada antes del piloto. La entrega inicial admite los límites del aula y rechaza excesos sin truncar. La reversión retira entrega nueva conservando preparación recibida, autoría e historial.
