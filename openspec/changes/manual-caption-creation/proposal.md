# Crear capas de subtítulos manualmente

## Why
La creación manual existe bajo Texto como «Captions transparentes», sin una ruta
explícita de subtítulos. La frase inicial ocupa toda la capa y bloquea añadir
otra frase sin ajustar primero los tiempos.

## What Changes
- Pestaña Subtítulos con acción principal Crear subtítulos manuales, independiente
  de voz, timestamps o archivos. Generar desde la voz queda como opción explícita.
- Nueva capa MANUAL con frase editable breve y espacio para añadir otras frases.
- Tras crear se selecciona la capa y se abre su edición en el tiempo correcto.
- Texto, tiempos y acción de añadir usan terminología de subtítulos en español.

## Impact
Biblioteca, inspector, factory de overlays y QA. Sin SQL, proveedores nuevos,
generación automática, cambios de documentos históricos ni desactivación de la
automatización optativa de producción.
