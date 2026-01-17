export const implementationPlanPrompt = `PROMPT 1/3 — FASE 1: Plan instruccional (Temario / Depuración) - ADAPTADO PARA SISTEMA
Actúa como controlador instruccional para un curso de microlearning de IA.

Estás ejecutando la FASE 1 de 3 (Plan → Curaduría → Producción).

Tu misión en esta fase:

Transformar el temario en un plan estructurado de lecciones con:

Objetivos de aprendizaje (OA) claros (Bloom + criterio medible).
Tipos de contenido coherentes con Bloom.
Componentes obligatorios marcados.
Riesgos, lagunas y bloqueadores documentados.
0. Insumo
CURSO: \${courseName} IDEA CENTRAL: \${ideaCentral}

LECCIONES A PLANIFICAR (\${lessonCount} lecciones): \${lessonsText}

1. Reglas globales que debes respetar
   Formato estándar de salida
   IMPORTANTE: Responde SOLO con JSON válido.
   No uses Markdown, tablas o texto fuera del JSON.
   La estructura JSON debe ser exactamente la especificada en la sección 4.

Componentes obligatorios por lección
Toda lección debe contemplar SIEMPRE estos 3 componentes:

DIALOGUE (Diálogo con Lia)
READING (Lectura o Audio - Refuerzo)
QUIZ (Cuestionario final)

Además, debe contemplar AL MENOS 1 componente de video:

VIDEO_THEORETICAL (Recordar/Comprender o conceptual)
VIDEO_DEMO o VIDEO_GUIDE (>= Aplicar o procedimental)
DEMO_GUIDE queda como opcional/condicional.

Control de coherencia Bloom ↔ tipo de contenido

Máximo nivel Bloom del OA Combinación requerida (¡Priorizar Práctica!)
Recordar / Comprender DIALOGUE + READING + QUIZ + VIDEO_DEMO (Preferido si es práctico)
Aplicar DIALOGUE + READING + QUIZ + VIDEO_DEMO (Obligatorio) + EXERCISE (Recomendado)
Analizar DIALOGUE + READING + QUIZ + VIDEO_DEMO (Obligatorio) + EXERCISE (Recomendado)
Evaluar DIALOGUE + READING + QUIZ + VIDEO_GUIDE (Obligatorio) + EXERCISE
Crear DIALOGUE + READING + QUIZ + VIDEO_GUIDE (Obligatorio) + EXERCISE

Duraciones de referencia

Videos: 6–12 min
Diálogo: 5–9 min
Lectura: ~750 palabras
Quiz: 3–5 preguntas (feedback inmediato, corte 80 %)

Accesibilidad y tono

Español neutro, tono profesional y cercano.
Material subtitulable, sin depender de elementos visuales críticos.

Cero descargables obligatorios

No planifiques nada que requiera descargar o subir archivos.
Si detectas que una acción requeriría un archivo sin alternativa textual → marca la lección en el array blockers.

2. Tareas de la FASE 1
   Analiza el temario
   Interpreta cada Módulo, Lección y OA recibido.
   Identifica el nivel Bloom predominante por OA (Recordar, Comprender, Aplicar, Analizar, Evaluar, Crear). Si encuentras una palabra similar, clasifícala como su par correspondiente dentro de la matriz. Ej. Generar = Crear, Entender = Comprender, Redactar = Crear, etc. 

Genera el plan instruccional para cada lección

Para CADA lección recibida, genera un plan completo.
NO omitas ninguna lección.

Si el título o OA implica "Cómo", "Proceso", "Estrategia", "Técnica" y se usó SOLO VIDEO_THEORETICAL: Esto es un ERROR. Agrega un VIDEO_DEMO.

Detecta dependencias de archivos

Si implica "descargar/subir archivo", "dataset", ".zip", "repo": Agrega al array blockers.

Valida coherencia semántica

Verifica que cada OA tenga verbo Bloom explícito y criterio medible.

3. Definition of Done (FASE 1)
   Todos los OA tienen verbo Bloom explícito y criterio medible (quiz ≥80 % o rúbrica 3/4).
   DIALOGUE, READING y QUIZ están presentes en TODAS las lecciones.
   Cada lección incluye AL MENOS 1 componente de video (VIDEO_THEORETICAL / VIDEO_DEMO / VIDEO_GUIDE).
   La matriz Bloom ↔ contenido se cumple.
   No hay descargables obligatorios planificados.
   Todas las \${lessonCount} lecciones recibidas tienen un plan generado.
4. Formato de salida JSON (OBLIGATORIO)
   { "lesson_plans": [ { "lesson_id": "ID exacto de la lección recibida", "lesson_title": "Título exacto de la lección", "module_id": "ID del módulo de la lección", "module_title": "Título del módulo", "module_index": 0, "oa_text": "El participante será capaz de [verbo Bloom] [contenido específico] mediante [método/criterio]", "oa_bloom_verb": "Verbo principal (ej: Aplicar, Analizar, Crear)", "measurable_criteria": "Descripción de cómo se medirá el logro (ej: completar ejercicio con 80% aciertos, rúbrica 3/4)", "components": [ {"type": "DIALOGUE", "summary": "Descripción detallada del diálogo instructivo con Lia (5-9 min)"}, {"type": "READING", "summary": "Descripción del material de lectura (~750 palabras)"}, {"type": "QUIZ", "summary": "Descripción de la evaluación (3-5 preguntas, corte 80%)"}, {"type": "VIDEO_THEORETICAL", "summary": "Guion de video explicativo (mínimo 1 video por lección)"}, {"type": "EXERCISE", "summary": "Descripción del ejercicio práctico (si aplica según Bloom)"} ], "alignment_notes": "Notas sobre cómo el plan se alinea con el OA y por qué esta combinación de componentes es adecuada", "risks_gaps": "Lagunas, riesgos, prerequisitos débiles, OA poco realista, etc. (opcional, dejar vacío si no hay)", "production_notes": "Observaciones prácticas: complejidad, coordinación con herramientas, duración estimada total, etc. (opcional)" } ], "blockers": [ { "lesson_id": "ID de la lección con problema", "lesson_title": "Título de la lección", "reason": "Razón del bloqueo (ej: 'OA requiere práctica pero falta componente práctico', 'Requiere descarga obligatoria')", "details": "Detalles adicionales del problema" } ] }

REGLAS CRÍTICAS DEL JSON:

lesson_plans debe contener EXACTAMENTE \${lessonCount} elementos (una entrada por cada lección).
lesson_id debe coincidir EXACTAMENTE con el ID recibido en el input.
components debe incluir SIEMPRE: **DIALOGUE, READING, QUIZ**.
components debe incluir SIEMPRE: **DIALOGUE, READING, QUIZ**.
Además, debe incluir **AL MENOS 1 componente de video**, priorizando siempre la PRÁCTICA:

1. **VIDEO_DEMO** (Prioridad ALTA): Usar SIEMPRE que se explique un proceso, herramienta, técnica o estrategia.
2. **VIDEO_GUIDE** (Prioridad MÁXIMA): Usar SIEMPRE que el alumno deba crear, diseñar o construir algo.
3. **VIDEO_THEORETICAL** (Prioridad BAJA): Usar SOLO si es 100% conceptual/histórico y NO hay proceso práctico.

EJEMPLO: Si la lección es "Estrategia de Copywriting", NO uses Theoretical. Usa VIDEO_DEMO mostrando ejemplos de copy.

oa_text debe iniciar con un verbo Bloom de los ya definidos y tener mínimo 50 caracteres.
measurable_criteria debe ser específico y medible (mínimo 20 caracteres).
Si una lección tiene problemas, agrégalo a blockers en lugar de omitirla.
NO uses campos adicionales fuera de los especificados.
NO incluyas texto fuera del JSON (ni explicaciones, ni Markdown, ni tablas).
IMPORTANTE FINAL: Responde SOLO con el JSON, sin texto adicional, sin Markdown, sin explicaciones fuera del JSON.`;
