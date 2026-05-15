# CourseEngine -> SofLIA Dialogue: contrato de generacion

Este documento define que debe generar CourseEngine para que SofLIA Learning ejecute actividades conversacionales con el runtime `SOFLIA_DIALOGUE`.

## 1. Objetivo

CourseEngine no debe generar un guion rigido de escenas con respuestas esperadas. Debe generar una configuracion evaluable: objetivo, escenario, criterios, evidencias, pistas, rescate y rubrica.

SofLIA Learning conserva la autoridad de ejecucion:

- El tutor conversa con el usuario.
- El evaluador LLM evalua evidencia semantica.
- El policy engine decide si continua, reta, da pista, rescata, aprueba o falla.
- El backend persiste sesiones, turnos, evaluaciones y resultados.

## 2. Estado actual de compatibilidad

Hasta que se actualice CourseEngine y/o el constraint de tipos de actividad, SofLIA Learning puede recibir la actividad con:

- `activity_type = 'ai_chat'`
- `activity_schema_version = 2`
- `activity_config.interactionType = 'soflia_dialogue'`
- `activity_config.runtimeType = 'SOFLIA_DIALOGUE'`

El renderer de aprendizaje debe elegir el runtime por `activity_config.interactionType`, no por `activity_type`.

## 3. Informacion minima que debe producir CourseEngine

Cada actividad conversacional debe incluir:

| Campo | Proposito | Reglas |
| --- | --- | --- |
| `visibleGoal` | Objetivo visible para el usuario | Claro, breve, sin revelar rubrica interna |
| `learningObjective` | Objetivo pedagogico interno | Competencia observable |
| `scenario` | Situacion base | Debe abrir espacio a razonamiento, no solo definiciones |
| `openingMessage` | Primera intervencion de SofLIA | Una pregunta inicial autentica, no saludo largo |
| `successCriteria` | Criterios de exito | IDs estables, 2 a 5 recomendados |
| `expectedEvidence` | Evidencia esperada | Senales que demuestran comprension real |
| `commonMistakes` | Errores frecuentes | Ayudan al evaluador a detectar falsa comprension |
| `hintLadder` | Pistas progresivas | De menor a mayor ayuda; no entregar respuesta completa al inicio |
| `challengePrompts` | Retos o contra-preguntas | Para respuestas parciales o demasiado faciles |
| `rescueContent` | Rescate interno | Resumen correcto para cerrar o redirigir si el usuario se bloquea |
| `rubric` | Dimensiones evaluables | Pesos sugeridos sumando 100 |
| `policy` | Limites de conversacion | Score minimo, max turnos, max pistas, retry |
| `tutor` | Estilo visible | Tono y maximo de frases |
| `evaluator` | Version/modelo opcional | No debe contener prompt completo de produccion |
| `analytics` | Eventos a registrar | Lista allowlisted de eventos |
| `versioning` | Trazabilidad | Version de material, rubrica y prompt |

## 4. Reglas de diseno para CourseEngine

CourseEngine debe generar actividades por evidencias, no por coincidencias exactas:

- Evitar respuestas canonicas que el usuario deba repetir palabra por palabra.
- No exigir terminos tecnicos si el usuario demuestra la idea con ejemplos correctos.
- Si un termino es indispensable, incluirlo como criterio y explicar por que es obligatorio.
- Diferenciar "menciona palabras clave" de "explica relacion causal".
- Incluir errores comunes para evitar que el evaluador apruebe respuestas vagas.
- Incluir al menos una pista para cada criterio requerido dificil.
- Incluir retos para respuestas correctas pero superficiales.
- Mantener `rescueContent` como contenido interno; no debe mostrarse completo salvo rescate.

## 5. Mapeo desde actividades legacy con `scenes`

El formato anterior puede migrarse asi:

| Legacy | Nuevo runtime |
| --- | --- |
| `activity_content.introduction` | Base para `visibleGoal` u `openingMessage` |
| Primera pregunta real de SofLIA | `openingMessage` |
| Preguntas siguientes de SofLIA | `challengePrompts` |
| Respuestas placeholder del usuario | No se migran como respuestas esperadas |
| `activity_content.conclusion` | Insumo parcial para `rescueContent` |
| Tema de la leccion | `learningObjective`, `scenario`, `expectedEvidence` |

## 6. Ejemplo: actualizar actividad de seguridad psicologica

Actividad objetivo:

