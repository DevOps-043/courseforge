# Solución para Calidad de Curaduría y Alucinación de URLs

## Diagnóstico

El sistema actual (Gemini + Google Search Tool) está generando URLs que devuelven errores 404.
Esto ocurre porque el modelo **no está siendo forzado a usar _exclusivamente_ los resultados de la búsqueda**. A menudo mezcla "recuerdos" de su entrenamiento (URLs antiguas que ya no existen) con resultados reales.

## Solución Propuesta: Prompt con "Grounding" Estricto (Chain of Thought)

Para solucionar esto, debemos cambiar la estrategia de _Prompting_ dentro de la función `curation-background.ts`. En lugar de pedir el JSON directamente, debemos obligar al modelo a **pensar y validar** en dos pasos dentro de la misma llamada.

### Nuevo Modelo Mental del Prompt

1.  **Paso 1 (Pensamiento Oculto):** Generar consultas de búsqueda específicas para cada componente.
2.  **Paso 2 (Extracción):** De los resultados devueltos por la herramienta `googleSearch`, seleccionar **solo** los que tienen link válido.
3.  **Paso 3 (Generación):** Construir el JSON usando **únicamente** las URLs que la herramienta de búsqueda confirmó.

## Código Corrector para `netlify/functions/curation-background.ts`

Este código implementa un prompt reforzado anti-alucinaciones.

```typescript
// ... (Imports y configuración igual)

// DENTRO DEL BUCLE DE PROCESAMIENTO (reemplazar el string 'prompt'):

const prompt = `
ERES UN AUDITOR DE CALIDAD DE CONTENIDOS. Tienes acceso a la herramienta Google Search.

TU OBJETIVO: Generar fuentes bibliográficas para un curso.
TU RESTRICCIÓN #1: PROHIBIDO INVENTAR URLs.
TU RESTRICCIÓN #2: Si una URL no aparece en los resultados de tu búsqueda de Google, NO EXISTE para ti.

CONTEXTO DEL CURSO:
${courseName}
${ideaCentral}

COMPONENTES A INVESTIGAR:
${lessonsText}

INSTRUCCIONES DE EJECUCIÓN (Sigue estos pasos mentalmente):
1. Para cada componente, EJECUTA una búsqueda en Google usando palabras clave precisas.
2. OBSERVA los resultados reales que te devuelve la herramienta.
3. SELECCIONA solo aquellos resultados que provengan de fuentes confiables (Wikipedia, Universidades, Medios reconocidos de HR/Empresa).
4. RECHAZA cualquier resultado que parezca un blog SEO spam, un video de YouTube o un sitio con Paywall.
5. EXTRAE el Título y la URL EXACTA de los resultados de búsqueda.

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "sources_by_lesson": [
    {
      "lesson_id": "...",
      "lesson_title": "...",
      "components": [
        {
          "component_name": "...",
          "candidate_sources": [
             {
               "title": "Titulo REAL del resultado de búsqueda",
               "url": "URL REAL del resultado de búsqueda",
               "rationale": "Por qué es buena fuente...",
               "requires_download": false,
               "is_acceptable": true
             }
          ]
        }
      ]
    }
  ]
}
`;
// ... (Resto del código igual)
```

## Próximos Pasos para Claude Code

1.  **Aplicar este prompt** en `netlify/functions/curation-background.ts`.
2.  **Verificar** si el SDK soporta `dynamicRetrievalConfig` para forzar un umbral de confianza alto (esto depende de la versión exacta de `@google/generative-ai`).
3.  Mantener la **validación de URLs en código** (`checkUrlAvailability`) como red de seguridad final.
