# B-ROLL

Prompting para veo3
## 1. Prompt para Generar una Escena Desde Cero (Texto a Video)
Para obtener resultados consistentes, cinematográficos y de alta calidad con Google Veo (BO2 o BO3), es crucial seguir la Bestructura ideal, ya que el orden de los factores sí altera el producto. Veo tiende a dar más importancia a la parte inicial del prompt, por lo que los elementos clave deben ir primero.
Nota Importante: Los prompts deben ser escritos en inglés para que Veo capte mejor las indicaciones, aunque el diálogo de los personajes puede ser especificado en español.

Desde 0
Elemento de la Bestructura | Descripción (Ejemplo de Palabras Clave)
Tipo de Toma y Movimiento | Define la composición y el ángulo de la cámara.
Ejemplo: Extremely close shot (Toma extremadamente cercana), low-angle shot (Toma en ángulo bajo), tracking shot (Cámara sigue al sujeto), 35mm Film (Aspecto cinematográfico).

Sujeto y Acción | Identifica al personaje principal y lo que está haciendo. Es clave 
para la consistencia.
Ejemplo: A young woman with fair skin and blue eyes stands (Una mujer joven con piel clara y ojos azules está parada).

Detalles del Sujeto y Acción | Detalles específicos del sujeto (vestimenta, rasgos, expresión) y cómo realiza la acción.
Ejemplo: wearing a completely white racing pilot suit that resembles an astronaut (vistiendo un traje de piloto de carreras completamente blanco que se asemeja a un astronauta).

Descripción del Ambiente/Contexto | Define el escenario, la ubicación, la hora del día y las condiciones climáticas.
Ejemplo: in a snowy desert, looking at the camera (en un desierto nevando, mirando a la cámara).

Resultado Final y Visuales Clave | Indicaciones sobre el estado de ánimo (mood), iluminación, paleta de colores o el resultado de la escena.
Ejemplo: cinematic aspect, background is slightly blurred, visceral intensity, cold blue tones. (Aspecto cinematográfico, el fondo está ligeramente desenfocado, intensidad visceral, tonos azules fríos).

Secreto de Experto para Control y Consistencia:
Escriba Solamente lo que Está en el Frame. Para asegurarse de que Veo no omita indicaciones de composición (como un close 
up), solo debe describir los elementos que serán visibles en el cuadro. Si está en un primer plano de un rostro, omita la 
descripción de los pantalones o los zapatos para ahorrar palabras y usarlas en enriquecer el contexto.
## 2. Prompt para Generar con Elementos (3 Fotos)
Esta función se llama "Recursos a video" o "Ingredientes a video" dentro de Flow. Permite combinar diferentes imágenes 
(sujetos, objetos, escenarios) y generar una escena donde interactúan.
Limitación Crítica: Actualmente, el modo "Ingredientes a video" en Flow solo se puede utilizar con el modelo BO3.1 Fast (o en 
versiones anteriores, BO2 Quality). Si intenta usar BO3.1 Quality, se cambiará automáticamente a un modelo compatible.
El proceso es el siguiente:
1. Cambie el modo de entrada a "Ingredientes a video" (o "Recursos a video").
2. Suba sus 3 imágenes (ingredientes).
3. Introduzca un prompt que describa la acción e interacción entre los sujetos y el ambiente.



Estructura del Prompt para Ingredientes a Video (Simple y Directa):
Describa cómo los elementos subidos interactúan o la atmósfera del resultado

De ingredientes
Elemento | Descripción (Ejemplo de Prompt)
Interacción y Contexto | Describa la acción principal y el escenario.
Ejemplo 1: "The subjects are fighting in a futuristic arena, dynamic camera movement, vibrant neon lights." (Los sujetos están peleando en una arena futurista, movimiento de cámara dinámico, luces de neón vibrantes).
Ejemplo 2: "Combine these elements and put them in space. The scene communicates adventure and intrigue." (Combina estos elementos y ponlos en el espacio. La escena comunica aventura e intriga).

Estilo (Opcional) | Si busca un estilo visual específico que no está en las fotos, puede utilizar el "Style picker" de Flow.
Ejemplo: Studio Ghibli style, cinematic, hyperrealistic. (EstiloGhibli, cinemático, hiperrealista).

Recomendación: Los resultados de "Recursos a video" pueden ser inconsistentes. Si bien Veo es la mejor herramienta para 
mantener la consistencia de personajes, esta función puede requerir varios intentos para lograr una generación profesional.
## 3. Prompt para Continuar y Extender Escenas
Para extender un clip de video existente y mantener la coherencia y la consistencia del personaje, debe utilizar el Generador 
de Escenas (Scene Builder) dentro de Google Flow.
Ventaja de Veo 3.1: La última actualización permite extender escenas con audio incluido, lo cual no era posible en modelos 
anteriores.
Pasos en Flow:
1. Seleccione el clip que desea extender.
2. Haga clic en "Añadir a la escena" para llevarlo al constructor de escenas.
3. Una vez en la línea de tiempo, haga clic en el signo "+" al lado del clip y seleccione la opción "Ampliar" (Extend).

