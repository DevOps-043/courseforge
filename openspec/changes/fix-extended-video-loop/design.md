# Diseño

El documento conserva duración, offset e identidad fuente. El compilador ya emite `loop` y resuelve la posición fuente con módulo; el defecto está en la recuperación del transporte del preview.

Durante reproducción estable se utiliza la menor distancia alrededor del ciclo. Las búsquedas explícitas y la entrada al clip siguen usando distancia lineal.

Al entrar en buffering se conserva la intención de reproducción. El precalentamiento no reposiciona medios activos con esa intención, aunque su reloj esté temporalmente detenido. Al recuperar datos, `seek` y el arranque del reloj usan tolerancia normal: no fuerzan un nuevo seek al último frame mientras el decoder intenta iniciar el ciclo siguiente. El inicio explícito de reproducción conserva el seek forzado.

QA utiliza un MP4 local de dos segundos rojo/verde, servidor loopback con soporte Range, extensión en vivo a seis segundos y Chromium aislado. Verifica tiempos y píxeles en seis posiciones y progreso continuo hasta el tercer ciclo. No consume servicios ni material privado.

Reversión: revertir el cambio del controlador. No requiere transformar documentos guardados. Riesgo residual: el transporte compartido también sincroniza audio; se conservan las reglas de medios no cíclicos y debe validarse en la lección real antes del despliegue.
