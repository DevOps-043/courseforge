# Contexto de la corrección de latencia — 2026-10-30

- Objetivo y actor: continuar editando una composición autorizada mientras se guarda.
- Base y alcance: 13774405, rama codex/editor-latency-investigation-20261030;
  inspector, cola local, preview y observabilidad del editor.
- No objetivos: cambiar RPC, permisos, esquema persistido, proveedores o desplegar.
- Dominios/contratos: documento V2, patches, If-Match, historial y recuperación.
- Permisos y efectos externos: sin SQL remoto, publicación ni procesos pagados.
- Criterios verificables: dos cambios visibles con primer PUT retenido; respuesta
  anterior conserva el último borrador; persistencia serial; cancelación de cola
  conserva pendientes; X no incluye timing/opacidad; fallbacks siguen protegidos.
- Riesgos e incertidumbres: sesión HTML ligada a revisión/manifiesto; no se elimina
  su barrera de compilación sin un contrato autorizado equivalente. No hay métricas
  de producción ni evidencia de un problema de índices.
- Entorno: junctions locales a node_modules del checkout principal con el mismo
  lockfile; permiten compilar el código del worktree sin copiar configuración ni
  credenciales. No se modifica el árbol de dependencias compartido.
