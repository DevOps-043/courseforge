# Cierre local de fase 2 — 2026-11-06

Base: `81b861ae`, checkout principal inicialmente limpio. Este cierre completa los pendientes de biblioteca, ciclo de vida y QA; no activa generación documental ni constituye despliegue o aceptación productiva F6.

## Implementación

- `reserve_course_source_upload_v2` añade `supersedesId` validado por curso/organización, conserva idempotencia y cuotas y evita dos sucesores vigentes. El original queda disponible durante el procesamiento. El paso del sucesor a READY retira atómicamente el anterior, conservando ambos objetos y fragmentos.
- UI con historial visible, sustitución de archivo individual, progreso de bytes por XHR, cancelación de transferencia, recuperación y retirada lógica. Mensajes de formato seguros; no se muestran detalles de schemas al usuario.
- Conciliación por revisor separada de purga: 24 horas de gracia desde vencimiento, siete días para purgar, observación exacta de Storage y versión, comprobación de referencias, confirmación del ID y auditoría. No hay borrado automático ni se ejecutó purga real. Fallos inciertos no se convierten en éxito.
- Migración aditiva `20261106020000_course_source_lifecycle.sql`, sin modificar migraciones anteriores. Nueva tabla privada con RLS y sin grants al navegador; funciones invoker con search_path vacío y permisos de backend.

## Pruebas y evidencia

`npm run test:course-sources`: 27 pruebas de dominio/HTTP/Storage y 11 de PostgreSQL aislado (38 en total). Se comprueba además PDF textual válido generado como fixture, rechazo de texto insuficiente y cancelación/progreso XHR. La suite SQL ejecuta las tres migraciones reales como service-role no propietario; incluye versiones, original vigente durante sustitución, referencia cruzada denegada, sucesor único e identidad inmutable. Las pruebas de conciliación cubren desconocido/503, cambio de versión, retención, referencias y borrado incierto; HTTP niega no revisores, curso no autorizado, origen ajeno y confirmación distinta.

`npm run typecheck`: código 0 en ejecución directa. `npm run verify:pr`: código 0; la compuerta completa se conserva en `phase-2-close-gate.log`, sin omitir ni debilitar reglas. Incluye lint sin diferencias del baseline, tipos, grafo/migraciones y suites de producto. Los últimos ajustes de presentación/validación de formato se comprobaron además con ESLint de alcance y QA local. Documentación/OpenSpec verificadas; `docs:audit` regeneró la evidencia temporal y se contrastaron README/contexto con este alcance.

QA reproducible `npm run qa:course-sources`: componentes React reales, CSS generado desde globals del producto, Chrome headless y servidor exclusivamente localhost con APIs sintéticas. Sustitución, recarga/historial, texto escapado, formato rechazado, conciliación y autorización puntual de purga pasaron. Sin errores de página ni desbordamiento horizontal a 375px. Capturas revisadas en `qa/desktop.png` y `qa/mobile-dark.png`; se corrigieron botones poco distinguibles y ajuste de texto antes de capturar el resultado final. El sandbox impidió arrancar Chrome; la ejecución local recibió escalación para el mismo script, que bloquea peticiones externas.

## Revisión propia y límites

La conciliación solo opera reservas conocidas; no barre ni borra objetos arbitrarios del bucket. Después de purgar se conservan registro e historial y las cuotas siguen siendo conservadoras: no se libera presupuesto simulando que desapareció una fuente. Documentos recibidos, listos, retirados o referenciados no son candidatos a esta purga. Una versión idéntica no se duplica: devolver 409 y reutilizar la existente.

La revisión fue del mismo agente, no independiente. No se aplicó SQL remoto, no hubo acceso a contenido tenant, proveedores IA, publicación o despliegue. La QA visual usa respuestas sintéticas y no sustituye el piloto de Storage/Auth real de F6. OCR permanece fuera del alcance. Fuentes heredadas y generaciones actuales conservan contratos; política/cobertura F3 y consumo del contexto documental F4 quedan pendientes.
