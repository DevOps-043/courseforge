# Capacidades actuales del sistema de edición

**Corte revisado:** commit `702e7d3` del 25 de septiembre de 2026  
**Alcance:** estado confirmado del repositorio en ese commit. Los cambios locales posteriores fueron excluidos.  
**Objetivo:** explicar, sin detalles de implementación, qué puede hacer hoy el editor y qué todavía no debe presentarse como completamente certificado.

---

## 1. Entendimiento del objetivo

Se necesita un inventario confiable de las funciones que el sistema de edición ya puede realizar correctamente, tomando como única referencia el último commit confirmado y sin mezclar avances que todavía están en la rama de trabajo.

Para evitar una promesa engañosa, en este documento **“confirmado”** significa que la función:

- está disponible en el flujo visible del editor;
- tiene reglas claras para evitar estados inválidos;
- conserva los cambios al guardarlos;
- cuenta con validaciones automatizadas aprobadas en la copia limpia del commit.

Esto no equivale a afirmar que todo el recorrido en producción está garantizado al 100%: la carga real de archivos, los servicios externos y la exportación remota todavía requieren una prueba integrada en el ambiente desplegado.

---

## 2. Diagnóstico funcional

### Resultado general

El editor ya es capaz de construir y modificar composiciones multimedia completas. Su núcleo de edición —línea de tiempo, capas, recortes, texto, subtítulos, animaciones, transiciones, audio, versiones y preparación de salida— está bien cubierto por validaciones automatizadas.

El último commit aporta una garantía puntual adicional: **cuando un proyecto utiliza inserción manual, una actualización de la biblioteca ya no cambia la posición, el inicio ni la duración que el usuario eligió**, incluso si el archivo proviene de un flujo histórico.

### Límite de la afirmación “al 100%”

No es responsable certificar el sistema completo al 100% solo con el repositorio. El propio estado entregado marca como pendiente la prueba integrada con almacenamiento real y render remoto. Por eso, el inventario siguiente distingue entre:

- **Capacidades confirmadas del editor:** comportamiento interno consistente y validado.
- **Capacidades disponibles pero condicionadas:** existen, pero dependen de servicios o pruebas externas pendientes.

---

## 3. Plan de revisión aplicado

La revisión se realizó sobre una copia limpia del último commit y contempló:

1. Recorrido de las opciones visibles del editor.
2. Revisión de las reglas que protegen los cambios del usuario.
3. Comprobación del guardado, restauración y preparación de salida.
4. Ejecución de 60 archivos de pruebas del editor, composición y exportación.
5. Separación explícita de las funciones que dependen de almacenamiento, procesamiento o render externo.

---

## 4. Capacidades confirmadas

## A. Organización de proyectos y formatos de lienzo

El editor puede:

- Trabajar con composiciones de cursos y con proyectos multimedia independientes.
- Empezar un proyecto independiente con la línea de tiempo vacía y permitir que el usuario decida qué archivos insertar.
- Cambiar el formato del lienzo entre:
  - horizontal 16:9;
  - vertical 9:16;
  - cuadrado 1:1.
- Conservar posiciones y animaciones al cambiar el formato.
- Mantener las proporciones originales de diapositivas HTML al trabajar en vertical.
- Permitir proyectos formados únicamente por imágenes o por audio, siempre que el usuario defina una duración válida.

**Detalle importante:** el cambio de formato no reencuadra automáticamente todo el contenido. Conserva el trabajo existente y deja el ajuste final al usuario, evitando movimientos inesperados.

## B. Biblioteca de medios e inserción manual

Dentro del editor, el usuario puede:

- Consultar los videos y medios disponibles para la lección o proyecto.
- Añadir manualmente un archivo a la línea de tiempo.
- Retirar un clip de la línea de tiempo sin borrar el archivo original de la biblioteca.
- Volver a insertar un archivo retirado.
- Mantener una composición vacía mientras continúa editando.
- Actualizar la biblioteca sin que aparezcan automáticamente archivos que el usuario no eligió.
- Conservar la posición, duración y tamaño de clips ya editados cuando se actualizan los archivos disponibles.
- Identificar qué medios ya están en la línea de tiempo.
- Elegir un video como introducción y retirarlo posteriormente.
- Seleccionar un cierre institucional cuando esté disponible.
- Recuperar medios históricos vinculados al proyecto.

## C. Edición completa de la línea de tiempo

El usuario puede:

