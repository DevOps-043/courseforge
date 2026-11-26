## Comparación y decisión

El flujo mixto busca una lección por solicitud y proporciona requisitos concretos.
Web agrupa dos lecciones, usa contexto de curso y dispone de rondas, fallback y
deduplicación de redirecciones. Se conserva el enfoque por lección del mixto y la
recuperación acotada de Web, evitando duplicar esas reglas entre políticas.

La cuota sigue getLessonSourceRequirement: mínimo dos fuentes y una por cada
tres minutos objetivo de video, con máximo diez. Siete minutos requieren tres
fuentes; no es una configuración de tamaño de lote.

El motor recibe lecciones y fuentes existentes, busca pendientes y confirma cada
fuente válida mediante el adaptador antes de contarla. Las URLs candidatas y sus
destinos se excluyen durante la ejecución. Se conservan seis rondas, parada tras
dos sin avance, tres intentos y deadline global. Un fallo transitorio de una
lección permite procesar las demás. Credenciales/cuota/configuración inválidas
detienen la ejecución evitando multiplicar solicitudes inútiles.

La entrada común incorpora el contexto del curso (título, descripción, audiencia
y objetivos disponibles) desde el despachador, sin mezclar lecciones en una misma
solicitud. El adaptador histórico conserva su resolución de contexto cuando se
invoca directamente. El mixto mantiene su filtro de evidencia utilizable antes
del guardado para no contar URLs que su siguiente lectura descartaría.

Web mantiene commit_curation_progress; mixto mantiene
commit_course_source_curation_progress con revisión y currículo. Una cancelación
o sustitución impide guardado y finalización. DOCUMENTS_ONLY no llama al motor.
El cierre usa las reglas de aprobación existentes de cada política.

Los diagnósticos distinguen búsquedas fallidas, candidatos rechazados/duplicados,
agotamiento de tiempo y falta de avance. No registran respuestas ni fuentes
privadas. Los descartes se excluyen en memoria; no se introduce persistencia de
URLs rechazadas entre ejecuciones ni una nueva migración.
