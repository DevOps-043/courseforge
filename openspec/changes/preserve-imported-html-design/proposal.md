# Conservar el diseño HTML y sus campos de texto

La prioridad confirmada es conservar composición, imágenes y fuentes, con sustitución de texto, sin convertir todo al editor nativo. El perfil anterior eliminaba recursos y también el color de respaldo de un background con URL, dejando texto blanco invisible.

Agregar un perfil explícito html-text. Deduplicar imágenes/fuentes embebidas durante la preparación local; validar binarios y referencias en servidor; mantener los recursos una sola vez en el ZIP privado y solo sus manifiestos en BD. Hidratar recursos al revisar o generar una plantilla autorizada. Preview y generación comparten la misma materialización. Mantener el perfil nativo existente y sus validadores.

El archivo real no tiene keyframes ni animación de diapositivas; solo transición de color en navegación. No se ejecutan scripts importados ni se promete preservar animaciones arbitrarias. Se comunica explícitamente el carácter estático.
