# Investigación: Flujo de Generación y Fugas de Información en Courseforge

## 1. Resumen Ejecutivo (Para todo el equipo)

Hemos analizado minuciosamente las 6 fases del motor de Courseforge revisando línea por línea el código fuente que opera "por detrás" (Background Jobs). Nuestro objetivo era entender cómo viajan los datos y descubrir por qué el sistema presenta "fugas de información", comportamientos inesperados, o mezcla de temas entre lecciones.

**Cómo funciona el flujo a grandes rasgos:**
La plataforma consta de una cadena de ensamblaje. Lo que produce la Fase 1 se convierte en la materia prima para la Fase 2, y así sucesivamente. Sin embargo, en cada fase, la IA no razona de manera continua, sino que se le "recuerda" de qué trata el curso inyectándole un documento consolidado llamado "Contexto".

**Hallazgos Críticos sobre las "Fugas de Información" y Fallos Frecuentes:**
1. **Google Search (El factor de la inestabilidad):** Las Fases 1 (Idea), 2 (Estructura) y 4 (Curación) tienen activado "Google Search" por defecto. Esto significa que la IA navega por internet en tiempo real para rellenar huecos. Esto es excelente para estar actualizados, pero es una espada de doble filo: La IA a veces ignora tus instrucciones y prefiere creerle a lo que encontró en el buscador, metiendo links rotos, metodologías obsoletas, o temas de los que tú nunca hablaste.
2. **Contexto Contaminado (El causante de que se mezclen temas):** En la Fase 3 (Plan Instruccional) y Fase 5 (Materiales), le pasamos a la IA un "Resumen del Curso" donde vienen TODOS los módulos y TODAS las lecciones de golpe. Al leer sobre la Lección 5 mientras escribe el contenido de la Lección 1, la IA "se contamina" y empieza a adelantar información o a mezclar explicaciones que no corresponden a ese momento del curso.
3. **El Juego del Teléfono Compuesto:** Cuando un modelo principal falla (por ejemplo, porque los servidores de Google y Gemini están ocupados), el sistema tiene un "Modelo de Respaldo" (`gemini-2.0-flash` en lugar del más avanzado `gemini-2.5-flash`). Si un paso crítico se genera con un modelo menos capaz bajo estrés de red, el texto resultante baja su calidad y este error viaja intacto hacia las siguientes fases arrastrando la bola de nieve.

**Recomendación de negocio:**
Las "fugas" no son un hackeo ni un error de bases de datos; son la consecuencia de darle demasiada libertad de búsqueda a la IA y de saturarla de texto innecesario en cada paso. Necesitamos restringir qué tanto le dejamos buscar libremente en internet y limitarnos a pasarle **únicamente** la información de la lección exacta que está escribiendo en cada fase.

---

## 2. Análisis Técnico Profundo (Code-Level)

A nivel técnico, la "fuga" en grandes LLMs (Data Leakage / Context Crosstalk) se da no por un escape de base de datos, sino por *inyecciones de prompt (Prompt Injections)* sobredimensionadas. Hemos rastreado la vida del dato a través de los archivos de Netlify Functions.

### Arquitectura Base y Modelos
- Todos los servicios usan la mutación `resolveModelSetting()` que consulta la tabla `model_settings`.
- Patrón Actual: Primary Model (`gemini-2.5-flash`) y Fallback (`gemini-2.0-flash`).
- **Degradación Silenciosa:** En los archivos de Background (como curación o Fase 1), si el modelo primario lanza un `Timeout` o `HTTP 503`, el código hace un `catch` e inicia silenciosamente el Fallback Model sin interrumpir el proceso. Si esto pasa, tus fases más complejas se estarán calculando con un modelo menos apto para seguir formato JSON rígido.

### Análisis Fase a Fase de los Vectores de Fuga

#### Fase 1: BASE (`generate-artifact-background.ts`)
- **Flujo:** Extrae `formData` (título y descripción). Llama a la herramienta Google Grounding: `[{ googleSearch: {} }]`.
- **Fuga de Deriva:** El Prompt le dice: *"Investiga tendencias educativas..."*. La IA trae todo el DOM contextual de la búsqueda web de Google y lo inyecta como texto plano a `researchContext`. El JSON final de Bloom y Objetivos es moldeado por artículos de la web actual, sobrescribiendo parte del control intencional del experto sobre de qué trata realmente el curso.

