# Separar agrupación y anidación en el timeline

## Why
La agrupación editorial coordina selección y movimiento, pero no colapsa sus
miembros. La jerarquía existente se confunde con la anidación solicitada.

## What Changes
- Agrupar conserva los clips visibles; anidar crea un contenedor editorial que
  ocupa un solo bloque desde el inicio mínimo hasta el final máximo seleccionado.
- Doble clic o Enter abre el contenido; la ruta y Escape regresan al nivel anterior.
- El modo se persiste sin alterar clips, medios, pistas, audio ni motion.
- Migración aditiva y capacidad SQL protegen la escritura en entornos anteriores.

## Impact
Editor, documento, patches, duplicación y validación SQL. No cambia el proveedor,
no hay render pagado, SQL remoto ni despliegue en este trabajo.
