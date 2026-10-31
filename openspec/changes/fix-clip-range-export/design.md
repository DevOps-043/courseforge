# Diseño

El documento versionado conserva autoridad sobre inicio, duración y offset. El formulario expresa segundos relativos al clip y el controlador traduce a tiempos absolutos para `clip.remove-range`. Tras guardar, la selección se resuelve contra los clips realmente persistidos.

La exportación usa Mediabunny ya instalado: descarga acotada del recurso autorizado, recodificación del intervalo exacto y descarga local. Nunca se descarga el archivo fuente como sustituto del recorte. Se rechazan fuentes no multimedia, velocidad/congelación y bucles; los efectos de composición se mantienen en la salida de ensamble. Un corte central conserva dos instancias independientes; se descarga solo la seleccionada.

Límites: fuente y salida de 256 MiB, tramo de hasta diez minutos, cancelación al desmontar y explícita. Los fallos de códec no pueden descartar silenciosamente audio o video.
