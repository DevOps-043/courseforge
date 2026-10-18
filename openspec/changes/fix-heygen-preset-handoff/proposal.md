# Conservar presets al abrir HeyGen desde Producción

El usuario elige avatar y voz en Producción, pero la navegación sólo transmite
el componente y el regreso. HeyGen inicializa otros valores del catálogo.

Se transmitirán ambas selecciones como preferencias iniciales y se contrastarán
con el catálogo autorizado. Las escenas sin selección propia heredarán los
valores visibles al guardar o generar. Las selecciones explícitas se conservan.

Alcance: navegación de Producción, estado cliente de HeyGen y pruebas puras.
No objetivos: cambiar defaults de organización, regenerar assets, modificar
APIs, esquema de datos, permisos ni integración con el proveedor.
