# Paso 4 — Curaduria de fuentes con OpenAI

## Objetivo

El Paso 4 encuentra 1-2 fuentes publicas por leccion, valida tecnicamente las URLs y deja los resultados listos para revision QA. El flujo ya no depende de un GPT personalizado externo ni de importacion manual de JSON.

## Flujo actual

1. El usuario inicia la curaduria desde el dashboard del artefacto.
2. `startCurationAction` crea o reutiliza el registro `curation` en estado `PHASE2_GENERATING`.
3. `curation-background.ts` ejecuta `processUnifiedCuration`.
4. `processUnifiedCuration` carga:
   - `artifacts`
   - `syllabus`
   - `instructional_plans`
   - `model_settings` con `setting_type = CURATION`
5. Las lecciones se procesan en batches de 2.
6. Cada batch llama a OpenAI Responses API con:
   - modelo principal `gpt-5.6-luna` por defecto
   - fallback `gpt-5.6-terra`
   - herramienta `web_search`
   - salida estructurada con JSON Schema estricto
7. Cada URL candidata pasa por `validateUrlWithContent`.
8. Las fuentes validas se insertan incrementalmente en `curation_rows`.
9. Al terminar, `curation.state` pasa a `PHASE2_GENERATED`.
10. QA puede ejecutar validacion profunda y aprobar/rechazar la fase.

## Contrato de salida del modelo

El modelo debe responder solo:

```json
{
  "lessons": [
    {
      "lesson_id": "EXACT_ID_FROM_INPUT",
      "lesson_title": "EXACT_TITLE_FROM_INPUT",
      "sources": [
        {
          "url": "https://example.com/article",
          "title": "Article title",
          "rationale": "Why this source supports the lesson",
          "key_topics_covered": ["topic"],
          "estimated_quality": 8
        }
      ]
    }
  ]
}
```

## Validacion propia del sistema

El modelo no decide por si solo si una fuente es apta. Courseforge valida:

- status HTTP
- redirecciones
- soft 404
- paywall basico
- longitud minima de contenido
- dominios bloqueados por reglas de curaduria

## Configuracion

- `OPENAI_API_KEY` es obligatorio para Paso 4.
- `OPENAI_CURATION_MODEL` puede sobreescribir el modelo default si no hay modelo OpenAI configurado en `model_settings`.
- `model_settings.CURATION.model_name` y `fallback_model` deben usar modelos OpenAI.

Defaults:

- principal: `gpt-5.6-luna`
- fallback: `gpt-5.6-terra`
- reasoning: `low`

## Integraciones removidas

- No existe endpoint `/api/gpt/sources`.
- No existe accion OpenAPI para GPT personalizado.
- La UI ya no abre ChatGPT ni copia contexto al portapapeles.
- La UI ya no permite pegar JSON manual desde un GPT externo.

## Riesgos y controles

- Si OpenAI no devuelve JSON valido, el sistema intenta fallback con las fuentes consultadas por web search.
- Si una URL falla validacion, no se inserta como fuente apta.
- Si un batch falla por overload/503, se reintenta con el fallback model.
- Si OpenAI devuelve cuota o billing agotado, la curaduria pasa a `PHASE2_BLOCKED` y no reintenta todos los batches. Ese error requiere corregir la configuracion/cuenta del proveedor antes de reanudar.
- El proceso respeta pausa, stop y resume mediante estados de `curation`.
