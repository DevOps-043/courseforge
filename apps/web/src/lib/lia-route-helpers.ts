import { SYSTEM_PROMPT } from "@/lib/lia-app-context";
import { buildComputerUseSystemInstruction } from "@/lib/lia-route-instructions";

interface LiaMessage {
  role: string;
  content: string;
}

interface LiaRequestPayload {
  actionResult?: string;
  computerUseMode?: boolean;
  domMap?: string;
  messages: LiaMessage[];
  screenshot?: string;
  url?: string;
}

export function getActiveOrgIdFromCookieHeader(cookieHeader: string) {
  const match = cookieHeader.match(/(?:^|;\s*)cf_active_org=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildLiaConfig(settings: any, useComputerUse: boolean) {
  const config: any = {
    temperature: settings.temperature,
  };

  if (settings.thinking_le && !useComputerUse) {
    config.thinkingConfig = {
      thinkingBudget:
        settings.thinking_le === "high"
          ? 10000
          : settings.thinking_le === "minimal"
            ? 1000
            : 5000,
    };
  }

  if (!useComputerUse) {
    config.tools = [{ googleSearch: {} }];
  }

  return config;
}

export function buildConversationPrompt(
  payload: LiaRequestPayload,
  systemInstruction: string,
) {
  const lastMessage = payload.messages[payload.messages.length - 1];
  const historyText = payload.messages
    .slice(0, -1)
    .map(
      (message) =>
        `${message.role === "model" ? "Asistente" : "Usuario"}: ${message.content || ""}`,
    )
    .join("\n\n");

  const currentMessageParts = [lastMessage?.content || ""];

  if (payload.url) {
    currentMessageParts.push(`URL actual: ${payload.url}`);
  }

  if (payload.actionResult) {
    currentMessageParts.push(
      `Resultado de la acciÃ³n anterior: ${payload.actionResult}`,
    );
  }

  const currentMessageText = currentMessageParts.filter(Boolean).join("\n");

  return `${systemInstruction}

${historyText ? `--- CONVERSACIÃ“N PREVIA ---\n${historyText}\n` : ""}--- MENSAJE DEL USUARIO ---
${currentMessageText}

--- TU RESPUESTA ---`;
}

export function buildSystemInstruction(
  useComputerUse: boolean,
  domMap?: string,
  dbContextSummary?: string,
) {
  return useComputerUse
    ? buildComputerUseSystemInstruction(domMap, dbContextSummary)
    : SYSTEM_PROMPT;
}

export function buildHallucinationOverrideResponse(
  domMap: string,
  searchTerm: string,
) {
  const searchFieldMatch = domMap.match(
    /\[Campo: Buscar por tÃ­tulo\.\.\.\] â†’ type_at x=(\d+), y=(\d+)/,
  );

  if (searchFieldMatch) {
    return {
      message: {
        role: "model",
        content: `Busco el artefacto '${searchTerm}' usando el buscador.`,
        timestamp: new Date().toISOString(),
      },
      action: {
        name: "type_at",
        args: {
          x: parseInt(searchFieldMatch[1]),
          y: parseInt(searchFieldMatch[2]),
          text: searchTerm,
        },
      },
    };
  }

  if (domMap.toLowerCase().includes("hay mÃ¡s contenido abajo")) {
    return {
      message: {
        role: "model",
        content: `Busco el artefacto '${searchTerm}' haciendo scroll.`,
        timestamp: new Date().toISOString(),
      },
      action: {
        name: "scroll",
        args: { direction: "down", amount: 500 },
      },
    };
  }

  return null;
}

export function buildComputerUseResponse(parsed: {
  action?: any;
  actions?: any[];
  cleanText: string;
}) {
  const responseData: any = {
    message: {
      role: "model",
      content: parsed.cleanText,
      timestamp: new Date().toISOString(),
    },
  };

  if (parsed.actions) {
    responseData.actions = parsed.actions;
  } else if (parsed.action) {
    responseData.action = parsed.action;
  }

  return responseData;
}

export function extractGroundingSources(groundingMetadata: any) {
  if (!groundingMetadata?.groundingChunks) {
    return [];
  }

  return groundingMetadata.groundingChunks
    .filter((chunk: any) => chunk.web?.uri)
    .map((chunk: any) => ({
      title: chunk.web?.title || new URL(chunk.web.uri).hostname,
      url: chunk.web.uri,
    }));
}

export function cleanStandardResponse(responseText: string) {
  let cleanContent = responseText;
  const trimmedResponse = responseText.trim();

  if (
    trimmedResponse.startsWith('{"message"') ||
    (trimmedResponse.startsWith("{") &&
      trimmedResponse.includes('"message"'))
  ) {
    try {
      const parsed = JSON.parse(trimmedResponse);
      if (parsed.message) {
        cleanContent = parsed.message;
      }
    } catch {
      const startMatch = trimmedResponse.match(/^\s*\{\s*"message"\s*:\s*"/);
      if (startMatch) {
        let content = trimmedResponse.substring(startMatch[0].length);
        content = content.replace(/",\s*"action"\s*:\s*null\s*\}\s*$/, "");
        content = content.replace(/"\s*,\s*"action"\s*:\s*null\s*\}\s*$/, "");
        content = content.replace(/"\s*\}\s*$/, "");
        cleanContent = content
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .replace(/\\t/g, "\t");
      }
    }
  }

  return cleanContent;
}