- `activity_id`: `6f0a5e5e-5762-4c83-b55f-0774d5780114`
- Titulo: `Analizando la Seguridad Psicologica en Entornos Virtuales`
- Leccion: `0b5d0e39-4c92-4f5c-aa39-1f483727c0cd`

SQL recomendado:

```sql
update public.lesson_activities
set
  activity_schema_version = 2,
  requires_soflia_validation = false,
  activity_config = $$
  {
    "interactionType": "soflia_dialogue",
    "runtimeType": "SOFLIA_DIALOGUE",
    "schemaVersion": "1.0.0",
    "title": "Analizando la Seguridad Psicologica en Entornos Virtuales",
    "visibleGoal": "Explica por que la seguridad psicologica permite expresar ideas sin miedo en equipos remotos y justifica su impacto en colaboracion e innovacion.",
    "learningObjective": "El estudiante demuestra comprension causal de la seguridad psicologica en entornos virtuales, la conecta con expresion de ideas, colaboracion e innovacion, y propone una estrategia de liderazgo remoto.",
    "scenario": "Formas parte de un equipo remoto donde varias personas evitan opinar en reuniones y canales asincronos por miedo a equivocarse, ser juzgadas o generar conflicto.",
    "openingMessage": "En equipos remotos, la seguridad psicologica no es solo sentirse comodo. Explicame, con tus propias palabras, como se relaciona con la capacidad de expresar ideas sin miedo en un entorno virtual.",
    "studentRole": "Integrante o lider de un equipo remoto que necesita analizar dinamicas de comunicacion y colaboracion.",
    "sofliaRole": "Tutora exigente y clara. Debe pedir evidencia, ejemplos y relaciones causales sin revelar rubrica ni respuestas internas.",
    "successCriteria": [
      {
        "id": "relacion_seguridad_expresion",
        "label": "Relaciona seguridad psicologica con expresion sin miedo",
        "description": "Explica que las personas participan mas cuando perciben que pueden hablar, preguntar o discrepar sin castigo, burla o represalia.",
        "required": true
      },
      {
        "id": "virtualidad_riesgos",
        "label": "Justifica por que el entorno virtual aumenta riesgos de cautela",
        "description": "Reconoce que la falta de senales no verbales, la asincronia y la permanencia escrita de los mensajes pueden aumentar malentendidos o autocensura.",
        "required": true
      },
      {
        "id": "impacto_colaboracion_innovacion",
        "label": "Conecta seguridad psicologica con colaboracion e innovacion",
        "description": "Da un ejemplo donde su ausencia frena ideas, feedback o aprendizaje, y su presencia mejora colaboracion o propuestas nuevas.",
        "required": true
      },
      {
        "id": "estrategia_liderazgo",
        "label": "Propone una estrategia concreta de liderazgo remoto",
        "description": "Elige una accion accionable y explica por que tendria impacto sostenido frente a otras opciones.",
        "required": true
      }
    ],
    "expectedEvidence": [
      "Describe consecuencias de hablar sin seguridad: silencio, autocensura, baja retroalimentacion o miedo a errores.",
      "Explica que en lo virtual los mensajes pueden malinterpretarse o sentirse mas expuestos.",
      "Incluye un ejemplo concreto de reunion, chat, email, retroalimentacion asincrona o decision de equipo.",
      "Propone una practica como acuerdos de comunicacion, modelar vulnerabilidad, pedir disenso explicito, responder sin castigo o rituales de retroalimentacion."
    ],
    "commonMistakes": [
      "Reducir seguridad psicologica a ser amable o evitar conflictos.",
      "Decir solamente que la gente habla mas sin explicar causa o impacto.",
      "Asumir que en remoto las personas simplemente se adaptan sin costos.",
      "Proponer una estrategia generica como comunicarse mejor sin explicar como se aplicaria."
    ],
    "hintLadder": [
      {
        "id": "hint_expresion",
        "level": 1,
        "targetCriterionId": "relacion_seguridad_expresion",
        "content": "Piensa en que cambia cuando una persona sabe que puede equivocarse o discrepar sin ser ridiculizada."
      },
      {
        "id": "hint_virtualidad",
        "level": 2,
        "targetCriterionId": "virtualidad_riesgos",
        "content": "En remoto, considera tono escrito, silencios, camara apagada, asincronia y mensajes que quedan registrados."
      },
      {
        "id": "hint_impacto",
        "level": 3,
        "targetCriterionId": "impacto_colaboracion_innovacion",
        "content": "Usa un ejemplo donde alguien no comparte una idea o error, y contrasta que pasaria si el equipo reaccionara con apertura."
      },
      {
        "id": "hint_estrategia",
        "level": 4,
        "targetCriterionId": "estrategia_liderazgo",
        "content": "Elige una practica de liderazgo que cambie conductas repetidas, no solo un mensaje motivacional."
      }
    ],
    "challengePrompts": [
      "Dices que ayuda a expresarse. Por que eso no se resolveria simplemente pidiendo a todos que participen mas?",
      "Como cambia tu argumento cuando la comunicacion es asincrona y no hay senales no verbales?",
      "Dame un ejemplo donde la falta de seguridad psicologica frene innovacion, no solo comodidad.",
      "Por que tu estrategia tendria mas impacto a largo plazo que solo hacer mas reuniones?"
    ],
    "contextAdaptation": {
      "enabled": true,
      "instructions": "Puedes adaptar ejemplos al rol, industria o contexto laboral del estudiante, sin cambiar los criterios de evaluacion.",
      "focus": ["role", "industry", "mission"]
    },
    "rescueContent": "La seguridad psicologica permite que las personas expresen dudas, errores, desacuerdos e ideas sin miedo a castigo o burla. En entornos virtuales es critica porque la falta de senales no verbales, la asincronia y la permanencia de los mensajes pueden aumentar malentendidos y autocensura. Cuando falta, el equipo oculta problemas y reduce colaboracion e innovacion; cuando existe, aparecen feedback temprano, aprendizaje y mejores decisiones. Una estrategia fuerte de liderazgo remoto es modelar apertura, pedir disenso de forma explicita, responder sin castigar los errores y establecer acuerdos claros de comunicacion.",
    "rubric": [
      {
        "id": "causalidad",
        "label": "Comprension causal",
        "description": "Explica relaciones causa-efecto entre seguridad psicologica, expresion de ideas y conducta del equipo.",
        "weight": 30
      },
      {
        "id": "contexto_virtual",
        "label": "Aplicacion al entorno virtual",
        "description": "Integra riesgos propios de comunicacion remota o asincrona.",
        "weight": 20
      },
      {
        "id": "ejemplo_aplicado",
        "label": "Ejemplo aplicado",
        "description": "Presenta un ejemplo concreto y relevante, no una generalidad.",
        "weight": 25
      },
      {
        "id": "juicio_estrategico",
        "label": "Juicio estrategico",
        "description": "Propone y justifica una estrategia de liderazgo con impacto sostenible.",
        "weight": 25
      }
    ],
    "policy": {
      "approvalMinimum": 78,
      "maxTurns": 8,
      "maxHints": 3,
      "rescueAfterLowEvidenceTurns": 2,
      "allowRetry": true
    },
    "tutor": {
      "tone": "direct_supportive",
      "maxResponseSentences": 4
    },
    "evaluator": {
      "promptVersion": "DIALOGUE_EVALUATOR_RUNTIME@1.0.0"
    },
    "analytics": {
      "trackEvents": [
        "dialogue_started",
        "user_turn_submitted",
        "evaluation_completed",
        "criterion_met",
        "hint_given",
        "challenge_given",
        "rescue_triggered",
        "dialogue_completed",
        "dialogue_failed",
        "retry_started",
        "injection_detected"
      ]
    },
    "versioning": {
      "materialVersion": "course-engine-com-asertiva@2026-05-02",
      "rubricVersion": "seguridad-psicologica-remota@1.0.0",
      "promptVersion": "SOFLIA_DIALOGUE_TUTOR@1.0.0"
    }
  }
  $$::jsonb
where activity_id = '6f0a5e5e-5762-4c83-b55f-0774d5780114';
```

