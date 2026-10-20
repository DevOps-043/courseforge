# Preparación local de originales HTML grandes

Admitir originales HTML de hasta 100 MB, incluidos exports de 21,7 MB, sin enviar el archivo íntegro a la función HTTP. Netlify limita los payloads síncronos a 6 MB; se conserva el transporte acotado existente.

Leer por bloques en un Web Worker, retirar scripts, comentarios y recursos que el perfil ya excluye, y reducir URLs CSS antes de enviar una fuente compacta al saneamiento autoritativo del servidor. Mostrar progreso, cancelación y resumen de reducción. No se incorpora conservación de imágenes ni del original remoto.

No se amplían indiscriminadamente los límites de complejidad/editor. Se prueba admisión a 21,7/50/100 MB, frontera excesiva, reducción de recursos y regresión de UI; se documenta que 100 MB de entrada no garantizan compatibilidad de cualquier diseño.
