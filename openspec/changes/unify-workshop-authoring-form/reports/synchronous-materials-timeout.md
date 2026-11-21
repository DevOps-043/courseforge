# Diagnóstico de Materiales síncronos — 21 de noviembre de 2026

## Evidencia y causa

El log local de desarrollo registra tres fallos `TimeoutError` del worker de impartición: dos de la ejecución `ba4fbbf6-2de4-4ebf-a73f-2c9d1da0dc33` y uno de `feca3df5-2648-4599-b4ad-4c12f2e07033`. El intervalo observado desde el inicio del worker hasta el fallo es aproximadamente 96–101 segundos. El generador tenía un `AbortSignal.timeout(90_000)` compartido para Agenda, Plan y Materiales.

Materiales solicita un objeto amplio con contenido, actividades e instrumentos. La causa confirmada de esos intentos es el vencimiento del tiempo de espera; no se ha demostrado que una ampliación concreta garantice completar cualquier sesión. El catch persistía un error genérico y el handler devolvía éxito incluso al terminar en FAILED. Los 200 de consultas de progreso no demuestran éxito de generación.

## Cambio

- Materiales admite 180 segundos por intento; Agenda y Plan conservan 90.
- La reserva antes de cada unidad incluye los intentos configurados, comprobación de respaldo y guardado. Materiales con respaldo reserva 495 segundos dentro de los nueve minutos de ejecución y del lease existente de doce minutos.
- La auditoría recibe su plazo explícito dentro del presupuesto disponible.
- Diagnóstico seguro con etapa y categoría, eventos de inicio de unidad/generación/respaldo y contexto de correlación.
- Resultado explícito del worker y respuesta 503 del handler al terminar en FAILED.
- Se conservan las reglas de validación, fuentes, concurrencia, aprobación y reanudación de pendientes.

## Validación y límites

`npm run test:course-delivery` en `apps/web`: 57 pruebas aprobadas, incluyendo presupuesto, clasificación sin filtración de contenido, respuesta del handler y conservación/reanudación de unidades ante TimeoutError. ESLint dirigido a los seis archivos de implementación y pruebas: aprobado. `npm run typecheck` desde la raíz: aprobado. `git diff --check`: aprobado, con avisos de normalización LF/CRLF en archivos existentes.

Revisión del mismo agente: se preservan autenticación del handler, reserva exclusiva del worker, contratos de contenido y guardado transaccional. El panel existente muestra `last_error`; no requiere un cambio de interfaz para presentar el nuevo diagnóstico. No se acredita generación real mediante estas pruebas simuladas.

No se ejecutaron migraciones, despliegues ni nuevas llamadas pagadas como parte del diagnóstico. La generación real del curso con el nuevo presupuesto queda pendiente de reanudar y observar; no requiere recrear el curso ni repetir las unidades confirmadas. Si vuelve a superar el límite, el diagnóstico permitirá decidir entre ajustar modelo/razonamiento o dividir el trabajo de Materiales, con evidencia del nuevo intento.
