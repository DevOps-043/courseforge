# Course Engine -> SofLIA Learning: contrato para actividades `SOFLIA_DIALOGUE`

## Objetivo

Course Engine debe generar actividades conversacionales evaluables para que SofLIA Learning ejecute el nuevo runtime `SOFLIA_DIALOGUE`.

El punto critico es este:

- `activity_content` no debe ser la fuente de verdad del runtime.
- `activity_config` si debe contener el JSON completo del contrato `SOFLIA_DIALOGUE`.
- `activity_schema_version` debe ser `2`.
- `activity_type` puede mantenerse como `ai_chat` por compatibilidad.

Si el JSON del runtime queda dentro de `activity_content` y `activity_config` queda `null`, SofLIA Learning puede interpretar la actividad como `ai_chat` legacy y el boton de inicio no abrira el runtime nuevo.

## Registro esperado en SofLIA Learning

```sql
activity_type = 'ai_chat'
activity_schema_version = 2
activity_config->>'interactionType' = 'soflia_dialogue'
activity_config->>'runtimeType' = 'SOFLIA_DIALOGUE'
requires_soflia_validation = false
external_tool_key = null
```

`requires_soflia_validation` debe ir en `false` porque el runtime de dialogo ya evalua con su propio evaluador, policy engine y persistencia de resultados. No debe mezclarse con la validacion estructurada de actividades externas o texto largo.

## Forma correcta de enviar la actividad

```json
{
  "title": "Seguridad Psicologica en Equipos Remotos",
  "type": "lia_script",
  "data": {
    "introduction": "Actividad conversacional sobre seguridad psicologica en equipos remotos."
  },
  "activity_schema_version": 2,
  "activity_config": {
    "interactionType": "soflia_dialogue",
    "runtimeType": "SOFLIA_DIALOGUE",
    "schemaVersion": "1.0.0",
    "title": "Seguridad Psicologica en Equipos Remotos",
    "visibleGoal": "Analizar como la seguridad psicologica fomenta la innovacion y la colaboracion en equipos remotos.",
    "learningObjective": "El participante identifica desafios de construir confianza en un entorno virtual y propone soluciones concretas para fomentar seguridad psicologica.",
    "scenario": "Eres el nuevo lider de un equipo remoto que muestra reticencia a compartir ideas en reuniones virtuales. La innovacion se ha estancado y la colaboracion es minima.",
    "openingMessage": "Tu equipo remoto evita compartir ideas en reuniones virtuales. Que desafios concretos crees que estan afectando la seguridad psicologica?",
    "studentRole": "Lider de equipo remoto",
    "sofliaRole": "Tutora exigente y clara. Debe pedir evidencia, ejemplos y relaciones causales sin revelar rubrica ni respuestas internas.",
    "successCriteria": [
      {
        "id": "identifies_challenges",
        "label": "Identifica desafios de confianza virtual",
        "description": "Menciona al menos dos desafios especificos de la comunicacion virtual, como falta de senales no verbales, malentendidos escritos, asincronia o exposicion publica.",
        "required": true
      },
      {
        "id": "proposes_solutions",
        "label": "Propone soluciones concretas",
        "description": "Sugiere al menos dos acciones aplicables para promover confianza, apertura y participacion en el equipo remoto.",
        "required": true
      }
    ],
    "expectedEvidence": [
      "Menciona desafios especificos de la comunicacion virtual.",
      "Explica como esos desafios afectan colaboracion, confianza o innovacion.",
      "Propone acciones concretas como normas de comunicacion, escucha activa, turnos de participacion, reconocimiento o acuerdos de feedback."
    ],
    "commonMistakes": [
      "Reducir la seguridad psicologica a ser amable.",
      "Proponer comunicarse mejor sin explicar acciones observables.",
      "Ignorar riesgos propios del trabajo remoto.",
      "No conectar seguridad psicologica con innovacion o colaboracion."
    ],
    "hintLadder": [
      {
        "id": "hint_challenges_1",
        "level": 1,
        "content": "Piensa en que se pierde cuando el equipo no comparte espacio fisico: tono, gestos, silencios, contexto y confianza inmediata.",
        "targetCriterionId": "identifies_challenges"
      },
      {
        "id": "hint_solutions_1",
        "level": 2,
        "content": "Elige una accion concreta que puedas aplicar en reuniones o canales escritos para que mas personas participen sin miedo.",
        "targetCriterionId": "proposes_solutions"
      }
    ],
    "challengePrompts": [
      "Como distinguirias entre baja participacion por falta de interes y baja participacion por falta de seguridad psicologica?",
      "Que accion concreta tomarias si una persona interrumpe constantemente a otras en videollamadas?",
      "Como medirias si tus soluciones estan aumentando la participacion real del equipo?"
    ],
    "contextAdaptation": {
      "enabled": true,
      "instructions": "Adapta ejemplos al rol, industria o mision del usuario sin cambiar criterios de evaluacion.",
      "focus": ["role", "industry", "mission"]
    },
    "rescueContent": "La seguridad psicologica permite que las personas compartan dudas, errores, desacuerdos e ideas sin miedo a castigo, burla o represalia. En equipos remotos es critica porque se pierden senales no verbales, los mensajes escritos pueden malinterpretarse y la asincronia puede aumentar aislamiento o autocensura. Para fomentarla, un lider puede establecer normas claras de comunicacion, modelar apertura, pedir disenso explicito, reconocer contribuciones y responder a errores sin castigo.",
    "rubric": [
      {
        "id": "challenges_identified",
        "label": "Identificacion de desafios",
        "description": "Claridad al identificar desafios especificos de construir confianza en comunicacion virtual.",
        "weight": 50
      },
      {
        "id": "solutions_proposed",
        "label": "Propuesta de soluciones",
        "description": "Viabilidad y pertinencia de las soluciones propuestas para fomentar seguridad psicologica.",
        "weight": 50
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
      "materialVersion": "course-engine@1.0.0",
      "rubricVersion": "seguridad-psicologica-remota@1.0.0",
      "promptVersion": "SOFLIA_DIALOGUE_TUTOR@1.0.0"
    }
  }
}
```

