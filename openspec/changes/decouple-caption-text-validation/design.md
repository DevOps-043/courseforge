# Diseño

composition-caption-text-validation.ts contiene dos funciones puras y un
segmentador de grafemas. Solo importa el tipo CompositionCaptionEmphasis desde
el contrato estable de efectos; no depende del schema de cues, servicio o planes.
El servicio reexporta ambas funciones para conservar consumidores existentes.
La lógica se mueve sin alterar comparaciones, ordenamiento o segmentación.

El schema de cues conserva superRefine y sus errores, pero importa la validación
desde el módulo neutral. Se caracterizan las funciones por su interfaz existente
antes de extraerlas. Eliminar import type de los análisis no forma parte del cambio.
