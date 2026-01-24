import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, COMPUTER_USE_PROMPT } from '@/lib/lia-app-context';

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

// Parse action from model response (for computer use mode without function calling)
function parseActionFromResponse(text: string): { action: any; cleanText: string } | null {
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
  }

  // Extract and parse JSON
  const jsonStr = extractJSON(cleanedText);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.action && parsed.action.name) {
        const cleanText = parsed.message || 'Ejecutando...';
        console.log('Action parsed:', parsed.action);
        return { action: parsed.action, cleanText };
      }
    } catch (e) {
      console.error('Error parsing action JSON:', e, jsonStr);
    }
  }

  console.log('No action found in response:', text.substring(0, 200));
  return null;
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

    console.log('Lia API - Mode:', useComputerUse ? 'COMPUTER' : 'STANDARD');
    console.log('Lia API - Model:', modelName);
    console.log('Lia API - Config:', JSON.stringify(config));

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

## OBLIGATORIO: Formato de Respuesta para Acciones

SIEMPRE que el usuario pida navegar o interactuar con algún elemento, DEBES responder con este formato JSON:

\`\`\`json
{"message": "Te llevo a [sección]", "action": {"name": "click_at", "args": {"x": [número], "y": [número]}}}
\`\`\`

ACCIONES DISPONIBLES:
- click_at: {"name": "click_at", "args": {"x": número, "y": número}}
- type_text: {"name": "type_text", "args": {"text": "texto a escribir"}}
- scroll: {"name": "scroll", "args": {"direction": "up" | "down", "amount": número}}

EJEMPLO DE RESPUESTA CORRECTA:
\`\`\`json
{"message": "Te llevo a Configuración", "action": {"name": "click_at", "args": {"x": 105, "y": 311}}}
\`\`\`

IMPORTANTE:
- SIEMPRE usa las coordenadas del mapa de elementos detectados
- NO respondas solo con texto si el usuario pide navegar
- SIEMPRE incluye el bloque JSON con la acción correspondiente`;
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

    // For computer use mode, check if response contains an action
    if (useComputerUse) {
      const parsed = parseActionFromResponse(responseText);
      if (parsed) {
        return NextResponse.json({
          message: {
            role: 'model',
            content: parsed.cleanText,
            timestamp: new Date().toISOString()
          },
          action: parsed.action
        });
      }
    }

    // Standard text response
    return NextResponse.json({
      message: {
        role: 'model',
        content: responseText,
        timestamp: new Date().toISOString()
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
