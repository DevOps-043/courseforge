# Migrar la importación residual de HeyGen a v3

La ruta import-external consulta v2 y una clave global aunque el dominio actual
ya dispone de cliente v3 y credenciales por organización. Se elimina esa consulta
antes del retiro de v1/v2 y se reutilizan los contratos existentes.

Alcance: resolución del origen, frontera HTTP, pruebas y documentación.
No cambia generación, jobs, webhooks, esquema de datos ni render.
