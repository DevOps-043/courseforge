# Compatibilidad CSS de OpenDesign

El export real SofLIA_Highlands_Premium_EN_v4.html dispara un falso positivo: comentarios CSS con escapes y selectores descendientes directos válidos (`>`). Contiene además 16 diapositivas, frente al tope de 12, y estilos que dependen de data-od-id, atributo eliminado por la preparación.

Eliminar comentarios antes de validar escapes, admitir combinadores CSS válidos y mantener bloqueados escapes activos, etiquetas HTML, recursos y código. Preservar data-od-id como ancla visual sin autoridad de edición y ampliar a 24 diseños, conservando presupuestos de bytes/complejidad y preflight. Validar también con el archivo real local sin incorporarlo al repositorio ni ejecutar sus scripts.