- Mover clips a otro momento de la composición.
- Definir con precisión el inicio y la duración.
- Arrastrar los bordes para recortar el principio o el final.
- Dividir un clip en dos en la posición del cursor.
- Eliminar un intervalo del inicio, del centro o del final de un clip.
- Extender un video más allá de su duración original para reproducirlo en bucle.
- Reiniciar un archivo para recuperar su tiempo, tamaño y encuadre originales.
- Recalcular la duración total sin cambiar la posición de los clips.
- Organizar automáticamente la línea de tiempo.
- Acercar, alejar y desplazarse horizontalmente por la línea de tiempo.
- Mover el cursor cuadro por cuadro o en saltos más amplios.
- Activar alineación magnética para ajustar clips al cursor y a los límites de otros clips.
- Mostrar advertencias cuando una duración todavía es estimada.

Las operaciones evitan cortes inválidos, desbordes fuera de la duración del proyecto y solapamientos incompatibles.

## D. Selección múltiple y agrupaciones

El editor permite:

- Seleccionar varios clips con el modo de selección múltiple o con las teclas habituales del sistema.
- Crear una agrupación con varios elementos.
- Mover un grupo conservando las distancias internas entre sus elementos.
- Entrar al grupo para editar sus contenidos.
- Añadir o retirar miembros.
- Desagrupar sin alterar los clips.
- Conservar las agrupaciones al guardar, recargar o restaurar una versión.

Cuando un grupo deja de tener suficientes elementos, se disuelve de forma segura para evitar agrupaciones vacías o ambiguas.

## E. Capas y pistas

El usuario puede:

- Renombrar pistas.
- Mostrar u ocultar una pista completa.
- Bloquear una pista para evitar cambios accidentales y desbloquearla después.
- Silenciar pistas de audio.
- Ajustar el volumen general de cada pista.
- Cambiar la profundidad visual de un elemento.
- Enviar un elemento hacia atrás o traerlo hacia delante.
- Usar profundidades del 0 al 10.
- Superponer varios elementos; el editor crea filas visuales adicionales cuando es necesario.

Los elementos bloqueados no pueden modificarse hasta que el usuario los desbloquee.

## F. Posición, tamaño y apariencia visual

Para imágenes, videos, diapositivas y capas visuales, el usuario puede:

- Mover el elemento directamente en el monitor o mediante valores precisos.
- Cambiar ancho y alto.
- Mantener o liberar proporciones durante el redimensionamiento.
- Rotar el elemento.
- Ajustar su opacidad.
- Elegir entre mostrar el medio completo o llenar su caja.
- Recortar visualmente desde arriba, derecha, abajo o izquierda sin modificar el archivo original.
- Retirar el recorte y recuperar la vista completa.
- Ajustar brillo, contraste y saturación de manera no destructiva.
- Comparar el antes y el después de los ajustes visuales.
- Mostrar una rejilla de apoyo que no forma parte del video final.
- Ampliar el monitor y usarlo en pantalla completa.

Los cambios visuales están diseñados para coincidir entre la vista previa y la composición preparada para exportación.

## G. Texto y subtítulos

El editor puede:

- Crear capas de texto.
- Crear capas de subtítulos con fondo transparente.
- Editar el contenido y la posición del texto.
- Cambiar fuente, tamaño, peso y alineación.
- Elegir colores de texto y fondo.
- Ajustar por separado la opacidad de la capa, del texto y del fondo.
- Añadir contorno y sombra para mejorar la lectura.
- Utilizar fuentes incluidas y fuentes autorizadas de la organización.
- Importar subtítulos SRT y WebVTT.
- Rechazar archivos de subtítulos desordenados, superpuestos, demasiado grandes o fuera de la duración permitida.
- Generar subtítulos a partir de una voz que ya tenga palabras sincronizadas.
- Evitar sobrescribir una capa de subtítulos que el usuario haya editado manualmente.
- Aplicar estilos prediseñados de subtítulos sin reemplazar la fuente elegida.
- Mostrar resaltado palabra por palabra cuando existen tiempos detallados.

## H. Animaciones

El usuario puede aplicar animaciones de entrada, durante la reproducción y de salida.

Animaciones disponibles:

- Aparecer y desvanecer.
- Entrar o salir desde cualquiera de los cuatro lados.
- Zoom de entrada y de salida.
- Pop.
- Pulso.
- Flotar.
- Balanceo.
- Respirar.
- Desaparecer temporalmente.
- Desvanecerse y reaparecer.

