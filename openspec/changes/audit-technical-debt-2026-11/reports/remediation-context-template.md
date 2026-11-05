# Plantilla de continuidad de una unidad de corrección

Plantilla vacía, no evidencia de trabajo ejecutado. Copiar al OpenSpec de la
corrección como `reports/context-<unidad>.md`; conservar ahí el único estado vigente
de la unidad. El registro histórico de verificaciones se añade sin sobrescribir.

## Objetivo y actor

- Unidad / fase / hallazgos:
- Responsable (o por asignar):
- Resultado observable y criterios de aceptación pendientes:
- Estado (identificado, validado, planificado, en curso, bloqueado, resuelto pendiente de verificación, cerrado):

## Base y alcance

- Fecha y zona horaria:
- Rama / HEAD base / HEAD actual:
- Commits de esta unidad, si existen:
- Diff pendiente y cambios previos ajenos (rutas exactas, sin contenido sensible):
- OpenSpec y tareas correspondientes:
- Fuentes mínimas para retomar (rutas y símbolos; incluir consumidores):
- Archivos modificados y responsabilidad de cada uno:
- No objetivos; acciones externas no autorizadas:

## Dominios y contratos

- Identidad/rol/organización y punto de autorización:
- API/job/RPC/schema/estado afectado:
- Invariantes que deben conservarse (hash, versión, idempotencia, errores):
- Decisiones vigentes, motivo y alternativa descartada relevante:
- Dependencias satisfechas y pendientes (unidades/ambiente/herramientas):

## Evidencia y verificaciones

| Fecha | Criterio | Comando / entorno / HEAD | Código y resultado real | Ruta de salida | Límite de evidencia |
|---|---|---|---|---|---|
| Por completar | — | — | No ejecutado | — | — |

- Hechos confirmados:
- Hipótesis por probar o refutadas:
- Fallos previos frente a fallos introducidos:
- Criterios acreditados y qué falta para cerrar el hallazgo:
- Rollback concreto del cambio; efectos externos o datos que no se pueden revertir con Git:

## Punto exacto para continuar

- Última operación completada y resultado:
- Código parcial o archivos temporalmente inconsistentes, si existen:
- Siguiente acción concreta y archivo/símbolo:
- Próximos comandos de validación pertinentes:
- Bloqueo y acción de desbloqueo, si existe; trabajo independiente habilitado:
- Unidad siguiente recomendada y por qué está habilitada:

## Historial de continuidad

Añadir una fila por corte o transición, sin borrar las anteriores. La sección
«Punto exacto» se mantiene vigente; los logs extensos permanecen en reports/.

| Fecha | HEAD / diff | Estado anterior → nuevo | Cambio/decisión | Evidencia | Siguiente acción |
|---|---|---|---|---|---|
| Por completar | — | — | Plantilla, sin ejecución | — | — |

Antes de retomar, contrastar siempre este texto con Git y las fuentes actuales.
No incluir secretos, tokens, prompts privados ni datos personales.
