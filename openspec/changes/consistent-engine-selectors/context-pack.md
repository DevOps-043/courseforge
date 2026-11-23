# Contexto

- Objetivo y actor. Quien crea, revisa o produce cursos necesita selectores coherentes en los formularios y editores.
- Base y alcance. El inventario de JSX de `apps/web/src` identificó 68 selectores nativos y un selector independiente en el plan instruccional. `EngineSelect` y su CSS proporcionan el patrón existente.
- Dominios. Creación de cursos, temario, plan instruccional, entrega, plantillas, HeyGen, automatización de producción y editor de composición.
- Permisos y efectos externos. La selección actualiza el mismo estado del usuario y conserva las validaciones de los formularios.
- Criterios verificables. Sin selectores nativos en JSX de producto, navegación completa y panel visible en claro, oscuro y vista estrecha.
- Riesgos. Posición sobre modales, densidad en barras y conservación de las selecciones obligatorias.