Consulta de verificacion:

```sql
select
  activity_id,
  activity_title,
  activity_type,
  activity_schema_version,
  activity_config->>'interactionType' as interaction_type,
  activity_config->>'runtimeType' as runtime_type
from public.lesson_activities
where activity_id = '6f0a5e5e-5762-4c83-b55f-0774d5780114';
```

Resultado esperado:

- `activity_type`: `ai_chat`
- `activity_schema_version`: `2`
- `interaction_type`: `soflia_dialogue`
- `runtime_type`: `SOFLIA_DIALOGUE`

## 7. Contrato JSON recomendado para CourseEngine

```json
{
  "interactionType": "soflia_dialogue",
  "runtimeType": "SOFLIA_DIALOGUE",
  "schemaVersion": "1.0.0",
  "title": "string",
  "visibleGoal": "string",
  "learningObjective": "string",
  "scenario": "string",
  "openingMessage": "string",
  "studentRole": "string",
  "sofliaRole": "string",
  "successCriteria": [
    {
      "id": "stable_snake_case_id",
      "label": "string",
      "description": "string",
      "required": true
    }
  ],
  "expectedEvidence": ["string"],
  "commonMistakes": ["string"],
  "hintLadder": [
    {
      "id": "stable_snake_case_id",
      "level": 1,
      "targetCriterionId": "stable_snake_case_id",
      "content": "string"
    }
  ],
  "challengePrompts": ["string"],
  "contextAdaptation": {
    "enabled": true,
    "instructions": "string",
    "focus": ["role", "industry", "mission"]
  },
  "rescueContent": "string",
  "rubric": [
    {
      "id": "stable_snake_case_id",
      "label": "string",
      "description": "string",
      "weight": 25
    }
  ],
  "policy": {
    "approvalMinimum": 75,
    "maxTurns": 8,
    "maxHints": 3,
    "rescueAfterLowEvidenceTurns": 2,
    "allowRetry": true
  },
  "tutor": {
    "tone": "direct_supportive",
    "maxResponseSentences": 4
  },
  "evaluator": {
    "promptVersion": "DIALOGUE_EVALUATOR_RUNTIME@1.0.0"
  },
  "analytics": {
    "trackEvents": [
      "dialogue_started",
      "user_turn_submitted",
      "evaluation_completed",
      "criterion_met",
      "hint_given",
      "challenge_given",
      "rescue_triggered",
      "dialogue_completed",
      "dialogue_failed",
      "retry_started",
      "injection_detected"
    ]
  },
  "versioning": {
    "materialVersion": "string",
    "rubricVersion": "string",
    "promptVersion": "string"
  }
}
```