## Anti-ejemplo que debe evitarse

Este formato es el que provoco el problema:

```sql
activity_type = 'ai_chat'
activity_content = '{ "...": "...", "interactionType": "soflia_dialogue", "runtimeType": "SOFLIA_DIALOGUE" }'
activity_schema_version = 1
activity_config = null
```

Aunque el JSON interno sea valido, queda en la columna equivocada. El renderer y el backend deben poder leer `activity_config` como contrato principal.

## SQL esperado al insertar directamente

```sql
insert into public.lesson_activities (
  activity_id,
  lesson_id,
  activity_title,
  activity_description,
  activity_type,
  activity_content,
  activity_order_index,
  is_required,
  estimated_time_minutes,
  activity_schema_version,
  activity_config,
  requires_soflia_validation,
  external_tool_key
) values (
  gen_random_uuid(),
  '<lesson_id>',
  'Seguridad Psicologica en Equipos Remotos',
  null,
  'ai_chat',
  null,
  1,
  false,
  8,
  2,
  '<SOFLIA_DIALOGUE_JSON>'::jsonb,
  false,
  null
);
```

Si Course Engine necesita conservar contenido visible adicional, puede usar `activity_content` para una introduccion breve, pero nunca como contrato del runtime.

## Validaciones minimas antes de publicar

Course Engine debe validar:

- `activity_config.interactionType === "soflia_dialogue"`
- `activity_config.runtimeType === "SOFLIA_DIALOGUE"`
- `activity_schema_version === 2`
- `successCriteria.length >= 1`, recomendado `2` a `5`
- `rubric.length >= 1`
- `openingMessage` no debe revelar rubrica ni respuesta modelo
- `rescueContent` debe existir y no debe mostrarse como mensaje inicial
- `policy.approvalMinimum` entre `0` y `100`, recomendado `70` a `85`
- `policy.maxTurns` entre `1` y `30`, recomendado `6` a `10`
- Los IDs de `successCriteria`, `rubric` y `hintLadder.targetCriterionId` deben ser estables, sin acentos y sin espacios
- `hintLadder.targetCriterionId` debe apuntar a IDs existentes en `successCriteria`
- La suma de `rubric.weight` deberia ser `100`

## Checklist de integracion

Antes de dar por buena una generacion:

1. Insertar una actividad de prueba.
2. Consultar:

```sql
select
  activity_id,
  activity_type,
  activity_schema_version,
  activity_config->>'interactionType' as interaction_type,
  activity_config->>'runtimeType' as runtime_type,
  requires_soflia_validation
from public.lesson_activities
where activity_id = '<activity_id>';
```

3. Confirmar resultado:

```text
activity_type = ai_chat
activity_schema_version = 2
interaction_type = soflia_dialogue
runtime_type = SOFLIA_DIALOGUE
requires_soflia_validation = false
```

4. Abrir la leccion en SofLIA Learning.
5. Verificar que la actividad muestra el renderer conversacional embebido, no el boton legacy de `ai_chat`.
6. Enviar un primer mensaje.
7. Confirmar que se crean registros en las tablas del runtime de dialogo: sesiones, turnos, evaluaciones, eventos y resultado final cuando aplique.

## Migracion de registros ya generados incorrectamente

Para registros existentes donde el JSON quedo en `activity_content`, puede usarse una migracion controlada:

```sql
update public.lesson_activities
set
  activity_config = activity_content::jsonb,
  activity_schema_version = 2,
  requires_soflia_validation = false,
  external_tool_key = null
where activity_type = 'ai_chat'
  and activity_config is null
  and activity_content is not null
  and activity_content::jsonb->>'interactionType' = 'soflia_dialogue'
  and activity_content::jsonb->>'runtimeType' = 'SOFLIA_DIALOGUE';
```

Ejecutar primero como `select` para revisar impacto:

```sql
select
  activity_id,
  activity_title,
  activity_schema_version,
  activity_config,
  activity_content::jsonb->>'interactionType' as interaction_type,
  activity_content::jsonb->>'runtimeType' as runtime_type
from public.lesson_activities
where activity_type = 'ai_chat'
  and activity_config is null
  and activity_content is not null
  and activity_content::jsonb->>'interactionType' = 'soflia_dialogue';
```

## Resumen para Course Engine

Generar el JSON correcto no es suficiente. Debe enviarse en la columna/campo correcto:

```text
Correcto:
activity_config = SOFLIA_DIALOGUE JSON
activity_schema_version = 2

Incorrecto:
activity_content = SOFLIA_DIALOGUE JSON
activity_config = null
activity_schema_version = 1
```
