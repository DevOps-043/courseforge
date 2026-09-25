# Ventana de aceptación de guiones del paso 5

La generación apunta al tiempo esperado, pero acepta todo el intervalo definido por
el mínimo y el máximo, ampliado un 5 % en cada extremo. Antes, el validador exigía
además ±5 % alrededor del objetivo, rechazando guiones dentro del intervalo del curso.

## Contrato

- Mínimo aceptado: `round(minimumDurationSeconds * 0.95)`.
- Máximo aceptado: `round(maximumDurationSeconds * 1.05)`.
- Los extremos se redondean una sola vez a segundos enteros; el presupuesto de
  caracteres se deriva de esos segundos a 900 caracteres por minuto.
- El objetivo sigue siendo `targetDurationSeconds`, sin convertirse en otro límite.
- Se conservan las validaciones de contenido, cobertura visual y timecodes.

Ejemplo: mínimo 6 min, esperado 7 min y máximo 8 min. La ventana pasa de
6:39–7:21 (5.985–6.615 caracteres) a 5:42–8:24 (5.130–7.560 caracteres).
El objetivo editorial permanece en 6.300 caracteres.

`buildVideoDurationAcceptanceRange` centraliza los extremos. Tanto el presupuesto
enviado a los prompts como la validación usan esa política. Los guardrails numéricos
prevalecen sobre prompts personalizados antiguos. Para cambiar el porcentaje,
modificar la constante central y mantener alineada la explicación del prompt global.

## Compatibilidad e impacto

Aplica a VIDEO_THEORETICAL, VIDEO_DEMO y VIDEO_GUIDE con contrato de duración,
incluidos contratos guardados anteriormente. `targetOverrunSeconds` sigue siendo
legible por compatibilidad, pero deja de estrechar la ventana alrededor del objetivo.
Los rangos con mínimo igual al máximo también reciben el margen.

No requiere migración de base de datos. No modifica ni regenera materiales guardados,
ni actualiza automáticamente estados de validación persistidos. Tras desplegar,
revalidar los materiales afectados antes de decidir si necesitan regeneración.
La estimación por caracteres no garantiza la duración final del audio TTS.

## Validación

Ejecutar `npm run test:video-duration --workspace=web`. Cubre los tres tipos de video,
extremos nominales y ampliados, exceso de un carácter aunque los segundos redondeen
al límite, objetivos asimétricos, contratos antiguos y generación por etapas.

Verificación posterior al despliegue: generar un video con política 6–8 min,
comprobar el rango numérico del prompt y la aceptación de guiones próximos a ambos
extremos; contrastar después la estimación con el audio real. No se han realizado
llamadas a proveedores ni mediciones de audio en esta validación local.
