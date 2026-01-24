import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, COMPUTER_USE_PROMPT } from '@/lib/lia-app-context';
import { getLiaDBContext, generateDBContextSummary } from '@/lib/lia-db-context';

// Get Lia settings from database
const getLiaSettings = async (supabase: any, useComputerUse: boolean) => {
  // COMPUTER for computer use mode, LIA_MODEL for standard mode
  const settingType = useComputerUse ? 'COMPUTER' : 'LIA_MODEL';

  const { data, error } = await supabase
    .from('model_settings')
    .select('*')
    .eq('setting_type', settingType)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    console.warn(`No ${settingType} settings found, using defaults.`);
    return useComputerUse
      ? { model_name: 'gemini-2.0-flash-exp', temperature: 0.3, setting_type: 'COMPUTER' }
      : { model_name: 'gemini-2.0-flash-exp', temperature: 0.7, setting_type: 'LIA_MODEL' };
  }
  return data;
};

// Parse action(s) from model response (for computer use mode without function calling)
function parseActionFromResponse(text: string): { action?: any; actions?: any[]; cleanText: string } | null {
  console.log('=== PARSING RESPONSE ===');
  console.log('Raw text length:', text.length);
  console.log('Raw text preview:', text.substring(0, 300));

  // Extract JSON by finding balanced braces
  function extractJSON(str: string): string | null {
    const start = str.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < str.length; i++) {
      const char = str[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          return str.substring(start, i + 1);
        }
      }
    }
    return null;
  }

  // Remove markdown code blocks if present
  let cleanedText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanedText = codeBlockMatch[1];
    console.log('Found code block, extracted:', cleanedText.substring(0, 200));
  }

  // Extract and parse JSON
  const jsonStr = extractJSON(cleanedText);
  console.log('Extracted JSON:', jsonStr ? jsonStr.substring(0, 300) : 'null');

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const cleanText = parsed.message || 'Ejecutando...';
      console.log('Parsed message:', cleanText);
      console.log('Parsed action:', parsed.action);
      console.log('Parsed actions:', parsed.actions);

      // Check for multiple actions first
      if (parsed.actions && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        console.log('✓ Multiple actions parsed:', parsed.actions.length);
        return { actions: parsed.actions, cleanText };
      }

      // Single action (can be null for chat-only responses)
      if (parsed.action && parsed.action.name) {
        console.log('✓ Single action parsed:', parsed.action.name);
        return { action: parsed.action, cleanText };
      }

      // action: null means chat response without action - this is valid
      if (parsed.action === null || parsed.action === undefined) {
        console.log('✓ Chat response (no action):', cleanText);
        return { cleanText };
      }
    } catch (e) {
      console.error('✗ Error parsing action JSON:', e);
      console.error('JSON string was:', jsonStr);
    }
  }

  // Fallback: if no JSON found, return the text as message
  console.log('✗ No valid JSON found in response');
  console.log('Full response was:', text);
  return { cleanText: text };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { messages, screenshot, url, computerUseMode, actionResult, domMap } = await req.json();

    // Determine if we should use Computer Use mode
    const useComputerUse = computerUseMode && screenshot;

    // Get settings from database based on mode
    const settings = await getLiaSettings(supabase, useComputerUse);

    // Model selection:
    // - STANDARD mode: Use model from DB (gemini-3-pro-preview for reasoning)
    // - COMPUTER mode: Use gemini-2.0-flash-exp (vision-capable, works with our prompt-based approach)
    //   Note: gemini-2.5-computer-use-preview requires Computer Use API access which isn't enabled
    const modelName = useComputerUse ? 'gemini-2.0-flash-exp' : settings.model_name;

    // Configure Gemini Client
    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });

    // Build conversation history
    const lastMessage = messages[messages.length - 1];
    const previousHistory = messages.slice(0, -1).map((msg: any) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Build current message parts
    const currentUserParts: any[] = [{ text: lastMessage.content }];

    // Add screenshot if provided
    if (screenshot) {
      currentUserParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: screenshot
        }
      });
    }

    // Add URL context
    if (url) {
      currentUserParts.push({ text: `URL actual: ${url}` });
    }

    // Add action result if this is a continuation after action execution
    if (actionResult) {
      currentUserParts.push({ text: `Resultado de la acción anterior: ${actionResult}` });
    }

    // Prepare config based on mode
    let systemInstruction: string;
    let config: any = {
      temperature: settings.temperature,
    };

    // Add thinking config if available (for models like gemini-3-pro-preview)
    // Note: column is 'thinking_le' in database
    if (settings.thinking_le && !useComputerUse) {
      config.thinkingConfig = {
        thinkingBudget: settings.thinking_le === 'high' ? 10000 :
                        settings.thinking_le === 'minimal' ? 1000 : 5000
      };
    }

    // Enable Google Search Tool (Grounding) ONLY in Standard Mode (non-Computer Use)
    if (!useComputerUse) {
        config.tools = [{ googleSearch: {} }];
    }

    console.log('Lia API - Mode:', useComputerUse ? 'COMPUTER' : 'STANDARD');
    console.log('Lia API - Model:', modelName);
    console.log('Lia API - Config:', JSON.stringify(config));

    // Fetch database context for both modes (but especially useful for computer use)
    let dbContextSummary = '';
    if (useComputerUse) {
      try {
        const dbContext = await getLiaDBContext(supabase);
        dbContextSummary = generateDBContextSummary(dbContext);
        console.log('Lia API - DB Context loaded:', dbContext.stats);
      } catch (e) {
        console.warn('Failed to load DB context:', e);
      }
    }

    if (useComputerUse) {
      // Computer Use mode - NO function calling tools, use prompt-based actions
      // Use dynamic DOM map if available, otherwise fallback to basic instructions
      const domInstructions = domMap
        ? `## Mapa de Elementos Detectados Automáticamente

${domMap}

INSTRUCCIONES:
- Usa las coordenadas exactas del mapa de elementos de arriba
- Busca el elemento que mejor coincida con lo que el usuario pide
- Las coordenadas x,y son el centro del elemento donde debes hacer clic`
        : `## No se detectaron elementos
Intenta describir la acción que deseas realizar.`;

      systemInstruction = `${COMPUTER_USE_PROMPT}

${domInstructions}

${dbContextSummary}

###########################################
# REGLA CRÍTICA - TU RESPUESTA ES SOLO JSON
###########################################

CADA respuesta tuya DEBE ser un JSON válido. NUNCA texto plano.

CORRECTO:
{"message": "Abro el menú del usuario.", "action": {"name": "click_at", "args": {"x": 112, "y": 710}}}

INCORRECTO:
Abro el menú del usuario para cambiar el tema.

Si dices que vas a hacer algo, INCLUYE LA ACCIÓN en el JSON.
Si NO hay acción que hacer, usa "action": null

#########################################
# REGLA OBLIGATORIA - LEE ESTO PRIMERO #
#########################################

CADA RESPUESTA TUYA **DEBE** CONTENER UN BLOQUE JSON.
**NUNCA** respondas solo con texto sin el JSON.

TU ROL ES DOBLE:
1. **Navegante de UI**: Si el usuario quiere ir a un sitio o rellenar algo, usa "action" o "actions".
2. **Experto Pedagógico/Creativo**:
   - Si el usuario pregunta "¿Cómo creo un prompt?", "¿Qué estructura me recomiendas?", TU RESPUESTA DEBE SER DETALLADA Y ÚTIL en el campo "message".
   - **IMPORTANTE**: Si el usuario pide investigar temas o sugerencias para un curso, tu respuesta en "message" DEBE usar **Markdown** y seguir ESTA ESTRUCTURA EXACTA para cada idea propuesta:

   ### [Título del Curso Sugerido]
   **Descripción e Idea Principal**:
   [Descripción detallada del curso...]

   **Público Objetivo**:
   [A quién va dirigido...]

   **Resultados Esperados**:
   [Qué lograrán los estudiantes...]

   ---
   (Repite si hay múltiples opciones)

3. **MEMORIA Y CONTEXTO (CRÍTICO)**:
   - **ANTES** de generar una acción, REVISA EL HISTORIAL de la conversación.
   - Si el usuario dice *"usa la opción 1"*, *"rellena con lo que investigaste"* o *"pon esa información"*, **DEBES** buscar ese contenido específico en los mensajes anteriores.
   - **NO** inventes datos si ya existen en el historial. Copia y pega el Título, Descripción y textos exactos que generaste previamente.

4. **USO DEL CONTEXTO DE BASE DE DATOS**:
   - Tienes acceso al "CONTEXTO DE LA BASE DE DATOS" que incluye artefactos existentes y estadísticas.
   - Si el usuario pregunta "¿cuántos artefactos tengo?" o "muéstrame mis cursos", USA esta información.
   - Si el usuario dice "abre mi último artefacto" o "edita el curso de Python", busca el ID en el contexto.
   - Para navegar a un artefacto específico: /admin/artifacts/[ID]
   - Ejemplos de uso:
     • "¿Cuántos artefactos tengo?" → Responde con los datos de estadísticas
     • "Abre el artefacto de Marketing" → Navega a /admin/artifacts/[ID del artefacto]
     • "¿Cuál es el estado de mis cursos?" → Lista los artefactos con sus estados

SI EL USUARIO PIDE CONSEJO O INFORMACIÓN:
- NO ejecutes acciones si no son necesarias.
- Escribe una respuesta rica, formateada con Markdown (negritas, listas, encabezados) en "message".
- Usa "action": null

SI EL USUARIO PIDE UNA ACCIÓN (Navegar, Clic, Escribir):
- Devuelve el JSON con la acción correspondiente.

## REGLA DE VERIFICACIÓN PRE-RESPUESTA (LEE ESTO PRIMERO)

**ANTES de generar tu respuesta JSON, SIEMPRE verifica:**

1. **¿El usuario mencionó un NOMBRE específico?** (artefacto, curso, elemento)
   - Si SÍ → Busca ese NOMBRE EXACTO en el mapa de elementos
   - Si lo encuentras → click_at en sus coordenadas
   - Si NO lo encuentras → scroll para buscarlo (si hay más contenido)

2. **¿El elemento que vas a clickear COINCIDE con lo que pidió el usuario?**
   - NO hagas click en "Event storming" si el usuario pidió "comedia"
   - NO hagas click en el primer elemento visible si no es el correcto

3. **¿Hay más contenido por ver?**
   - Si buscas algo y no lo ves, Y el ESTADO DE SCROLL dice "HAY MÁS CONTENIDO ABAJO"
   - DEBES hacer scroll antes de responder "no lo encontré"

## LÓGICA SEGÚN URL ACTUAL

La URL actual te dice DÓNDE está el usuario:

### CASO 1: URL contiene "/artifacts/new" (formulario de creación)
- YA ESTÁS EN EL FORMULARIO - puedes rellenar campos
- Usa "actions" (array) para escribir en múltiples campos
- Busca los campos en "CAMPOS DE TEXTO" del MAPA
- **CRÍTICO**: Tu array de actions DEBE terminar con un click_at en el botón "Generar Estructura"
- El botón "Generar Estructura" está en la sección "BOTONES DE ACCIÓN (IMPORTANTES)" del mapa
- Si NO incluyes el click en "Generar Estructura", el proceso NO iniciará
- Estructura obligatoria de actions: [type_at campo1, type_at campo2, ..., click_at "Generar Estructura"]

### CASO 2: URL es "/admin/artifacts" SIN "/new" (lista de artefactos)
- Debes hacer clic en "Nuevo Artefacto" para navegar
- NO hay campos de texto aquí - solo navegación
- BUSCA en el mapa un elemento que contenga "Nuevo" o "+" o "Artefacto"

### CASO 3: URL es "/admin" (Dashboard) u otra página
- Navega primero a la sección correcta usando el menú lateral

### CASO 4: Usuario pide CAMBIAR TEMA / MODO OSCURO / MODO CLARO
- El cambio de tema NO está en /admin/settings
- Está en el MENÚ DEL USUARIO (esquina inferior izquierda de la barra lateral)
- BUSCA en el mapa un elemento con el nombre del usuario (ej: "Fernando", "Admin", etc.)
- Haz clic ahí para abrir el menú desplegable
- Después del clic, el sistema continuará automáticamente y verás la opción "Sistema"

### CASO 5: Usuario pide ABRIR/VER un artefacto específico (SÚPER CRÍTICO)

**VERIFICACIÓN OBLIGATORIA ANTES DE RESPONDER:**
Cuando el usuario mencione un nombre de artefacto (ej: "comedia", "podcast", "python"):

PASO 1 - BUSCA EN EL MAPA:
- Lee el "Área Principal" del MAPA DE ELEMENTOS
- Busca si algún elemento contiene el texto que el usuario mencionó
- La coincidencia puede ser parcial: "comedia" coincide con "Curso de comedia stand-up"

PASO 2 - DECIDE SEGÚN LO QUE ENCUENTRES:
- SI ENCUENTRAS el artefacto en el mapa → Haz click_at en sus coordenadas
- SI NO ENCUENTRAS y hay "HAY MÁS CONTENIDO ABAJO" → HAZ SCROLL INMEDIATAMENTE
- SI NO ENCUENTRAS y ya estás al final → Dile al usuario que no existe

PASO 3 - SCROLL PARA BUSCAR:
Si decides hacer scroll, tu respuesta DEBE ser:
{"message": "Busco el artefacto '[NOMBRE]' haciendo scroll.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 500}}}

**PROHIBICIONES ABSOLUTAS:**
- ❌ NUNCA hables de un artefacto diferente al que pidió el usuario
- ❌ NUNCA respondas "no lo encontré" si el ESTADO DE SCROLL dice "HAY MÁS CONTENIDO ABAJO"
- ❌ NUNCA pidas aclaraciones - simplemente busca
- ❌ NUNCA hagas click en el primer artefacto que veas si no es el que pidió el usuario

**EJEMPLO CORRECTO:**
Usuario: "abre el artefacto de comedia"
Tú buscas "comedia" en el mapa... NO lo encuentras... pero ves "HAY MÁS CONTENIDO ABAJO"
{"message": "Busco el artefacto 'comedia' haciendo scroll.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 500}}}

**EJEMPLO INCORRECTO (NO HAGAS ESTO):**
Usuario: "abre el artefacto de comedia"
Tú buscas "comedia" en el mapa... NO lo encuentras...
{"message": "Veo el artefacto 'Event Storming', ¿es ese?", "action": null}  ← ESTO ESTÁ MAL

Si estás en otra página, primero navega a /admin/artifacts

### MENÚS DESPLEGABLES
- Algunos elementos solo aparecen después de hacer clic en otro elemento
- Si el usuario pide algo que requiere un menú desplegable, haz clic primero para abrirlo
- La continuación automática escaneará el nuevo DOM con las opciones visibles

## FORMATO DE RESPUESTA - OBLIGATORIO

Tu respuesta debe ser EXACTAMENTE un JSON así:

Para navegación o una acción:
{"message": "Explicación breve", "action": {"name": "click_at", "args": {"x": 123, "y": 456}}}

Para múltiples acciones (formularios):
{"message": "Explicación breve", "actions": [{"name": "type_at", "args": {"x": 123, "y": 456, "text": "valor"}}]}

Para responder preguntas o dar consejos (NO ACCIÓN):
{"message": "Aquí tienes una guía detallada:\n1. Paso uno...\n2. Paso dos...", "action": null}

## ACCIONES DISPONIBLES
- click_at: {"name": "click_at", "args": {"x": número, "y": número}}
- type_at: {"name": "type_at", "args": {"x": número, "y": número, "text": "texto"}}
- scroll: {"name": "scroll", "args": {"direction": "up"|"down", "amount": 400}}
- scroll_to_top: {"name": "scroll_to_top", "args": {}}
- scroll_to_bottom: {"name": "scroll_to_bottom", "args": {}}

## CUÁNDO USAR SCROLL (MUY IMPORTANTE)

### REGLA DE ORO: Si el usuario pide algo que NO ENCUENTRAS en el mapa y HAY MÁS CONTENIDO → USA SCROLL

- Si el "ESTADO DE SCROLL" indica "HAY MÁS CONTENIDO ABAJO" y NO encuentras el elemento buscado → SCROLL DOWN
- Si el usuario pide un artefacto/elemento específico (ej: "podcast", "python") y NO lo ves en el mapa → SCROLL para buscarlo
- NUNCA digas "no lo encontré" si hay más contenido por ver - PRIMERO haz scroll
- Si buscas "Generar Estructura" y no está en el mapa → scroll hacia abajo

### CASO ESPECÍFICO: Buscar artefacto en lista (/admin/artifacts)
- El usuario dice "abre el artefacto de Podcast" o "busca el de Python"
- Si NO ves ese artefacto en el mapa de elementos PERO el ESTADO DE SCROLL dice "HAY MÁS CONTENIDO ABAJO"
- **DEBES** hacer scroll para buscarlo: {"name": "scroll", "args": {"direction": "down", "amount": 500}}
- Después del scroll, el sistema te mostrará el nuevo mapa con más artefactos
- REPITE hasta encontrar el artefacto o llegar al final de la página

## EJEMPLOS COMPLETOS

Usuario en /admin/artifacts dice "crear artefacto":
{"message": "Te llevo al formulario de creación.", "action": {"name": "click_at", "args": {"x": 1238, "y": 156}}}

Usuario pregunta "¿Cómo creo un buen prompt?":
{"message": "Para crear un buen prompt educativo, sigue esta estructura:\n\n1. **Rol**: Define quién enseña.\n2. **Audiencia**: A quién va dirigido.\n3. **Objetivo**: Qué deben aprender.", "action": null}

Usuario en /admin/artifacts/new pide crear curso con información específica:
{"message": "Relleno el formulario e inicio la generación.", "actions": [
  {"name": "type_at", "args": {"x": 720, "y": 471, "text": "Título del curso aquí"}},
  {"name": "type_at", "args": {"x": 720, "y": 584, "text": "Descripción detallada del curso..."}},
  {"name": "type_at", "args": {"x": 550, "y": 733, "text": "Público objetivo"}},
  {"name": "type_at", "args": {"x": 890, "y": 733, "text": "Resultados esperados"}},
  {"name": "click_at", "args": {"x": 720, "y": 850}}
]}
↑↑↑ NOTA: El ÚLTIMO elemento SIEMPRE es click_at en "Generar Estructura" ↑↑↑

### REGLA OBLIGATORIA para /admin/artifacts/new:
1. Rellena TODOS los campos: Título, Descripción, Público Objetivo, Resultados Esperados
2. **SIEMPRE** termina con click_at en el botón "Generar Estructura"
3. Busca "Generar Estructura" en la sección "BOTONES DE ACCIÓN (IMPORTANTES)" del MAPA
4. Usa las coordenadas exactas que aparecen en el mapa para el botón
5. Si no incluyes este click, el formulario NO se enviará y la tarea estará INCOMPLETA

Usuario dice "hola":
{"message": "¡Hola! Soy Lia. ¿En qué puedo ayudarte hoy?", "action": null}

Usuario pregunta "¿cuántos artefactos tengo?" (usa CONTEXTO DE BD):
{"message": "Tienes **5 artefactos** en total:\n• 1 en generación\n• 2 aprobados\n• 2 pendientes de revisión\n\n¿Quieres que te muestre alguno en particular?", "action": null}

Usuario dice "abre mi último artefacto" o "muéstrame el curso de Python" (usa CONTEXTO DE BD):
(Buscar el ID del artefacto en el CONTEXTO DE LA BASE DE DATOS, ej: abc123-def456...)
{"message": "Te llevo al artefacto 'Curso de Python'.", "action": {"name": "click_at", "args": {"x": X_DEL_LINK, "y": Y_DEL_LINK}}}
(O navegar directamente si conoces la URL: el usuario puede ir a /admin/artifacts/[ID])

Usuario pide "cambia a modo oscuro" o "pon tema oscuro":
(Buscar en el mapa el nombre del usuario, ej: "Fernando")
{"message": "Abro el menú del usuario para cambiar el tema.", "action": {"name": "click_at", "args": {"x": ..., "y": ...}}}
(Luego la continuación automática verá "Sistema" en el menú y hará clic)

Usuario en /admin/artifacts dice "abre el artefacto de Podcast" pero NO lo ve en el mapa:
PRIMERO: Busco "Podcast" en el Área Principal del mapa... NO ESTÁ
SEGUNDO: Veo en ESTADO DE SCROLL: "⬇️ HAY MÁS CONTENIDO ABAJO"
ENTONCES: Hago scroll para buscarlo
{"message": "Busco el artefacto 'Podcast' haciendo scroll.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 500}}}
(El sistema continuará, escaneará nuevos elementos, y seguirá buscando)

Usuario dice "abre el artefacto de comedia" y el mapa muestra: "Event storming", "Python básico", "Marketing"
PRIMERO: Busco "comedia" en el mapa... NO ESTÁ (ninguno de los elementos contiene "comedia")
SEGUNDO: Veo en ESTADO DE SCROLL: "⬇️ HAY MÁS CONTENIDO ABAJO"
ENTONCES: NO hago click en ninguno de estos, hago scroll para buscar "comedia"
{"message": "No veo el artefacto 'comedia' aquí, busco más abajo.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 500}}}
⚠️ ERROR SI HICIERAS: {"message": "Veo Event storming, ¿te refieres a este?", "action": null} ← INCORRECTO

Usuario pide algo que NO está visible en el mapa (scroll necesario):
(Si el ESTADO DE SCROLL indica "HAY MÁS CONTENIDO ABAJO")
{"message": "Busco el elemento haciendo scroll hacia abajo.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 400}}}
(Después del scroll, el sistema continuará y escaneará nuevos elementos)

Usuario dice "baja" o "scroll hacia abajo":
{"message": "Haciendo scroll hacia abajo.", "action": {"name": "scroll", "args": {"direction": "down", "amount": 400}}}

Usuario dice "ve al final de la página":
{"message": "Yendo al final de la página.", "action": {"name": "scroll_to_bottom", "args": {}}}

## CONTINUACIONES AUTOMÁTICAS

Cuando recibas un mensaje que empiece con "[CONTINUACIÓN AUTOMÁTICA]":
- Significa que acabas de navegar a una nueva página
- El mensaje incluye lo que el usuario ORIGINALMENTE pidió
- DEBES continuar con la siguiente acción necesaria para completar la solicitud original
- Usa la información de la CONVERSACIÓN ANTERIOR para rellenar formularios

## MENSAJE FINAL (MUY IMPORTANTE)

Cuando completes la ÚLTIMA acción de un flujo multi-paso:
- Tu "message" debe ser un RESUMEN de TODO lo que hiciste
- El usuario solo verá ESTE mensaje, no los intermedios
- Sé claro y conciso, ejemplo:
  "He completado tu solicitud:
   • Navegué al formulario de creación
   • Rellené los campos con la información del curso de Python
   • Inicié la generación del artefacto

   El proceso de generación está en marcha."

Si es la última acción (formulario completo, botón presionado, etc.), escribe un resumen útil.

### Ejemplos de continuación según la página:

En /admin/artifacts (lista):
{"message": "Ahora hago clic en Nuevo Artefacto.", "action": {"name": "click_at", "args": {"x": 1627, "y": 85}}}

En /admin/artifacts/new (formulario) - SI el usuario pidió crear con información:
{"message": "He completado tu solicitud:\n• Rellené el formulario con la información investigada\n• Inicié la generación del artefacto\n\nEl proceso está en marcha.", "actions": [
  {"name": "type_at", "args": {"x": ..., "y": ..., "text": "Título basado en la investigación"}},
  {"name": "type_at", "args": {"x": ..., "y": ..., "text": "Descripción basada en la investigación"}},
  {"name": "type_at", "args": {"x": ..., "y": ..., "text": "Público objetivo"}},
  {"name": "type_at", "args": {"x": ..., "y": ..., "text": "Resultados esperados"}},
  {"name": "click_at", "args": {"x": COORDENADA_X_DEL_BOTON, "y": COORDENADA_Y_DEL_BOTON}}
]}
↑↑↑ EL ÚLTIMO ELEMENTO ES click_at EN "Generar Estructura" - OBLIGATORIO ↑↑↑

### CRÍTICO en continuaciones hacia /admin/artifacts/new:
1. Usa la información de mensajes anteriores (investigación, datos del usuario)
2. Rellena TODOS los campos: Título, Descripción, Público Objetivo, Resultados
3. **EL ÚLTIMO ELEMENTO DEL ARRAY DEBE SER click_at en "Generar Estructura"**
4. Busca "Generar Estructura" en la sección "BOTONES DE ACCIÓN (IMPORTANTES)" del mapa
5. Copia las coordenadas EXACTAS del botón (x=..., y=...) que aparecen en el mapa
6. SIN ESTE CLICK FINAL, LA TAREA ESTÁ INCOMPLETA

## RECUERDA
1. USA las coordenadas del MAPA DE ELEMENTOS - no inventes coordenadas
2. Tu respuesta es SOLO el JSON, sin texto adicional antes o después
3. Busca el botón "Nuevo Artefacto" o similar en el mapa cuando el usuario quiera crear
4. En CONTINUACIONES, ejecuta la siguiente acción lógica sin preguntar
5. **EN /artifacts/new**: Tu array de actions DEBE terminar con click_at en "Generar Estructura"
6. **SCROLL**: Si buscas algo que NO está en el mapa Y hay "MÁS CONTENIDO ABAJO" → HAZ SCROLL PRIMERO, nunca digas "no encontré" sin haber scrolleado`;
    } else {
      // Standard mode - simple chat without tools
      systemInstruction = SYSTEM_PROMPT;
    }

    // Build contents with system instruction
    const contents = [
      { role: 'user', parts: [{ text: systemInstruction }] },
      { role: 'model', parts: [{ text: 'Entendido. Soy Lia, tu asistente de CourseForge. ¿En qué puedo ayudarte?' }] },
      ...previousHistory,
      { role: 'user', parts: currentUserParts }
    ];

    // Generate response
    const response = await client.models.generateContent({
      model: modelName,
      contents: contents,
      config: config
    });

    const responseText = response.text || '';

    // For computer use mode, check if response contains action(s)
    if (useComputerUse) {
      const parsed = parseActionFromResponse(responseText);
      if (parsed) {
        const responseData: any = {
          message: {
            role: 'model',
            content: parsed.cleanText,
            timestamp: new Date().toISOString()
          }
        };

        // Include single action or multiple actions
        if (parsed.actions) {
          responseData.actions = parsed.actions;
        } else if (parsed.action) {
          responseData.action = parsed.action;
        }

        // Log exactly what we're sending to the frontend
        console.log('=== SENDING TO FRONTEND ===');
        console.log('Response data:', JSON.stringify(responseData, null, 2));

        return NextResponse.json(responseData);
      }
    }

    // Standard text response
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    let sources: { title: string; url: string }[] = [];

    if (groundingMetadata?.groundingChunks) {
        sources = groundingMetadata.groundingChunks
            .filter((chunk: any) => chunk.web?.uri)
            .map((chunk: any) => ({
                title: chunk.web?.title || new URL(chunk.web.uri).hostname,
                url: chunk.web.uri
            }));
    }

    // Clean up response if model accidentally responded with JSON in standard mode
    let cleanContent = responseText;
    const trimmedResponse = responseText.trim();

    // Check if response looks like JSON wrapper
    if (trimmedResponse.startsWith('{"message"') ||
        (trimmedResponse.startsWith('{') && trimmedResponse.includes('"message"'))) {
      try {
        const parsed = JSON.parse(trimmedResponse);
        if (parsed.message) {
          cleanContent = parsed.message;
          console.log('Cleaned JSON from standard mode response (parsed)');
        }
      } catch (e) {
        // JSON parsing failed - try manual extraction
        // Find the start of message content after {"message": "
        const startMatch = trimmedResponse.match(/^\s*\{\s*"message"\s*:\s*"/);
        if (startMatch) {
          // Find where the message ends - look for ", "action" or just the closing
          let content = trimmedResponse.substring(startMatch[0].length);

          // Remove the trailing ", "action": null} or similar
          content = content.replace(/",\s*"action"\s*:\s*null\s*\}\s*$/, '');
          content = content.replace(/"\s*,\s*"action"\s*:\s*null\s*\}\s*$/, '');
          content = content.replace(/"\s*\}\s*$/, ''); // Just {"message": "text"}

          // Unescape JSON string escapes
          cleanContent = content
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/\\t/g, '\t');

          console.log('Cleaned JSON from standard mode response (manual extraction)');
        }
      }
    }

    return NextResponse.json({
      message: {
        role: 'model',
        content: cleanContent,
        timestamp: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined
      }
    });

  } catch (error: any) {
    console.error('Error in Lia API:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