Estructura del Prompt para Extensión (Ampliar):
El prompt de extensión debe describir lo que sucede a continuación, asumiendo la consistencia de los personajes y el entorno ya establecido en la escena anterior.

Continuar
Tipo de Extensión | Descripción (Ejemplo de Prompt)
Continuación Simple | Describa la progresión de la acción o el sentimiento que debe prevalecer.
Ejemplo: "The scene communicates anticipation and quiet awe, the astronaut turns slightly to the right, looking out the window." (La escena comunica anticipación y asombro silencioso, el astronauta gira ligeramente a la derecha, mirando por la ventana).
Cambio de Acción/Contexto | Especifique una nueva actividad para el sujeto o un cambio en el movimiento de la cámara, sin alterar el sujeto.
Ejemplo: "Slow dolly zoom out, the figure walks away from the camera, leaving the metal flower behind." (Lento dolly zoom hacia atrás, la figura camina alejándose de la cámara, dejando la flor de metal atrás)

El modo "Fotograma a Video" (también llamado "Imagen a Video" o "Frames a Video") es fundamental para su proyecto de 
curso de IA, ya que es la mejor herramienta para generar consistencia y coherencia en sus personajes.
El uso de un fotograma de inicio (o una imagen de referencia) permite a Veo crear una incorporación latente de su personaje, 
fijando detalles visuales clave como rasgos faciales, colores y vestimenta. De esta manera, cuando genera el video, la IA 
aplica esa misma identificación codificada del personaje a la nueva escena.
Aquí está la estructura para utilizar este modo a través de Flow, incluyendo las nuevas capacidades de Veo 3.1:
Prompt para Generar Video a Partir de un Fotograma (Imagen a Video)
Este modo se utiliza para animar una imagen estática o crear una transición coherente entre una imagen de inicio y una imagen 
final.

A partir de fotos
Elemento | Propósito y Detalles Clave
Paso 1: Selección de Modo | Dentro de Flow, cambie el modo de entrada a "Fotogramas a video" (o "Imágenes a video").
Paso 2: Imagen de Referencia | Suba o genere la Imagen de Inicio (Frame de inicio). Es crucial que su personaje abarque una gran cantidad de la proporción en el frame en esta toma inicial para que sea más reconocible y consistente a lo largo del storyboard.
Paso 3: Fotograma Final (Opcional) | Puede seleccionar una imagen final diferente para crear una transición entre las dos. (Nota: La capacidad de usar fotogramas de inicio y final con Google Veo 
3.1 y audio incluido es una de las mejoras más recientes).
Paso 4: Movimiento de Cámara (Preset) | Seleccione un movimiento predeterminado de la cámara desde los ajustes disponibles: acercar, alejar, bajar cámara, desplazar a la derecha, etc.. Estos presets funcionan muy bien con la mayoría de las escenas.
Paso 5: Prompt de Texto (Acción y Emoción) | Introduzca un prompt textual para indicarle a la IA qué movimiento, acción o atmósfera desea comunicar en la escena.


Estructura del Prompt de Texto (Paso 5)
Dado que la consistencia del personaje ya está fijada por la imagen inicial, el prompt se centra en la acción, el movimiento y el 
tono:
•
•
•
Enfoque en la acción: Ejemplo: "La escena comunica paz e intriga.".
Enfoque en la emoción/tonalidad: Ejemplo: "La escena comunica acción y velocidad.".
Enfoque en la transformación: Ejemplo: "La escena comunica transformación." (Especialmente útil si utiliza un frame inicial 
y un frame final distintos).
Secretos de Experto para el Modo Fotograma a Video
1.Asegure la Adherencia (Hack del 90%): El índice de efectividad de esta herramienta suele ser complejo (alrededor del 33%). Para incrementar el índice de efectividad hasta un 90%, el truco es introducir exactamente el mismo prompt en la 
sección de la escena y en la sección del movimiento del prompt.
2.Generación de Audio con BO3.1: Al utilizar un único fotograma de inicio con el motor BO3.1, los resultados se generarán automáticamente con audio incluido.
3.Previsualización Rápida: Antes de generar un video completo (que consume créditos y tiempo), puede utilizar el modo "Fotogramas a video" para generar primero la imagen con el prompt que usará. La imagen resultante será muy similar al video, pero se genera en 4 a 5 segundos, a diferencia de los 3 a 5 minutos que tarda el video. Esto le permite corregir errores en su prompt de manera eficiente y ahorrar créditos.
4.Uso Recomendado: Aunque el motor Texto a Video ofrece un mayor control sobre movimientos y efectos complejos, el motor Fotogramas a video es el ideal para generar la consistencia y coherencia de sus personajes, incluso al transicionar entre diferentes fondos