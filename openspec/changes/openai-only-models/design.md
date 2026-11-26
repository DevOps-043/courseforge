## Decisions

El backend resuelve los IDs de modelos antes de iniciar nuevas llamadas. Los IDs anteriores de otros proveedores se convierten a los valores de OpenAI de la capacidad correspondiente. Los modelos OpenAI identificados en la configuración previa se conservan. Los selectores solo permiten guardar modelos compatibles con la capacidad de texto o imagen.

Responses mantiene los contratos de JSON, búsqueda y lectura de referencias. Las citas web se toman de las anotaciones. Los agentes que crean o revisan propuestas siguen usando los mismos validadores, límites y controles de autoridad. Los clientes existentes aún pueden leer modelos y proveedores históricos en telemetría, auditoría y versiones de producción.
