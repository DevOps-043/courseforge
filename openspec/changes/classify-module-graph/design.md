# Diseño

Usar la API instalada de Madge con las opciones del comando architecture:cycles.
Las aristas son rutas resueltas por TypeScript desde el módulo consumidor.
La emisión CommonJS de cada fuente cíclica identifica imports conservados;
los imports borrados no prueban ejecución ni ausencia de otros efectos.
Los imports sin correspondencia deben quedar sin clasificar, nunca inferirse.

Madge no enumera exhaustivamente todos los recorridos simples. Se calculan
componentes fuertemente conexas (Tarjan) y se clasifican todas sus aristas internas,
incluidos módulos que no aparecen en sus once recorridos representativos.
CSS usa PostCSS, separado del AST TypeScript; JSON no se interpreta como código.

Las advertencias de Madge son specifiers únicos no resueltos, no necesariamente
582 archivos defectuosos ni errores TypeScript. Se conserva el inventario y se
buscan sus declaraciones consumidoras para distinguir paquetes y rutas locales.
El grafo completo queda como salida local; el resumen y continuidad se versionan.
