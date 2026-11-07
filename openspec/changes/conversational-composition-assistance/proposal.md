# Asistencia conversacional en el editor

- Objetivo y actor. El revisor conversa con SofLIA para resolver ambigüedades y editar la composición activa.
- Base y alcance. Chat del editor nativo, contexto de lectura, propuesta y reversión. Se habilitan volumen individual, fades, volumen maestro y ajuste de encuadre.
- Permisos. La respuesta de texto no se persiste. Las ediciones siguen sujetas a organización, versión, validación y confirmación explícita.
- Fuera de alcance. Ejecución de código, reemplazo de fuentes, cambios destructivos, publicación y render.

## Escenarios

- Cuando falte el destino o el valor, SofLIA pregunta y el siguiente mensaje incluye el intercambio reciente.
- Una respuesta conversacional no genera propuesta ni habilita aplicar.
- Una edición admitida reutiliza el patch manual, se simula, aparece en el diff y tiene una inversa.
- Operaciones fuera del catálogo, pistas bloqueadas y clips incompatibles se rechazan.
- El consumidor de creación de presets conserva su contrato de propuesta.
