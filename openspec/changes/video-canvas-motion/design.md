# Diseño y alcance

El layout estático permanece en `.clip-content`; GSAP transforma su descendiente
`.motion-subject`. Se cambia únicamente el overflow del contenedor de layout a
visible. `#composition-root` continúa recortando la composición final.

Crop y máscara pertenecen al contenido animado y viajan con él. Los viewports
internos de slides y texto siguen limitando su propio contenido; no se amplían
para simular otro tamaño de asset. No se recalculan distancias ni keyframes de
entradas/salidas ni se mueven los controles de selección con la animación.

Esto corrige el clipping de todas las animaciones existentes sin migrar versiones
persistidas. No añade entradas desde fuera del video si los keyframes guardados
solo recorren una distancia corta; tampoco cambia ejes locales de clips rotados.

Riesgos: controles editoriales y crop levantado pueden desbordar su rectángulo;
siguen acotados al canvas y no deben alterar la exportación. QA comprueba canvas,
crop y máscara, así como invariancia temporal y seek inverso. Reversión: restaurar
el overflow anterior; no hay datos que revertir.
