export const artifactCreationHelp = {
  title: "Indica el tema o nombre inicial del curso o taller. Se utiliza también como título si preparas un borrador documental; no necesitas escribirlo de nuevo.",
  description: "Explica qué debe enseñar el curso, qué temas debe cubrir y qué límites debe respetar. Este contexto orienta la generación de la estructura pedagógica.",
  audience: "Describe a quién va dirigido y sus conocimientos previos. Ayuda a ajustar el lenguaje, los ejemplos y el nivel de profundidad.",
  results: "Expresa qué debería poder hacer el participante al terminar. Describe resultados observables, por ejemplo, elaborar una propuesta o resolver un caso.",
  courseId: "Identificador interno para reconocer el curso. Si lo dejas vacío, Architect genera uno. Es distinto del título y del aula de destino en Hub.",
  start: "Elige de dónde partirá el contenido. Esta elección es independiente de la modalidad asíncrona, síncrona o híbrida.",
  documents: "Crea un borrador con el título y modalidad del formulario para cargar y revisar documentos antes de iniciar IA. Luego continúa desde ese borrador para trabajar sobre el mismo curso.",
} as const;
export const artifactStartHelp = {
  ai: { label: "Crear con IA", description: "La generación parte del tema, descripción, público y resultados que escribas. Se inicia al pulsar Generar Estructura." },
  import: { label: "Importar SCORM", description: "Parte de un paquete ZIP SCORM 1.2 o 2004. Primero se analiza y revisa su contenido; después se procesa la importación con la modalidad elegida." },
} as const;
