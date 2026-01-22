# Documentación: Sistema de Curaduría de Fuentes (v2.0)

**Última actualización:** 21 de enero de 2026  
**Autor:** Equipo de Desarrollo CourseForge

---

## 📋 Resumen Ejecutivo

El sistema de curaduría de fuentes ha sido completamente refactorizado para pasar de un enfoque **por componente** a un enfoque **por lección**. Esto reduce significativamente las llamadas a la API, mejora la calidad de las fuentes y evita URLs irrelevantes.

### Cambio Principal

| Antes                                                    | Ahora                                                 |
| -------------------------------------------------------- | ----------------------------------------------------- |
| 1 fuente por componente (64 componentes → 64+ búsquedas) | 1-2 fuentes por lección (16 lecciones → 16 búsquedas) |
| Contexto mínimo al modelo                                | Contexto completo del curso                           |
| Sin filtro de dominios                                   | Filtro de dominios irrelevantes                       |

---

## 🏗️ Arquitectura

### Archivos Principales

```
apps/web/
├── netlify/functions/
│   ├── unified-curation-logic.ts   # ⭐ Lógica principal de curaduría
│   ├── curation-background.ts      # Handler de Netlify Functions
│   └── validate-curation-background.ts  # Validación/Regeneración
│
└── src/domains/curation/
    ├── components/
    │   ├── SourcesCurationGenerationContainer.tsx  # UI principal
    │   ├── CurationDashboard.tsx                   # Dashboard de fuentes
    │   └── CurationRowItem.tsx                     # Item individual
    ├── hooks/
    │   └── useCuration.ts           # Hook de estado
    └── services/
        └── curation.service.ts      # Servicio de datos
```

---

## 🔄 Flujo de Curaduría

```
┌─────────────────────────────────────────────────────────────┐
│                    PASO 4: CURADURÍA                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. OBTENER CONTEXTO DEL CURSO                               │
│    - Título, descripción, audiencia                         │
│    - Módulos del syllabus                                   │
│    - Keywords y objetivos de aprendizaje                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. EXTRAER LECCIONES (no componentes)                       │
│    - lesson_id, lesson_title, objective, module             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PROCESAR EN LOTES (2 lecciones por lote)                 │
│    - Generar prompt con contexto completo del curso         │
│    - Llamar a Gemini con googleSearch tool                  │
│    - Parsear respuesta JSON                                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. VALIDAR URLs                                             │
│    - Filtrar dominios bloqueados (Reddit, forums, etc.)     │
│    - Verificar HTTP status (no 404/403)                     │
│    - Detectar soft 404s y paywalls                          │
│    - Verificar contenido mínimo (500+ caracteres)           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. GUARDAR EN BD                                            │
│    - component = 'LESSON_SOURCE'                            │
│    - Incluir rationale y quality score                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Base de Datos

### Tabla: `curation_rows`

| Campo              | Tipo    | Descripción                               |
| ------------------ | ------- | ----------------------------------------- |
| `id`               | UUID    | Identificador único                       |
| `curation_id`      | UUID    | FK a tabla `curation`                     |
| `lesson_id`        | TEXT    | ID de la lección (ej: "les-1-2")          |
| `lesson_title`     | TEXT    | Título de la lección                      |
| `component`        | TEXT    | Siempre `'LESSON_SOURCE'` en v2.0         |
| `source_ref`       | TEXT    | URL de la fuente                          |
| `source_title`     | TEXT    | Título del artículo/recurso               |
| `source_rationale` | TEXT    | Por qué esta fuente es relevante          |
| `url_status`       | TEXT    | Estado: 'OK', '404', 'TIMEOUT', etc.      |
| `apta`             | BOOLEAN | Si la fuente es apta para uso             |
| `auto_evaluated`   | BOOLEAN | Si fue validada automáticamente           |
| `auto_reason`      | TEXT    | Razón de la auto-evaluación               |
| `notes`            | TEXT    | Notas adicionales (quality score, topics) |

---

## 🤖 Prompts del Sistema

### System Prompt (generateSystemPrompt)

El prompt del sistema ahora incluye:

1. **Contexto del curso completo:**

   ```
   COURSE TITLE: Productividad y Gestión del Tiempo
   DESCRIPTION: Aprende a maximizar tu productividad...
   TARGET AUDIENCE: Profesionales y emprendedores
   MAIN MODULES: Gestión de Energía, Time Blocking, Deep Work
   KEY TOPICS/KEYWORDS: productividad, time blocking, deep work
   LEARNING OBJECTIVES: Identificar ritmos de energía; Aplicar técnicas...
   ```

2. **Instrucciones de búsqueda:**
   - Buscar con el tema del curso + tema de la lección
   - Preferir publicaciones reconocidas
   - Evitar Reddit, foros, PDFs académicos no relacionados

3. **Formato de salida JSON:**
   ```json
   {
     "lessons": [
       {
         "lesson_id": "les-1-2",
         "lesson_title": "...",
         "sources": [
           {
             "url": "https://...",
             "title": "...",
             "rationale": "...",
             "key_topics_covered": ["..."],
             "estimated_quality": 8
           }
         ]
       }
     ]
   }
   ```

### Batch Prompt

Cada lote incluye:

- Recordatorio de fecha actual (freshness)
- Contexto completo del curso
- Lecciones a investigar
- Estrategia de búsqueda sugerida

---

## 🚫 Filtro de Dominios Bloqueados

El sistema rechaza automáticamente URLs de estos dominios:

| Dominio                 | Razón                             |
| ----------------------- | --------------------------------- |
| `reddit.com`            | Foro no verificable               |
| `quora.com`             | Q&A de calidad variable           |
| `twitter.com` / `x.com` | Red social                        |
| `facebook.com`          | Red social                        |
| `semanticscholar.org`   | Papers académicos no relacionados |
| `arxiv.org`             | Papers técnicos                   |
| `replit.app`            | Playground de código              |
| `stackoverflow.com`     | Q&A técnico                       |

### Excepciones Inteligentes

- Si el curso es de **programación**: permite `github.com`
- Si el curso es de **finanzas**: permite `investopedia.com`

---

## ✅ Validación de Contenido

Función: `validateUrlWithContent(url)`

### Verificaciones:

1. **HTTP Status:** Rechaza >= 400
2. **Soft 404:** Detecta frases como "page not found", "404 error"
3. **Paywall:** Detecta "sign in to continue", "subscribe to read"
4. **Contenido mínimo:** Requiere >= 500 caracteres de texto

### Resultado:

```typescript
{
  isValid: boolean,
  reason: string,       // 'OK', 'HTTP 404', 'Soft 404', 'Paywall', 'Too short'
  contentLength: number
}
```

---

## 📱 Frontend

### CurationDashboard.tsx

Vista por lección:

```
┌─────────────────────────────────────────────────────────────┐
│ 📊 16 Lecciones | ✓ 14 Fuentes Válidas | ✗ 2 Inválidas     │
├─────────────────────────────────────────────────────────────┤
│ 📖 Lección 1.2: Auditoría de Energía Personal      [1/2] ✓ │
│ ├─ ① Guía completa de gestión energética...      [Válida]  │
│ │    https://example.com/energy-management                  │
│ │    "Cubre ritmos ultradianos, auditoría personal..."      │
│ │                                                           │
│ └─ ② Productividad basada en energía...          [Válida]  │
│      https://example.com/productivity-energy                │
├─────────────────────────────────────────────────────────────┤
│ 📖 Lección 1.3: Protección del Prime Time         [2/2] ✓  │
│ └─ ...                                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuración

