# Especificación de Contenido para Integración CourseForge

Este documento define la estructura JSON esperada para los objetos de contenido generados (Quizzes y Conversaciones LIA) que deben ser importados al sistema.

## 1. Estructura de Quiz

Para actividades de tipo `quiz`.

### Formato JSON

El objeto de contenido del quiz debe seguir esta estructura. Se prefiere el uso de **camelCase** para asegurar compatibilidad con el editor y el visualizador.

```json
{
  "passing_score": 80,
  "questions": [
    {
      "id": "q-1715000000000",
      "question": "¿Cuál es el propósito principal de React?",
      "questionType": "multiple_choice",
      "options": [
        "Gestionar bases de datos",
        "Construir interfaces de usuario",
        "Servir archivos estáticos",
        "Compilar código Java"
      ],
      "correctAnswer": "Construir interfaces de usuario",
      "explanation": "React es una biblioteca de JavaScript focalizada en la creación de UIs interactivas.",
      "points": 10
    },
    {
      "id": "q-1715000000001",
      "question": "React fue creado por Google.",
      "questionType": "true_false",
      "options": [
        "Verdadero",
        "Falso"
      ],
      "correctAnswer": "Falso",
      "explanation": "React fue creado y es mantenido por Meta (Facebook).",
      "points": 5
    }
  ],
  "totalPoints": 15
}
```

### Propiedades Clave del Item (Pregunta)

| Propiedad | Tipo | Descripción |
| :--- | :--- | :--- |
| `id` | `string` | Identificador único (opcional en generación, recomendado). |
| `question` | `string` | El texto de la pregunta. |
| `questionType` | `string` | `multiple_choice`, `true_false`, o `short_answer`. |
| `options` | `string[]` | Array de opciones de respuesta. Para `true_false`, debe ser `["Verdadero", "Falso"]`. |
| `correctAnswer` | `string` | **IMPORTANTE**: La respuesta correcta exacta (debe coincidir textualmente con una de las opciones). Usar `camelCase`. |
| `explanation` | `string` | (Opcional) Texto explicativo que se muestra tras responder. |
| `points` | `number` | Puntos otorgados por la pregunta. |

> **Nota de Compatibilidad**: El sistema soporta `correct_answer` (snake_case) por razones históricas, pero se **recomienda encarecidamente** usar `correctAnswer` (camelCase) para consistencia con el editor interno.

---

## 2. Estructura de Conversación LIA (Script)

Para actividades de tipo `lia_script` o `ai_chat`. Estas definen simulaciones de rol o guiones de conversación sugeridos.

### Formato JSON

```json
{
  "introduction": "En este escenario, practicarás cómo dar feedback constructivo a un colega.",
  "scenes": [
    {
      "character": "Lia",
      "message": "Hola, necesito hablar contigo sobre el reporte entregado ayer. ¿Tienes un momento?",
      "emotion": "neutral"
    },
    {
      "character": "Usuario",
      "message": "Claro Lia, dime. ¿Hubo algún problema con los datos?",
      "emotion": "curious"
    },
    {
      "character": "Lia",
      "message": "Los datos están bien, pero la presentación no sigue el formato estándar. Es importante para la consistencia.",
      "emotion": "serious"
    }
  ],
  "conclusion": "Observa cómo el enfoque directo pero respetuoso ayuda a clarificar el problema sin generar conflicto personal."
}
```

### Propiedades Clave de Escena

| Propiedad | Tipo | Descripción |
| :--- | :--- | :--- |
| `character` | `string` | Nombre del personaje. Generalmente "Lia" o "Usuario" (u otro rol específico). |
| `message` | `string` | El contenido del diálogo. |
| `emotion` | `string` | (Opcional) Etiqueta de emoción para contexto visual/tono (ej. `neutral`, `happy`, `concerned`, `serious`). |

---

## Validación

Al generar contenido desde CourseForge, asegúrese de que el JSON resultante sea válido y respete estrictamente los nombres de las propiedades listadas anteriormente, especialmente `correctAnswer` para los quizzes.