## 8. Validaciones que CourseEngine deberia hacer antes de publicar

- `successCriteria.length >= 2` para actividades de analisis, aplicacion o evaluacion.
- Todos los criterios `required: true` deben tener evidencia esperada o pista asociada.
- Los IDs deben ser estables, sin acentos, sin espacios y sin depender del orden visual.
- La suma de pesos de `rubric` deberia ser 100.
- `openingMessage` no debe contener la respuesta ni la rubrica.
- `rescueContent` debe ser correcto, sintetico e interno.
- `challengePrompts` no deben contradecir los criterios de exito.
- `policy.approvalMinimum` debe estar entre 70 y 85 salvo evaluaciones muy estrictas.
- `maxTurns` recomendado: 6 a 10.
- `maxHints` recomendado: 2 a 4.

## 9. Recomendacion de generacion en CourseEngine

Pipeline sugerido:

1. Leer objetivo de leccion, nivel cognitivo, contenido fuente y contexto profesional.
2. Generar `learningObjective` como competencia observable.
3. Generar `visibleGoal` en lenguaje de usuario.
4. Crear `scenario` y `openingMessage`.
5. Definir 2 a 5 `successCriteria` con IDs estables.
6. Definir `expectedEvidence` y `commonMistakes`.
7. Crear `rubric` alineada a criterios y con pesos sumando 100.
8. Crear `hintLadder` progresivo.
9. Crear `challengePrompts` para respuestas parciales, vagas o demasiado complacientes.
10. Crear `rescueContent` interno.
11. Validar contra schema de SofLIA Learning antes de publicar.

## 10. Datos que CourseEngine debe conservar para trazabilidad

CourseEngine deberia poder reconstruir por que genero cada actividad:

- ID estable del curso, modulo, leccion y actividad.
- Version del contenido fuente.
- Version de rubrica.
- Version del prompt generador.
- Nivel Bloom o nivel cognitivo usado.
- Conceptos ancla.
- Errores comunes asumidos.
- Fecha de generacion.
- Modelo usado para generacion.

## 11. Pendientes antes de automatizar la generacion

- Definir si CourseEngine enviara `external_id` estable para actividades.
- Definir si SofLIA Learning migrara `activity_type` a un valor nativo `soflia_dialogue`.
- Definir donde se validara el schema: CourseEngine, endpoint de importacion o ambos.
- Definir estrategia de versionado cuando cambia la rubrica con usuarios que ya tienen intentos.
- Definir si habra actividades de practica que no afecten score final.
- Definir reglas por nivel cognitivo para `approvalMinimum`, `maxTurns` y cantidad de retos.

