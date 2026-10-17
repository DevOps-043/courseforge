# Diseño

El preset aplica settings validados, no scripts ni un nuevo motor. Educativo usa
fundidos de frase; Lectura guiada cambia el color activo y mantiene las demás
palabras legibles; Social usa fondo activo y texto oscuro sin transformar palabras.
El catálogo no persiste un ID redundante: se guardan los efectos y el selector
reconoce settings coincidentes. Se mantienen los presets de apariencia existentes.

La ampliación V1 agrega karaoke BACKGROUND y activeBackgroundColor opcional. Los
documentos previos conservan su forma al parsearse; un color por defecto se
resuelve al compilar si falta el opcional. Cada palabra restaura su color/fondo de
énfasis al salir de su intervalo. Los espacios no reciben resaltado; no se añaden
padding ni transformaciones que cambien el layout.

Aplicar un preset a la capa conserva overrides y énfasis de las frases; la UI lo
explica. Los bloques breves ya se generan desde voz (máximo cinco palabras); el
preset no resegmenta texto manual/importado ni inventa timestamps. Sin alineación
por palabra solo funcionan fundidos y énfasis estático.

Desplegar juntos lector/servidor/compilador/UI. Un servidor anterior no conoce el
nuevo enum; no hacer downgrade de lector tras persistir BACKGROUND. Los snapshots
existentes son inmutables y requieren una nueva compilación para cambiar apariencia.