También puede:

- Ajustar duración y momento de inicio.
- Cambiar intensidad.
- Configurar cadencia o número de ciclos cuando corresponda.
- Mover y redimensionar la banda de animación en la línea de tiempo.
- Editar puntos avanzados de una animación.
- Retirar una animación.

El editor evita que dos animaciones intenten controlar de forma incompatible la misma propiedad al mismo tiempo.

## I. Transiciones entre clips

El editor puede añadir y editar estas transiciones:

- Disolvencia.
- Fundido a un color elegido.
- Empuje.
- Barrido suave.
- Disolvencia con desenfoque.

Para cada transición, el usuario puede controlar:

- el punto de unión entre clips;
- la duración;
- la suavidad del movimiento;
- la dirección cuando corresponde;
- la alineación respecto al corte;
- corte de audio o mezcla gradual entre ambos audios.

La mezcla gradual solo se habilita cuando ambos videos confirman que tienen audio. Si un clip cambia o desaparece, el editor limpia o rechaza transiciones que dejarían de ser válidas.

## J. Audio dentro de la composición

El editor puede:

- Ajustar el volumen de una pista completa.
- Ajustar el volumen de un clip individual con audio confirmado.
- Silenciar o reactivar audio.
- Crear entrada y salida gradual de audio.
- Ajustar la duración y el volumen base de la música.
- Reducir automáticamente la música cuando hay voz y recuperar su volumen al terminar la narración.
- Desactivar esa reducción automática sin alterar el volumen base.
- Mantener sincronizados un avatar y su voz cuando ambos están vinculados.
- Buscar efectos de sonido por nombre o categoría.
- Escuchar, descargar y añadir un efecto en la posición del cursor.

## K. Guion, escenas y preensamble

Cuando el proyecto contiene guion y diapositivas, el editor puede:

- Mostrar las escenas y sus intervalos.
- Navegar a una palabra, escena o elemento visual concreto.
- Mostrar qué visuales corresponden a cada parte del guion.
- Advertir cuando una escena no tiene apoyo visual.
- Asociar diapositivas a escenas.
- Preparar automáticamente una primera distribución basada en la duración real de la narración.
- Evitar aplicar el preensamble mientras existan escenas que requieren revisión.

## L. Presets reutilizables

El editor incluye patrones de composición como:

- Presentador con diapositivas.
- Presentador protagonista.
- Historia visual.

Además permite:

- Ver una simulación antes de aplicar un preset.
- Aplicarlo sin sustituir los archivos originales.
- Deshacer el último preset cuando el documento no ha cambiado después.
- Crear un preset a partir de una composición manual.
- Crear un preset mediante una instrucción para SofLIA.
- Guardar presets con nombre y descripción para reutilizarlos.

## M. Asistencia de edición con SofLIA

El flujo de asistencia puede:

- Recibir una instrucción escrita sobre el cambio deseado.
- Preparar una propuesta sin guardarla automáticamente.
- Mostrar qué elementos cambiarían.
- Clasificar el riesgo de la propuesta.
- Exigir confirmación antes de aplicar cambios.
- Permitir rechazar la propuesta.
- Deshacer la última edición asistida si no se han guardado cambios posteriores.
- Bloquear propuestas destructivas, vacías o incompatibles con la composición.

**Alcance real:** está confirmada la seguridad y aplicación de una propuesta válida. La disponibilidad y calidad de la respuesta de IA dependen del proveedor configurado.

## N. Guardado, historial y recuperación

El editor puede:

- Guardar cambios de forma ordenada para evitar que dos acciones se pisen.
- Detectar si otra sesión cambió el documento antes de guardar.
- Mantener un historial de versiones editables.
- Restaurar una versión anterior como una nueva versión, sin destruir el historial.
- Conservar grupos, transiciones, recortes, color y animaciones al guardar y restaurar.
- Crear versiones de salida separadas del documento de trabajo.
- Restaurar una versión de salida a la línea de tiempo.
- Recuperar el estado de una exportación que seguía en proceso después de recargar la página.
- Mantener disponible el video anterior mientras se procesa una nueva revisión.

## O. Preparación de salida

Antes de exportar, el editor puede:

