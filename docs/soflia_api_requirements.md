# Requerimientos de Actualización API SOFLIA (Importación de Cursos)

## Contexto
Se ha identificado que los Cuestionarios (Quizzes) generados en CourseForge deben almacenarse en la tabla `lesson_materials` de SOFLIA para aprovechar la columna `content_data` (JSONB), en lugar de `lesson_activities` que usa texto plano.

## Cambio en el Payload
CourseForge ahora enviará los quizzes dentro del array `materials` de cada lección en el payload de importación.

### Ejemplo de Payload (Nuevo Formato)

```json
{
  "modules": [
    {
      "lessons": [
        {
          "materials": [
            {
              "title": "Evaluación del Módulo 1",
              "type": "quiz",  <-- ESTO ES NUEVO
              "description": "Instrucciones del quiz...",
              "data": {
                 "passing_score": 80,
                 "totalPoints": 100,
                 "questions": [...]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

## Cambios Necesarios en Backend (SOFLIA)

Actualmente, el endpoint de importación (`/api/courses/import`) rechaza este payload con el siguiente error:
`Invalid enum value. Expected 'link' | 'pdf' | 'document'`

### 1. Actualizar Validación de Enum `material_type`
El validador del endpoint (probablemente Zod o Joi) debe actualizarse para permitir `'quiz'` como un tipo válido de material.

**Cambio requerido:**
Agregar `'quiz'` a la lista de valores permitidos para `material_type` en el esquema de validación de materiales.

### 2. Mapeo a Base de Datos
Asegurar que cuando el tipo sea `'quiz'`:
-   Se inserte un registro en la tabla `lesson_materials`.
-   El campo `material_type` se guarde como `'quiz'`.
-   El objeto `data` del payload se guarde en la columna `content_data` (JSONB).
-   El campo `description` se guarde en `material_description`.

---
**Nota:** El formato interno de `data` (las preguntas) ya ha sido normalizado en CourseForge para cumplir con el estándar esperado (camelCase, sin items, etc.).
