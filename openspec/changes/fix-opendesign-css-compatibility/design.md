# Diseño y contexto

Actor: administrador que importa una plantilla HTML en su organización. Objetivo: analizar y reutilizar diseños estáticos compatibles del export proporcionado. Base staging limpia; cambios aislados en codex/fix-opendesign-css-import. No hay escrituras remotas ni agentes concurrentes.

Evidencia local: original de 22 850 884 bytes; preparación de 50 756 bytes, 16 diapositivas, 561 elementos, CSS de 24 690 caracteres. La validación global de caracteres se ejecutaba antes de retirar comentarios. Fuera de comentarios, los únicos caracteres disparadores son tres combinadores `>` válidos. Dos reglas usan data-od-id, eliminado antes del análisis.

Se cambia el orden de la validación CSS: parseo y presupuesto, retirada de comentarios, rechazo de escapes activos, `<` y NUL; `>` deja de ser un carácter prohibido globalmente. Se mantienen las demás restricciones de recursos, at-rules, selectores y complejidad. No se implementa soporte general de escapes CSS.

data-od-id se convierte en data-cf-design-id tanto en markup como en selectores CSS: conserva el vínculo visual, no el prefijo del controlador de OpenDesign. No concede identidad editable ni permisos. El tope de diseños pasa a 24 desde la constante central y el error usa esa constante. Bytes, nodos, campos, preflight y transporte mantienen sus límites independientes.

No cambia courseforge-composition-v2, motion, proveedor, API, tenancy, assets ni almacenamiento. La eliminación de recursos del perfil actual sigue vigente; aceptar el HTML no garantiza fidelidad del original con imágenes/fuentes eliminadas. Si el preflight detecta restricciones adicionales, registrar la evidencia y corregir únicamente incompatibilidades semánticas seguras; no debilitar el editor.
