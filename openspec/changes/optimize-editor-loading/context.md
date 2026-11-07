# Contexto

- Objetivo y actor: autores que cambian de artefacto o lección en el editor.
- Base y alcance: checkout principal; importaciones de etapas y preparación de medios.
- No objetivos: modificar autosave, render, credenciales, BD o contenido de cursos.
- Dominios/contratos: artefactos, materiales, HyperFrames; conservar rutas y respuestas.
- Permisos y efectos externos: autorización existente en servidor; ninguna llamada
  pagada ni acceso a datos reales como parte de las pruebas locales.
- Criterios verificables: dependencias correctas, biblioteca visible si falla el
  borrador, concurrencia limitada, descargas secuenciales, errores propagados,
  rechazo de respuestas obsoletas y regresiones de producción verificadas.
- Riesgos e incertidumbres: latencia real de red/proveedores sin medir; evitar
  prometer porcentajes. La sincronización sigue precediendo al borrador para
  que el ensamblado incluya medios actuales.
