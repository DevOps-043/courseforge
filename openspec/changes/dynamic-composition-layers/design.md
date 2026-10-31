# Contexto y diseño

- Actor: editor autorizado de una composición.
- Alcance: documento, patches locales/servidor, inspector y agente.
- No objetivos: pistas temporales, proveedor de render ni cambios de motion.
- Contrato: `extraLayerDepths` opcional, ordenado, único, enteros 11–1000.
  El máximo técnico acota el documento; 0–10 sigue siendo el rango inicial.
- Lecturas históricas sin el campo conservan la normalización legacy 0–10 y
  su hash persistido. Documentos con el campo no recortan profundidades nuevas.
- `layer.add` y `layer.remove` requieren origen USER. La eliminación ocupada
  exige dos confirmaciones en UI y los IDs exactos en servidor; ETag protege
  cambios concurrentes. La confirmación es intención editorial, no autorización.
- Quitar clips reutiliza la limpieza de motion, transiciones y grupos existente.
- Reversión: ocultar controles manteniendo lectores compatibles tras el primer
  documento con extras; deshacer restaura el documento por el flujo existente.
