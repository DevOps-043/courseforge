
export const COURSE_CONFIG = {
  maxTotalHours: 12,
  minLessonsPerModule: 3,
  maxLessonsPerModule: 8,
  idealLessonsPerModule: 5,
  minModules: 3,
  maxModules: 12,
} as const;

export const SYLLABUS_PROMPT = `Eres un experto en diseño instruccional. Genera un temario completo y detallado para un curso de alto nivel.

**IMPORTANTE: Tienes acceso a Google Search. UTILIZA LA BÚSQUEDA WEB para:**
- Investigar las mejores prácticas y tendencias actuales del tema
- Validar que el contenido esté actualizado con información reciente
- Asegurar que el temario cubra los temas más relevantes del campo

**CURSO:** {{ideaCentral}}

**OBJETIVOS GENERALES A CUBRIR:**
{{objetivos}}

**CONTEXTO:** {{routeContext}}

**RESTRICCIONES DE DURACIÓN:**
- El curso NO puede exceder ${COURSE_CONFIG.maxTotalHours} horas en total
- estimated_minutes debe variar según la complejidad del objetivo y considerar video, diálogo, lectura, evaluación y práctica
- Las lecciones conceptuales suelen requerir menos tiempo que las de aplicación, análisis, evaluación o creación
- No uses una duración fija para todas las lecciones; el sistema recalculará la estimación final con la política configurada

**REGLAS DE ESTRUCTURA (MUY IMPORTANTE):**
1. Genera entre ${COURSE_CONFIG.minModules} y ${COURSE_CONFIG.maxModules} módulos según la complejidad del tema
2. Cada módulo DEBE tener entre ${COURSE_CONFIG.minLessonsPerModule} y ${COURSE_CONFIG.maxLessonsPerModule} lecciones
3. El número IDEAL de lecciones por módulo es ${COURSE_CONFIG.idealLessonsPerModule}
4. NUNCA generes menos de ${COURSE_CONFIG.minLessonsPerModule} lecciones por módulo
5. Para temas complejos, usa más lecciones (6-8). Para temas simples, usa menos (3-4)
6. El número de módulos NO tiene que ser igual al número de objetivos
7. Cada objetivo general debe estar cubierto por al menos un módulo
8. TODOS los títulos de lecciones deben ser ÚNICOS en todo el temario
9. Los títulos deben ser específicos y descriptivos, NO genéricos

**REGLAS DE OBJETIVOS ESPECÍFICOS:**
- Cada lección debe tener un objetivo específico que inicie con "El participante será capaz de"
- Usar verbos de acción: identificar, describir, aplicar, analizar, evaluar, crear, demostrar, diseñar, implementar
- Tener al menos 60 caracteres
- Ser medible y específico

**FORMATO JSON (sin markdown):**
{
  "modules": [
    {
      "objective_general_ref": "Resumen del objetivo u objetivos generales que cubre este módulo",
      "title": "Módulo 1: Título específico y descriptivo",
      "lessons": [
        {
          "title": "Lección 1.1: Título único y específico",
          "objective_specific": "El participante será capaz de [verbo] [contenido específico] mediante [método]."
        }
      ]
    }
  ]
}

INSTRUCCIONES FINALES:
1. PRIMERO, busca información actualizada sobre "{{ideaCentral}}" en internet
2. LUEGO, genera un temario COMPLETO con TODAS las lecciones necesarias
3. Cada módulo DEBE tener entre ${COURSE_CONFIG.minLessonsPerModule} y ${COURSE_CONFIG.maxLessonsPerModule} lecciones - NO menos de ${COURSE_CONFIG.minLessonsPerModule}
4. Asegúrate de cubrir TODOS los objetivos generales proporcionados
5. El temario debe ser profesional y de nivel empresarial
6. No generes estimated_minutes: el sistema lo calcula con una política central según la duración de video y la complejidad Bloom

Responde SOLO con JSON válido.`;