- Crear una versión cerrada de la composición.
- Revisarla antes de aprobarla.
- Aprobarla para exportación.
- Elegir calidad de borrador, estándar o alta.
- Preparar salida MP4 en 1080p y 25 cuadros por segundo.
- Mostrar tamaño estimado, resolución, cuadros por segundo y calidad.
- Advertir cuando un video largo debería dividirse.
- Bloquear una salida estimada por encima del límite seguro.
- Reintentar una exportación fallida.
- Reemplazar un video anterior de forma controlada.
- Consultar diagnósticos y cancelar un proceso activo.
- Continuar al flujo de publicación cuando la salida está lista.

---

## 5. Riesgos y validaciones

### Validación realizada

- Se creó una copia limpia del commit para no utilizar ningún cambio local.
- La compilación de las pruebas del editor terminó sin errores.
- Se ejecutaron 60 archivos de pruebas relacionados con edición, composición y preparación de salida.
- Resultado final: **60 archivos aprobados y 0 archivos con fallos**.
- El conjunto contiene aproximadamente 416 comprobaciones individuales.

### Observación sobre las pruebas

Dos comprobaciones del asistente de IA necesitaron ejecutar la misma resolución interna de rutas que utiliza la aplicación. Con ese entorno correcto, ambas aprobaron. Esto no afecta a la función, pero conviene corregir el comando de pruebas para que cualquier integrante del equipo pueda obtener el mismo resultado sin preparación adicional.

### Funciones disponibles que todavía no deben venderse como “100% certificadas”

Las siguientes capacidades existen en el producto, pero requieren validación integrada en el ambiente real antes de darles garantía completa:

- Subir archivos contra el almacenamiento desplegado y reabrir el proyecto posteriormente.
- Cargar de extremo a extremo PNG, JPG, MP4, WebM, MP3, WAV y HTML en un proyecto real.
- Separar físicamente el audio de un video mediante el servicio de procesamiento.
- Procesar una voz, comparar el resultado y utilizarlo en una composición real.
- Generar un video remoto completo y recibirlo nuevamente en Courseforge.
- Confirmar un archivo final real de 1080 × 1920 para formato vertical.
- Reemplazar el video anterior y publicar a Soflia en un recorrido completo.
- Trabajar con alta concurrencia, cuotas reales y múltiples pestañas cargando archivos simultáneamente.

### Límites actuales que el usuario debe conocer

- No hay conversión automática de formatos o códecs no admitidos.
- No existe reencuadre automático al cambiar entre horizontal, vertical y cuadrado.
- La biblioteca permite retirar clips de la línea de tiempo, pero no borrar o archivar el archivo fuente desde esta nueva experiencia.
- Un HTML debe seguir el formato de diapositivas admitido; no se acepta una página web arbitraria ni JavaScript ejecutable.
- Los archivos tienen límites de tamaño y resolución; no se admite cualquier medio sin restricciones.
- El asistente de IA y la exportación dependen de servicios externos, credenciales y disponibilidad de red.
- No se realizó en esta revisión una inspección visual manual completa en navegador ni una escucha del MP4 final.

---

## 6. Mejoras adicionales recomendadas

### Obligatorias antes de declarar el recorrido completo como 100% listo

1. Ejecutar una prueba real con almacenamiento desplegado: cargar, cerrar, reabrir y volver a editar.
2. Exportar y revisar manualmente un video horizontal y uno vertical.
3. Confirmar audio, subtítulos, animaciones, transiciones y corrección de color en el MP4 final.
4. Probar reemplazo de video y publicación a Soflia de principio a fin.
5. Corregir el comando de pruebas para que las validaciones del asistente funcionen sin configuración manual.
6. Registrar evidencia de aceptación visual y auditiva con una lista de control reproducible.

### Deseables después

- Reencuadre asistido al cambiar formato.
- Eliminación o archivado seguro de archivos de la biblioteca.
- Conversión controlada de formatos adicionales.
- Cargas en segundo plano con cuotas y recuperación para proyectos grandes.
- Pruebas periódicas en navegador sobre los flujos principales del editor.

---

## Conclusión ejecutiva

El sistema ya ofrece un **editor multimedia sólido y funcional** para organizar medios, editar tiempos, transformar visuales, trabajar con texto y subtítulos, mezclar audio, aplicar animaciones y transiciones, administrar versiones y preparar una salida.

Lo que puede afirmarse con confianza es que **el núcleo de edición funciona correctamente dentro de las reglas verificadas del commit**. Lo que todavía no puede afirmarse responsablemente es que el recorrido completo —desde la carga real hasta el MP4 final publicado— esté certificado al 100%, porque esa aceptación integrada sigue pendiente.
