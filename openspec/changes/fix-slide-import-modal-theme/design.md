# Diseño

Base: `82a36ab0`, checkout limpio en `codex/heygen-external-import-v3`. Rama de trabajo: `codex/fix-slide-import-modal-theme`.

Referencias inspeccionadas: EngineDialog, ConfirmationModal, UserModal y engine-design-system.css. El diálogo nativo hereda reglas del hero; un portal elimina esa relación de descendencia sin modificar CSS global. EngineDialog aporta encabezado, scroll interior, pie, cierre, foco y bloqueo de scroll consistentes con el resto del producto.

Se mantienen estados y operaciones del importador. Los estilos específicos son un CSS Module con tokens `--engine-*`; no se modifica el componente compartido. Los avisos se tiñen con el color semántico y conservan texto de contraste del tema. El preview mantiene los colores del propio diseño, aislados en su iframe.

QA debe montar el componente real en el hero con el sistema de estilos real, no un CSS reducido. Se comprueban contraste calculado, separación del hero, encabezado y pie visibles, controles, revisión y guardado simulado en claro/oscuro, escritorio y móvil. Se prueban Escape y retorno del foco. No se publican cambios ni se usan servicios remotos.
