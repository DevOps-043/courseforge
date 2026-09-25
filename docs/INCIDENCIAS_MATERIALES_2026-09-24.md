# Revisión de incidencias de materiales — 24 de septiembre de 2026

Reporte revisado: [SofLIA — Generación de materiales](https://docs.google.com/document/d/1Jnix2P5VJ_l_y8d4fAS3nXCFnH0jMA8O9IvSkH2t7fs/edit).

## Cambios implementados

| Incidencia | Corrección local |
| --- | --- |
| Video Demo excede duración/narración | Presupuesto inicial por sección que suma el objetivo completo. Las correcciones de extensión pueden devolver solamente narración por sección; el servidor conserva fuentes, notas visuales y ejercicio, y vuelve a medir el resultado. Los límites de duración siguen vigentes. |
| Regeneración global repite trabajo correcto | Selección de componentes faltantes o inválidos utilizando los componentes guardados y los contratos del plan. Se conserva la regeneración completa para una corrección manual o transversal sin defectos específicos detectables. |
| Regeneración individual parece completar una lección incompleta | Antes de declarar éxito, se valida la combinación del componente nuevo con los componentes guardados, usando las mismas reglas de la validación posterior. Los resultados útiles se guardan aunque falte otro componente. |
| Validación y estados inconsistentes | Validación individual compara estado, iteración y fecha de actualización antes de guardar; los errores de lectura/escritura se propagan. La validación global consulta nuevamente los estados antes de concluir y comprueba versión, estado y fecha del registro padre. |
| Botón de validación después de reparar lecciones | Se ofrece cuando todas las lecciones están generadas, aunque el estado global anterior fuera `PHASE3_NEEDS_FIX`. Al solicitar validación se activa el seguimiento del proceso. La etiqueta distingue “Generado · sin validar”. |
| Aproximadamente 30 tomas | Se elimina el mínimo artificial de dos tomas por sección breve. Se conserva la cadencia configurada, el mínimo de tomas y la narración íntegra. Treinta tomas pueden seguir siendo correctas para un video largo. |
| Fallos del proveedor | Los errores de un componente no descartan los demás. Un modelo no disponible deja inmediatamente sus intentos restantes al modelo de respaldo configurado. |
| Control de quiz inconsistente | Los errores de opciones se asignan al Control 5 de forma explícita, sin depender de mayúsculas o palabras en el mensaje. |

## Verificación

- Pruebas de duración, generación por etapas, selección de reintentos y recuperación de materiales.
- Regresión sintética de 20 lecciones, cinco con videos de una iteración posterior: validación repetida sin modificar los componentes.
- Regresión de guion excesivo corregido mediante narración por sección.
- Regresión de regeneración parcial con otro componente todavía faltante.
- Regresión de excepción de proveedor que conserva la lectura generada.
- Lint, comprobación de TypeScript y compilación de producción.

La compilación reportó cuatro advertencias de rastreo de archivos dinámicos en módulos de producción visual ajenos a estos cambios.

## Alcance y comprobación pendiente

Los cambios están en el repositorio local. No se desplegaron ni se regeneró el curso original; tampoco se modificaron sus datos ni los prompts almacenados en la organización.

No se reprodujo el regreso literal de todas las lecciones a `PENDING` del reporte. El validador revisado escribe `APPROVABLE` o `NEEDS_FIX`; los reinicios de generación sí pueden escribir `PENDING`. Para atribuir ese episodio se necesita el ID del artefacto y sus eventos de ejecución. Las pruebas usan datos sintéticos y respuestas simuladas, no llamadas reales a Gemini/OpenAI.

Después del despliegue, comprobar en el curso afectado: reanudar pendientes, verificar que no cambien los componentes correctos, validar materiales y confirmar que las lecciones aprobables permanecen disponibles. Si un guion sigue fuera de rango, revisar sus eventos `MATERIALS_VIDEO_GENERATION` con modelo, intentos y conteos medidos.
