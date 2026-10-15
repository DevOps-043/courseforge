---
name: update-project-docs
description: Mantiene documentación canónica y sincronizada con los contratos reales.
---

# update-project-docs

1. Leer docs/README.md y docs/standards/documentation.md.
2. Elegir la fuente canónica del dominio; conservar rutas operativas existentes.
3. Para README/contexto, aplicar docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md y npm run docs:audit.
4. Actualizar system-context.md; CLAUDE.md y codex.md permanecen routers.
5. Mantener hechos, inferencias y pendientes separados; no copiar código a documentación.
6. Ejecutar npm run docs:check y registrar evidencia en el cambio.
