# Diagnóstico de respaldo asíncrono — 21 de noviembre de 2026

## Evidencia

El log local registra generación de video con estado PASS y después fallo de respaldo para DIALOGUE, READING, EXERCISE, QUIZ y VIDEO_DEMO/VIDEO_GUIDE de varias lecciones. El mensaje proviene de `materials-generation-runtime.ts`, no del generador de sesiones de Hub. El catch descartaba el componente no acreditado y sustituía cualquier excepción por el mismo texto. El auditor también ocultaba el motivo técnico del proveedor en su telemetría.

Estos registros confirman la etapa que falla, pero no permiten determinar retrospectivamente si se rechazaron citas, cambió el snapshot o falló el proveedor. No es correcto atribuirlo al timeout síncrono ni afirmar que faltan fuentes.

## Cambio acotado

- Categorías públicas por componente: contenido sin respaldo, fuente ajena, cita no literal, afirmación ausente, conflicto de vigencia, tamaño e indisponibilidad técnica.
- Logs del auditor identifican timeout, cuota, configuración o respuesta inválida del proveedor cuando corresponda.
- Logs del componente incluyen snapshot, lección, tipo y tiempo restante. No contienen prompts, citas ni respuestas privadas.
- Se conserva el rechazo del componente sin recibo válido; no se debilitan las reglas de fuentes ni se añade selección manual.

## Verificación y siguiente paso

- `npm run test:course-sources`: 78 aprobadas, incluido fallo del proveedor sin creación de recibo.
- `npm run test:materials-generation`: 30 pruebas de generación y 5 de recuperación aprobadas.
- ESLint dirigido y `git diff --check`: aprobados.

No se iniciaron generaciones pagadas, migraciones o despliegues. La causa concreta de los fallos históricos permanece pendiente: un nuevo intento de un componente deberá aportar el código y los eventos `materiales.respaldo/componente_rechazado` y, si aplica, `fuentes.respaldo/revision_proveedor_fallida`. Evitar repetir el curso completo para obtener ese diagnóstico. Esta entrega mejora la evidencia y no acredita resolver la causa original.
