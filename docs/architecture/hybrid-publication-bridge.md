# Puente de publicación híbrida

Estado: implementación por incrementos; **envío híbrido todavía deshabilitado**.

El plan y los criterios completos viven en
[OpenSpec](../../openspec/changes/implement-hybrid-publication-bridge/design.md).
Para retomarlo en otro chat, leer la
[guía de continuidad](../../openspec/changes/implement-hybrid-publication-bridge/reports/continuation.md).
El contrato v2 cubre el recorrido, el contenido asíncrono y la preparación.
Academy dispone localmente del receptor HTTP autenticado, la custodia de archivos
y la operación SQL de recepción. Faltan la aprobación transaccional y su
integración con el contenido de Academy, la conexión del emisor y la verificación
del piloto. La fase Publicar muestra el bloqueo junto al botón de envío.

## Contrato y conservación de datos

La fuente portable es
[hybrid-publication-route.ts](../../apps/web/src/domains/publication/contracts/hybrid-publication-route.ts).
Academy consume la misma fuente y una fixture sintética vendorizadas, compatibles
con sus distintas versiones de Zod. El orden no sustituye IDs de currículo,
lecciones ni sesiones. El recorrido cubre exactamente las lecciones de Academy;
las exclusivas Hub solo requieren cobertura en vivo. Una cobertura repetida en
otra sesión declara repaso. El contrato no inventa fechas ni URLs de videos.

El [paquete v2](../../apps/web/src/domains/publication/contracts/hybrid-publication-package.ts)
conserva el contenido de las lecciones de Academy y una plantilla por sesión,
con los 14 documentos de preparación y las notas privadas. La plantilla apunta
a la revisión y duración declaradas en el recorrido. Los binarios se describen
con ID, MIME, tamaño y SHA-256, sin rutas de almacenamiento ni enlaces firmados.
Se admiten hasta 8 MiB de JSON, 256 KiB por plantilla y hasta 25 MiB por binario,
256 binarios y 250 MiB de binarios por paquete. Academy acota el cuerpo antes de
parsearlo y exige custodia verificada en el servidor para emitir `RECEIVED`.

## Actualización del contrato

Desde la raíz de Architect, usar un destino explícito:

```powershell
node scripts/sync-hybrid-publication-contract.mjs --write <ruta-al-repositorio-Academy>
node scripts/sync-hybrid-publication-contract.mjs --check <ruta-al-repositorio-Academy>
npm run test:course-delivery -w apps/web
```

El script verifica el nombre del paquete de destino y evita imports entre
checkouts. El receptor mantiene sus propias pruebas, incluidas las fronteras de
cron, aprobación, creación, actualización y preview. La fixture no es un curso
real ni acredita autorización por organización.

## Rollout y recuperación

V1 conserva el flujo existente pero rechaza metadatos de modalidad que perdería.
V2 no puede atravesar el outbox/importador v1. Para activar v2 se requiere validar
el snapshot completo, persistir identidad/recorrido/plantillas, aprobar todo en
transacción y confirmar estado en el emisor. `SENT` solo confirma transporte.

Desplegar el receptor primero y verificar su capacidad con identidad de servidor;
después habilitar el emisor. Las reuniones se programan en Academy desde plantillas
aprobadas, sin simular una fecha ni reutilizar un aula de otro taller. Revertir la
aplicación conserva la guarda híbrida y v1; no borrar tablas ni reasignar progreso.
