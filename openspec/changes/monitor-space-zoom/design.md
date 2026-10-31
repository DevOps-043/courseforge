# Contexto
- Objetivo y actor: autor que necesita ver más grande el video sin pantalla completa.
- Base y alcance: checkout principal; distribución del estudio, controles y geometría interactiva.
- No objetivos: cambiar resolución del video, escalar clips, zoom del timeline, pan de cámara o recortar el video final.
- Dominios/contratos: límites de zoom compartidos entre UI, protocolo y runtime. Layout de composición intacto.
- Permisos y efectos externos: ninguno nuevo; todo el ajuste es de vista local.
- Criterios verificables: tamaño real del monitor mayor, ampliación/restauración sin fullscreen, 25/100/400%, layouts vertical/cuadrado y toolbar accesible.
- Riesgos: más zoom recorta la vista alrededor del centro; «Encajar» restablece todo el lienzo. Los paneles mantienen estado al ocultarse; accesos a inspector/biblioteca restauran distribución para no parecer inactivos.

# Diseño
Config central 25–400%, paso 5%, fit=100%. El control de zoom usa popover en top layer con slider, porcentaje numérico, presets y Encajar. Se mantiene accesible en monitores pequeños. Runtime y áreas seguras comparten geometría; la función autocontenida recibe límites opcionales para serialización sin dependencias externas.

La vista normal da 74% de altura inicial al monitor; separador permite 30–85%, doble clic restaura 74%. Se reduce mínimo de timeline a 9rem con scroll existente. Modo ampliado oculta laterales sólo mediante CSS, guarda la proporción anterior y empieza en 82%; restaurar recupera proporción y estado. No invoca Fullscreen API. El marco llena el stage sin límite 58rem, con letterboxing calculado dentro del iframe y áreas seguras sincronizadas.

El iframe declara border:0 para que su viewport interior coincida con el tamaño usado por áreas seguras, sin depender del preflight global. En monitores de menos de 26rem, deshacer/rehacer se trasladan a Herramientas para evitar solapamientos y mantener accesibles zoom/ampliación. El zoom se abre en top layer, permite tabulación normal entre campos y presets, y Escape restaura el foco al disparador.

# Reversión
Revertir UI/config/runtime y CSS, sin migraciones ni cambios de documentos. No se persisten preferencias nuevas.
