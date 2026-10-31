# Contexto
- Objetivo y actor: autor que crea referencias de alineación propias.
- Base y alcance: checkout principal; toolbar, preferencias locales, iframe interactivo y snap.
- No objetivos: guías compartidas con el equipo, reglas graduadas, renderización de guías, modificar clips al crear guías.
- Dominios/contratos: esquema de preferencias local y mensajes editor-guides/guide-move; documento de composición sin cambios.
- Permisos y efectos externos: sin persistencia remota. Receptor usa validación de origen, generación y schemas existentes.
- Criterios verificables: alta/movimiento/color/eliminación, adaptación al formato, snapping, persistencia local y ausencia en render.
- Riesgos: almacenamiento local puede estar bloqueado; informar y mantener sesión operativa. Máximo 32 guías para limitar DOM y snap.

# Diseño
Guías identificadas por UUID, eje x (vertical) o y (horizontal), posición normalizada 0–1 y color hexadecimal cerrado. El panel presenta coordenadas en píxeles; porcentajes conservan ubicación relativa al cambiar formato. Una clave local versionada por draft conserva estado y visibilidad. La lectura inválida se descarta con aviso visible; errores de escritura no afectan guardado del video.

El runtime interactivo dibuja botones-guía superpuestos sin data-hf-id ni clips/timing. Captura puntero, evita selección/marquee y sólo notifica posición al soltar. Flechas mueven 1 píxel, Shift+flecha 10. El emisor incorpora generación del preview; el padre sólo admite IDs existentes, mensajes del iframe activo y posiciones válidas. Durante el arrastre se modifica sólo la línea, nunca el documento.

Guías visibles alimentan snap de movimiento/redimensión. Ocultar guías también las excluye de snap; el interruptor Snap sigue siendo la autoridad global. No se envían a baseline de comparación. Reaplicar configuración tras recarga/escena preserva las referencias. Los renderers no interactivos no contienen el runtime de guías.

# Reversión
Retirar panel/hook/protocolo/runtime; las preferencias locales quedan inertes. Sin modificación de documentos ni SQL.
