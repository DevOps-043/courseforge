# Diseño

Los formularios usan `EngineSelect` con los tokens de superficie, borde, texto y acento de `engine-design-system.css`. Los inspectores y barras densas usan su variante compacta. `PremiumSelect` conserva su interfaz como adaptador del selector compartido.

Se conservan valores, etiquetas, orden, agrupación de fuentes y opciones deshabilitadas. Las tres selecciones obligatorias mantienen los botones de envío condicionados y validan la elección antes de llamar al flujo correspondiente. La selección se confirma con clic, Enter o Espacio. El foco permanece en el disparador mientras se recorren opciones y Tab sigue el orden del formulario.

El panel usa coordenadas de ventana y se muestra en la capa superior mediante Popover, igual que las herramientas de composición. El portal existente funciona como respaldo en navegadores sin esa API. Abre hacia el lado con más espacio cuando es necesario y limita su altura a la ventana. En diálogos, Escape cierra primero el selector. Revertir los componentes y sus estilos restaura los selectores previos sin migraciones.
