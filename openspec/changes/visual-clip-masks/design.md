# Contexto
- Objetivo y actor: autor que combina recorte por bordes con una forma geométrica.
- Base y alcance: checkout principal, imagen/video/diapositiva.
- No objetivos: dibujo libre, imágenes de máscara, feather, inversión o animación de la máscara; texto/audio.
- Dominios/contratos: campo opcional clip.mask, operación validada clip.mask, renderer compartido y preview efímero.
- Permisos y efectos externos: autorización actual; servicio rechaza pista bloqueada y tipos no compatibles. Sin publicación, generación o cambios sobre archivos.
- Criterios verificables: intersección, conservar crop al quitar máscara y viceversa, preview inmediato, persistencia y lectura, límites y permisos.
- Riesgos: lectores antiguos estrictos; recomendar despliegue compatible de web/worker. No cambia proveedor ni credenciales.

# Diseño
Schema cerrado con formas CIRCLE/ELLIPSE/ROUNDED_RECT y redondeo porcentual 0–50 sólo para el rectángulo. Un wrapper .composition-visual-mask dentro de .motion-subject aplica clip-path a su contenido; el padre conserva el clip-path de crop. Así no se pisan entre sí, ni con transform/motion. Sin máscara no se añade wrapper para conservar HTML legacy. El runtime puede envolver el contenido al aplicar una máscara a un clip antiguo y conserva el wrapper con clip-path none al quitarla. El render inicial y final comparten la misma función de forma y renderer.

El campo se omite por defecto: no reescribe documentos legacy. Reset elimina máscara junto con crop; duplicar/dividir conserva el campo por copia del clip. Una máscara mantiene su forma relativa al redimensionar. El círculo se inscribe en la dimensión menor; la elipse ocupa toda la caja. Crop y máscara se calculan en la caja original, como intersección, sin reencuadrar el archivo.

El comando temporal `courseforge-composition-preview-mask` usa un schema cerrado, hfId y mask, con reset opcional para retirar la superposición y restaurar el estado canónico. El runtime conserva el gesto posterior ante patches previos, incluidos reemplazos de escena. El atributo data-visual-mask contiene sólo datos de forma validados y permite recuperar la base al cerrar/bloquear. Los presets capturan y aplican el campo opcional; presets antiguos conservan su comportamiento sin máscara.

# Reversión
Quitar máscaras mediante clip.mask null antes de volver a lectores incompatibles; no eliminar datos ni alterar hashes históricos. Mantener lector compatible mientras exista historial con máscaras.
