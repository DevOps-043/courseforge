# Diseño

## Contexto
- Actor: revisor autorizado de producción y reconciliador de ejecuciones aprobadas.
- Base: `createCompositionTranscriptCaptionPlan`, fábrica nativa, borrador HyperFrames y append optimista existente.
- Contrato: `nativeCaptions?: boolean` dentro de defaults y overrides. Ausente equivale a desactivado; `false` por componente prevalece sobre el default.
- No objetivos: ASR nuevo, single_video sin escenas/timestamps, cambios al artefacto del proveedor, SQL o render cloud.

## Flujo
1. Guardar la opción mediante la ruta ya protegida por identidad, rol y organización.
2. En refresh, solo actuar para ejecución APPROVED, no cancelada, item activo y assets completos.
3. Validar timestamps de las voces por escena antes de crear el borrador. Resolver componente y composición en la organización del run.
4. Inicializar/reconciliar el borrador con los servicios existentes y leer su hash actual.
5. Planificador puro verifica cobertura de voces y captions existentes. Crea usando un ID determinista por item. Nunca regenera automáticamente capas existentes: si corresponden exactamente al resultado esperado, confirma; si difieren, solicita revisión.
6. Añadir con expectedDocumentHash y auditoría SYSTEM. Ante conflicto, informar revisión; no forzar ni repetir el append.
7. Persistir `readiness.nativeCaptions` (estado, detalle seguro y referencia de capa cuando exista). Si el item ya registró una capa, su eliminación no autoriza recrearla. Fallos no disparan nuevamente la generación pagada de assets.

## Riesgos
Refrescos concurrentes: el append existente usa hash y CAS. Un conflicto queda visible y un refresco posterior puede reconocer el resultado ganador. Guardado incierto se recupera por lectura en el próximo refresco. Cancelación observada al inicio impide efectos; una cancelación concurrente no es una transacción con el append. Las voces con cobertura incompleta se bloquean, sin inventar tiempos. No sobrescribir captions de otro run ni capas manuales/importadas/recortadas sin confirmación explícita de la capa y versión; múltiples capas siguen requiriendo revisión en el editor.

## Compatibilidad y reversión
Campos JSON aditivos, sin migración. Desactivar `nativeCaptions` detiene nuevos intentos, conserva capas y vuelve a evaluar readiness de assets. No degradar el lector V3 tras persistir captions. El render sigue requiriendo acción explícita.

## Confirmación de sobrescritura (ampliación)

Cuando una única capa existente requiere revisión y su pista está desbloqueada,
se ofrece «Sobrescribir subtítulos…». La UI pregunta antes de enviar la orden.
Cancelar no envía cambios. Aceptar autoriza reemplazar texto, tiempos y ajustes
por frase de esa capa, conservando identidad, posición y estilo de capa, con fondo
transparente. No es una preferencia persistente ni una autorización para el cron.

La orden POST de refresco contiene itemId, clipId y hash del documento mostrado.
Servidor resuelve usuario/organización, valida pertenencia del item y exige el
mismo hash al planificar y guardar. Si cambió la versión, ofrece confirmar de
nuevo, sin aplicar la autorización anterior. Múltiples capas o pista bloqueada
siguen requiriendo resolver el contexto en el editor; no se eliminan otras capas.
El botón «Generar desde la voz» del editor también solicita confirmación antes
de reemplazar una capa existente.