#### Fase 2: SYLLABUS (`syllabus-generation-background.ts`)
- **Flujo:** Toma la matriz anterior y vuelve a ejecutar un bloque de Grounding/Search `buildSyllabusResearchPrompt`.
- **Fuga de Tema:** Genera un loop máximo de 3 intentos `validateGeneratedContent`. Si el modelo se estresa fallando en el formato, el System Prompt repite y acumula los errores. Al intentar corregir "Asegúrate de no dar más de 6 módulos", alucina lecciones completamente inconexas o se roba temarios importados desde la red para "cubrir" con la longitud solicitada en lugar de construir con base en el objetivo de la Fase 1.

#### Fase 3: INSTRUCTIONAL PLAN (`instructional-plan-background.ts`)
- **Flujo:** Itera sobre todos los módulos del syllabus. Emplea un inyector gigante de Prompt: `INSTRUCTIONAL_PLAN_SYSTEM_PROMPT`.
- **Fuga (Contaminación de Vector Cruzado):** El archivo utiliza una función `renderLessonsText(lessons)` que formatea e inyecta literal **absolutamente todos** los Objetivos de Aprendizaje de todo el curso dentro de la variable `${lessonsText}`.
- **Consecuencia:** Cuando la IA procesa el componente *DIALOGUE* para la Lección 1.1, ya leyó el contenido de la 4.5 e, inadvertidamente, adelanta terminología avanzada en la lección inicial (fuga hacia adelante). 

#### Fase 4: CURACIÓN (`unified-curation-logic.ts` & `curation-runtime.ts`)
- **Flujo:** Escupe búsquedas precisas y entra URL por URL.
- **Fuga de Extracción de HTML (Falsos Positivos):** En la función `validateUrlWithContent`, la aplicación remueve las etiquetas regex `/<[^>]*>/g` sobre TODO el Body. Si una página del gobierno lanza un "Soft 404" e imprime un menú superior y un pie de página gigantes, el regex detecta más de `500 caracteres` de texto y evade exitosamente el filtro de `soft404Patterns`. Se aprueba un link basura que inevitablemente fallará en la vista del Front-End o arrojará 404 en el futuro cercano, confundiendo al motor de la Fase 5 al tratar de nutrirse con eso.

#### Fase 5: MATERIALES (`materials-generation-background.ts`)
- **Flujo:** Iterador Batch con delay para evadir Rate Limits. Emplea `loadMaterialsGenerationContext`.
- **Fuga Contextual Masiva:** Nuevamente inyecta un texto monstruoso. El sistema de Gemini maneja Context Windows de más de 1M de tokens, lo que es genial para la memoria RAM temporal, pero terrible para el enfoque (*Attention Span*). Cualquier "basura" curada inadvertidamente del punto anterior, es utilizada aquí para generar HTMLs, Quizzes y Scripts, lo que concluye en el peor "Teléfono compuesto" donde el material del módulo final puede estar altamente deformado o tener pedazos sin sentido de otras dependencias cruzadas.

### 🛑 Propuesta de Mitigación Inmediata (Action Items Opcionales):
1. **Sandboxing de Prompts (Aislamiento):** En Fase 3 (`instructional-plan-background.ts`) y Fase 5, modificar el código para no pasar TODAS las lecciones. Sustituir `${lessonsText}` por un arreglo de contexto deslizante estricto: *"Qué aprendió en la lección previa, Qué enseña ésta lección, Qué NO debe enseñar porque es de la siguiente"*.
2. **Hardening Curador:** Cambiar la limpieza Regex actual (`text.replace(/<[^>]*>/g, ' ')`) por un extractor más inteligente tipo `cheerio` que analice únicamente etiquetas `<article>`, o `<main>`, lo que destruye el Falso Positivo de los "Soft 404" llenos de menús (lo que vimos en el dominio de gob.mx).
3. **Interruptor de Red:** Poner banderas (`enableWebSearch: boolean`) que apaguen obligatoriamente el uso de `googleSearch` en la Fase 2, dejando que la inteligencia deduzca la estructura únicamente desde la Fase 1.
