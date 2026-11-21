# Evidencia local

## Diagnóstico

La captura del curso dca8d686-2c8a-413f-b4a6-5b1e4b187547 muestra VALIDATION /
INVALID_OUTPUT y 0/2 unidades, junto con configuración para nuevas ejecuciones.
No acredita el modelo del run ni identifica la regla exacta incumplida. El código
confirmó que los motivos de planIssues/hybridPlanIssues se ocultaban al clasificar
el error y que Plan no recibía corrección ni requisitos explícitos derivados.

## Verificación ejecutada

- npm run test:course-delivery: 70/70, código 0. Log local
  .tmp/hybrid-session-plan-tests.log. El primer pase de 69 casos se amplió con
  rechazo de corrección por falta de tiempo y se repitió la suite completa.
- npm run typecheck: código 0.
- ESLint dirigido a los cinco archivos de código/pruebas modificados:
  --max-warnings 0, código 0. El primer comando apuntó a un ejecutable inexistente;
  se corrigió a ../../node_modules/eslint/bin/eslint.js y se ejecutó correctamente.
- OpenSpec: repair-hybrid-session-plan --strict --no-interactive, código 0.
- git diff --check: código 0.

Las pruebas cubren vínculo omitido, referencias ajenas, BEFORE/AFTER, minutos,
estructura inválida, ausencia de texto privado, una sola corrección, falta de
presupuesto, revisión de fuentes, fallo de respaldo y conservación del documento
anterior. La suite conserva los casos de reanudación con configuración fijada,
permisos, cancelación y conservación de unidades confirmadas.

## Revisión adversarial y límites

Revisión del mismo agente: no se modifican autenticación, autorización, firma,
lease ni RPC de commit. Los motivos públicos proceden exclusivamente de los
validadores; se retiró el título de sesión del mensaje de minutos. La corrección
usa el mismo snapshot y no escribe antes de validar y auditar. El guard de tiempo
reserva el posible fallback y el tiempo de auditoría/guardado existente. No se
relajaron reglas, ajustaron minutos ni añadieron vínculos a la salida en servidor.

No se ejecutaron proveedores reales, migraciones, despliegues, commits ni pushes.
No se certifica la causa concreta del rechazo anterior ni la resolución en staging.
Tras un despliegue autorizado, una nueva ejecución debe comprobar el plan completo
y, si falla, aportar el motivo específico. El piloto de Materiales sigue pendiente.
