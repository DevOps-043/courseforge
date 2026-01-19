# Contexto para Solución de Bug en Curation Background

## Descripción del Problema

La función de background `curation-background.ts` diseñada para curar fuentes bibliográficas utilizando Google Generative AI (Gemini) está fallando en utilizar la herramienta de `googleSearch`.
A pesar de que el código configura `tools: [{ googleSearch: {} }]`, los logs muestran consistentemente que el modelo no devuelve `groundingMetadata` (chunks de búsqueda), lo que nuestro sistema interpreta como "alucinación" de URLs y rechaza.

Queremos obligar al modelo a buscar en tiempo real y devolver fuentes verificables.

## Logs de Error Observados

```log
[BG-CURATION] Iniciando trabajo para CurationID: ...
[BG-CURATION] Procesando lote 1/11...
[BG-CURATION] Intentando con gemini-2.5-pro...
[BG-CURATION] gemini-2.5-pro no devolvió grounding links (posible alucinación). Intentando siguiente modelo...
[BG-CURATION] Intentando con gemini-2.0-flash...
[BG-CURATION] gemini-2.0-flash no devolvió grounding links (posible alucinación). Intentando siguiente modelo...
```

## Archivo Actual: `curation-background.ts`

(Aquí se incluye el código relevante del archivo que gestiona la llamada a la API y el manejo de herramientas).

La configuración actual es:

```typescript
const currentModel = genAI.getGenerativeModel({
  model: modelName,
  tools: [{ googleSearch: {} }] as any,
  generationConfig: { temperature: temp },
});
```

Y la validación que falla es:

```typescript
const candidate = (result.response as any).candidates?.[0]
const groundingMetadata = candidate?.groundingMetadata
if (groundingMetadata?.groundingChunks?.length > 0) {
    // Éxito
} else {
    console.warn(...) // Falla aquí
}
```

## Objetivo

Necesitamos modificar la implementación para:

1. **Garantizar la invocación de Google Search**: Asegurar que el modelo use la herramienta.
2. **Detectar correctamente el uso de la herramienta**: Ver si estamos validando `groundingMetadata` de forma incorrecta o si hay otra propiedad que indique que la búsqueda se realizó.
3. **Manejar casos donde el modelo busca pero no estructura la respuesta**: Quizás el modelo devuelve las fuentes en el texto pero no en los metadatos de grounding de la forma esperada.

## Restricciones

- Debemos usar `@google/generative-ai`.
- El entorno es una Netlify Function (Node.js).
- NO podemos inventar fuentes.

---

**Instrucción para el Asistente:**
Analiza el código y los logs proporcionados. Identifica por qué `googleSearch` no está devolviendo `groundingChunks` y propón una corrección de código robusta para el archivo `curation-background.ts`. Considera si hay cambios en la API, problemas de temperatura, o problemas con el prompt del sistema que impiden la activación de la herramienta.
