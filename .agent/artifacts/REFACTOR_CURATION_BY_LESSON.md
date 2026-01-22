# Refactorización: Curaduría por Lección (No por Componente)

## Problema Actual

- 64 componentes = 32+ lotes = muchas llamadas a la API
- URLs 404 frecuentes (modelo busca muy específico)
- Búsqueda superficial por cada componente individual

## Nueva Arquitectura

### Concepto

En lugar de buscar fuentes para cada componente (DIALOGUE, READING, QUIZ, VIDEO...),
buscamos **1-2 fuentes de alta calidad por LECCIÓN** que fundamenten todo el contenido.

### Ejemplo

| Antes                                                                 | Después                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Lección 1.2: buscar para DIALOGUE, READING, VIDEO, QUIZ (4 búsquedas) | Lección 1.2: buscar 2 fuentes profundas que cubran el tema |
| 64 componentes → 32 lotes                                             | 16 lecciones → 16 lotes                                    |
| URLs específicas que fallan                                           | URLs generales sobre el tema                               |

### Cambios Necesarios

## 1. Backend (`unified-curation-logic.ts`)

### 1.1 Agrupar por Lección (no aplanar componentes)

```typescript
// ANTES: Flatten all components
let componentsToProcess = [];
lessonPlans.forEach(lesson => {
    lesson.components.forEach(comp => {
        componentsToProcess.push({ lesson_id, component_type, ... });
    });
});

// DESPUÉS: Keep lessons as units
let lessonsToProcess = lessonPlans.map(lesson => ({
    lesson_id: lesson.lesson_id,
    lesson_title: lesson.lesson_title,
    lesson_objective: lesson.objective || lesson.summary,
    component_count: lesson.components?.length || 0
}));
```

### 1.2 Nuevo Prompt del Sistema

```
ROLE: Deep Research Agent for Educational Content

For each LESSON provided, find 1-2 HIGH-QUALITY sources that:
1. Cover the main topic/objective of the lesson
2. Are from authoritative sources (official docs, major publications)
3. Have substantial content (1000+ words)
4. Are current (2024-2026)

DO NOT search for individual components. Search for the LESSON TOPIC.

OUTPUT: 1-2 sources per lesson with deep rationale.
```

### 1.3 Nuevo Formato de Salida

```json
{
  "sources_by_lesson": [
    {
      "lesson_id": "les-1-2",
      "lesson_title": "Auditoría de Energía Personal",
      "sources": [
        {
          "url": "...",
          "title": "...",
          "rationale": "Esta fuente cubre X, Y, Z del tema de la lección",
          "coverage": ["DIALOGUE basis", "READING material", "QUIZ concepts"],
          "quality_score": 9
        }
      ]
    }
  ]
}
```

## 2. Database (`curation_rows`)

### Opción A: Modificar uso actual

- Usar `component = 'LESSON_SOURCE'` para fuentes a nivel lección
- Mantener compatibilidad con registros antiguos

### Opción B: Nueva tabla (más limpio)

```sql
CREATE TABLE lesson_sources (
    id UUID PRIMARY KEY,
    curation_id UUID REFERENCES curation(id),
    lesson_id TEXT NOT NULL,
    lesson_title TEXT,
    source_url TEXT,
    source_title TEXT,
    source_rationale TEXT,
    coverage_notes TEXT,
    url_status TEXT DEFAULT 'PENDING',
    quality_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 3. Frontend (`SourcesCurationGenerationContainer.tsx`)

### Nueva UI

```
┌─────────────────────────────────────────────────────┐
│ Módulo 1: Gestión de Energía                        │
├─────────────────────────────────────────────────────┤
│ 📖 Lección 1.1: Ritmos Ultradianos                  │
│    Fuente 1: [URL] - Guía completa de ritmos...     │
│    Fuente 2: [URL] - Productividad basada en...     │
│                                                     │
│ 📖 Lección 1.2: Auditoría Energética                │
│    Fuente 1: [URL] - Template de auditoría...       │
│    (Sin fuente secundaria)                          │
│                                                     │
│ 📖 Lección 1.3: Protección del Prime Time           │
│    Fuente 1: [URL] - Biological Prime Time...       │
│    Fuente 2: [URL] - Deep Work vs Shallow Work...   │
└─────────────────────────────────────────────────────┘
```

## 4. Beneficios

| Métrica           | Antes    | Después                     |
| ----------------- | -------- | --------------------------- |
| Llamadas API      | ~32      | ~8-16                       |
| Tokens consumidos | Alto     | Reducido 50%+               |
| Tasa de 404       | ~40%     | <10% (fuentes más estables) |
| Calidad fuentes   | Variable | Alta (búsqueda profunda)    |
| Tiempo total      | ~10 min  | ~3 min                      |

## 5. Plan de Implementación

### Fase 1: Backend (unified-curation-logic.ts)

1. [ ] Refactorizar agrupación por lección
2. [ ] Actualizar prompts para búsqueda profunda
3. [ ] Cambiar formato de salida JSON
4. [ ] Ajustar inserción en BD (usar `LESSON_SOURCE`)

### Fase 2: Frontend

1. [ ] Actualizar `SourcesCurationGenerationContainer.tsx`
2. [ ] Mostrar fuentes agrupadas por lección
3. [ ] Eliminar vista por componente

### Fase 3: Testing

1. [ ] Probar con artefacto existente
2. [ ] Verificar calidad de fuentes
3. [ ] Medir reducción de 404s
