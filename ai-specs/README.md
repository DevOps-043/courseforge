# Arnés de desarrollo de Coursegen

Fuente canónica de procedimientos de desarrollo. Leer AGENTS.md, estándares,
contexto, dominio y cambio activo antes de aplicar una skill.

- skills/: procedimientos reutilizables; adaptadores generados por herramienta.
- agents/registry.json: responsabilidades documentales, no procesos ni permisos.
- policies/: límites de herramientas y separación con el runtime.
- templates/: contexto y evidencia de cambios.
- Estado durable en openspec/changes; código y aislamiento en Git.

Ciclo: enriquecer → especificar → aislar → implementar → verificar → revisar →
integrar → sincronizar especificaciones y archivar.
Ver [guía operativa](../docs/operations/harness-quickstart.md).
