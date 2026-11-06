# Diseño

F0.1 observa el checkout principal y conserva resultados por comando en reports/.
Cada código pertenece al proceso npm, no al wrapper de captura. El gate detiene
sus pasos al primer fallo; tipos y grafo se ejecutan además de forma independiente.
No se acredita instalación limpia ni equivalencia con Node 22 de CI.
La reversión consiste en retirar únicamente los documentos de este cambio.
