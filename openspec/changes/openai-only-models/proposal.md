## Why

El proveedor de cursos ya se cambió a OpenAI para el piloto híbrido. Lia, SCORM, B-roll, agentes de producción y ajustes heredados aún pueden enviar peticiones a Gemini.

## What Changes

- Adoptar OpenAI en la generación, la búsqueda y los agentes de Architect. Usar GPT-6.1 Terra y GPT-6.2 Sol como valores predeterminados para texto, y los modelos de imagen de OpenAI para diapositivas.
- Resolver modelos antiguos a OpenAI en las fronteras de ejecución y retirar Gemini de los selectores y las validaciones de configuración. Conservar el historial y los contratos de los artefactos.

## Impact

- Configuración por organización, web, workers y agentes de producción. Los servicios de almacenamiento, importación y render conservan sus contratos.
