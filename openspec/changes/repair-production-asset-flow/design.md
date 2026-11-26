# Diseño

- Enviar un JSON Schema estricto al proveedor B-roll, mantener validación Zod y mínimo de tomas. Rechazo, truncamiento o estructura inválida producen diagnóstico seguro; no se aceptan arreglos inventados ni respuestas vacías como éxito.
- Respuestas de slides nuevas y reutilizadas comparten el mismo contrato de seguimiento. Un job ausente es NOT_FOUND, nunca QUEUED. El cliente consulta con timeout, cancelación y límite; recupera el último trabajo al montar sin generar otro. Sólo un worker reclama el estado pendiente/en cola antes de producir.
- La revisión síncrona en Producción usa tarjetas por sesión y selección de audiencia dentro del curso. Proyección explícita del participante sin respuestas, preparación o notas reservadas. Exportaciones conservan autorización y siguen disponibles.
- Sin cambios de esquema de datos ni relajación de QA. La evidencia observada en staging no confirma la causa operativa del worker; las pruebas locales cubren contratos y fallos reproducibles.