### Variables de Entorno

| Variable                       | Descripción                  |
| ------------------------------ | ---------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`     | URL de Supabase              |
| `SUPABASE_SERVICE_ROLE_KEY`    | Service Role Key de Supabase |
| `GOOGLE_GENERATIVE_AI_API_KEY` | API Key de Gemini            |

### Tabla: `model_settings`

| Campo            | Valor Recomendado          |
| ---------------- | -------------------------- |
| `setting_type`   | `'CURATION'`               |
| `model_name`     | `'gemini-3-flash-preview'` |
| `fallback_model` | `'gemini-2.0-flash'`       |
| `is_active`      | `true`                     |

---

## 📈 Métricas de Mejora

| Métrica              | Antes (v1) | Ahora (v2) |
| -------------------- | ---------- | ---------- |
| Lotes por curso      | ~32        | ~8         |
| Llamadas API         | ~64        | ~16        |
| Tasa de 404          | ~40%       | <15%       |
| Fuentes irrelevantes | Alto       | Mínimo     |
| Tiempo total         | ~10 min    | ~3-5 min   |

---

## 🐛 Troubleshooting

### "Empty response"

El modelo no generó texto. Se usa grounding fallback.
**Solución:** Verificar que el modelo tenga acceso a googleSearch tool.

### "Model overloaded (503)"

El modelo Gemini está saturado.
**Solución:** El sistema cambia automáticamente al `fallback_model` y espera 10 segundos.

### "Grounding Filter Blocked"

Una URL fue rechazada por el filtro de dominios.
**Solución:** Es comportamiento esperado. La URL era de un dominio no confiable.

### "Too short content"

La página tiene menos de 500 caracteres de contenido.
**Solución:** Es comportamiento esperado. La página probablemente es un placeholder.

---

## 📚 Referencias

- [Google Generative AI SDK](https://ai.google.dev/gemini-api/docs)
- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)

---

## 🔮 Mejoras Futuras

1. **Caché de URLs:** Guardar validaciones previas para evitar re-verificar URLs
2. **Scoring de relevancia:** Usar embeddings para verificar relevancia semántica
3. **Fuentes sugeridas:** Permitir al usuario sugerir dominios preferidos
4. **Multi-idioma:** Detectar idioma del curso y buscar fuentes en ese idioma
