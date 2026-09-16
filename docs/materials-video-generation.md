# Generación de videos de materiales por etapas

## Problema y decisión

Una respuesta JSON válida no implica que el video cumpla el contrato editorial.
El caso que motivó este cambio produjo 3,809 caracteres (254 segundos estimados)
para un objetivo de 660 segundos. El flujo anterior pedía todos los materiales,
guion y storyboard juntos; aceptaba el JSON y realizaba una sola reparación,
descartando mejoras parciales si aún no pasaban todos los controles.

La generación separa ahora los componentes no audiovisuales de cada video. No
se aumenta el límite de 16,000 tokens de salida ni se reducen los umbrales de QA.
No requiere dependencias nuevas, migraciones ni cambios en los contratos públicos.

## Flujo y responsabilidades

1. `materials-generation.service.ts` genera los materiales no audiovisuales y
   orquesta cada `VIDEO_THEORETICAL`, `VIDEO_DEMO` o `VIDEO_GUIDE` independientemente.
2. `video-generation.service.ts` solicita solo el guion. Valida el schema con Zod,
   las referencias contra las fuentes de la lección y el contrato de duración.
   Los reintentos reciben el mejor borrador y los errores medidos.
3. `video-storyboard-timeline.ts` divide la narración aprobada en tomas sin cruzar
   secciones. Conserva el texto literal y calcula tiempos positivos y continuos.
4. Se solicitan únicamente los visuales, vinculados por `take_number`. Se rechazan
   duplicados, omisiones y tomas ajenas. Los visuales no pueden reemplazar el guion
   ni sus tiempos. Una reparación visual no regenera una narración válida.
5. La validación completa comprueba narración, duración y cobertura visual antes
   de entregar el componente para persistencia.
6. `material-component-write.ts` vuelve a validar todos los videos del lote antes
   de escribir. `material-components.repository.ts` realiza un único `upsert` por
   `(material_lesson_id, type)`, usando el índice único existente. No elimina filas
   previamente; mantiene los IDs y no toca componentes fuera de la selección.

Los adaptadores de Supabase y proveedores están en `netlify/functions/shared`;
la lógica de dominio no depende de clientes de red ni del framework.

## Límites y estados

- Política editorial central: 900 caracteres/minuto, objetivo ±5%, intersectado
  con los límites absolutos del contrato. No se alargan artificialmente timecodes.
- Máximo tres intentos por etapa: principal, corrección con principal, fallback
  configurado (o principal si no hay otro modelo).
- Máximo 120 segundos por petición, ocho minutos por video y presupuesto compartido
  de doce minutos para generación de una lección, incluidas las llamadas no video.
  Las consultas a BD y el guardado quedan fuera del presupuesto de llamadas IA.
- Errores HTTP permanentes 400/401/403/404 excluyen el modelo durante esa generación.
  Errores 429/502/503/504 aplican backoff acotado al tiempo restante.
- Un video inválido nunca se entrega como éxito ni reemplaza el componente anterior.
  Otros componentes exitosos sí se guardan; la lección queda `NEEDS_FIX` con el motivo.
- Solo el éxito de todos los componentes seleccionados marca `GENERATED`; limpia
  errores anteriores y deja los controles de lección pendientes de QA, no aprobados.
- Regenerar un componente invalida sus assets derivados como en el flujo anterior.
  No equivale a una transacción entre componentes y estado de lección: un fallo al
  actualizar el estado puede dejar componentes guardados, pero no un éxito falso.

## Observabilidad y recuperación

`materials-video-generation.ts` registra un evento `MATERIALS_VIDEO_GENERATION`
en `pipeline_events`, correlacionado por artefacto y lección. Incluye versión del
flujo, procedencia/versiones de prompts, modelo, etapa, intento, duración, caracteres,
tokens de salida, motivo de terminación y códigos de validación. No almacena prompts,
narración, respuestas del proveedor ni credenciales en el evento.

Un fallo al registrar telemetría se informa en el logger operativo, sin descartar
un resultado válido. Los errores de generación no se silencian ni se convierten
en contenido aprobado.

Para un material ya generado con el flujo anterior: desplegar/reiniciar el runtime
actualizado, seleccionar solo el video afectado en la regeneración de la lección y
ejecutar QA. El cambio de código no reescribe automáticamente materiales existentes.
La validación de duración es editorial; la duración real se confirma con TTS/audio.
La revisión factual, pedagógica y de correspondencia visual sigue siendo necesaria.

## Verificación

Desde la raíz del repositorio:

```powershell
npm run test:video-duration -w apps/web
npm run verify
npm run build
```

Las regresiones cubren guiones insuficientes, conservación del mejor borrador,
fallback y backoff, límites de tiempo, JSON truncado, referencias desconocidas,
los tres tipos de video, continuidad literal por sección, mapeo de tomas, rechazo
antes de escribir, persistencia parcial, errores de BD y estados pendientes de QA.
Los tests de adaptadores usan fakes; no consumen IA ni escriben a Supabase.

Las llamadas reales deben comprobarse primero sobre una sola lección, en modo de
prueba sin persistencia. La salida de un modelo no es determinista: agotar el
presupuesto sigue siendo posible y debe terminar explícitamente en `NEEDS_FIX`.

Prueba real realizada el 2026-09-15, sin escrituras en BD, sobre la lección del
incidente: `gemini-3.6-flash` generó 9,496 caracteres y 633 segundos estimados,
ocho secciones y 30 tomas. Guion y storyboard pasaron al primer intento de su etapa,
sin errores del validador completo, usando las cuatro fuentes aptas de la lección.
Esta ejecución comprueba ese caso, no garantiza el éxito de toda generación futura.
