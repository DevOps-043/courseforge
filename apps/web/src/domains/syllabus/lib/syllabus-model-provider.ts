import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { getTextModelProvider } from "../../../shared/ai/text-model-provider";

export interface SyllabusModelClients {
  gemini?: GoogleGenAI;
  openai?: OpenAI;
}

export interface SyllabusResearchResult {
  groundingMetadata?: unknown;
  searchQueries: string[];
  text: string;
}

function requireProviderClient(
  clients: SyllabusModelClients,
  model: string,
) {
  const provider = getTextModelProvider(model);
  if (!provider) {
    throw new Error(
      `UNSUPPORTED_SYLLABUS_MODEL: ${model} no pertenece a un proveedor implementado.`,
    );
  }

  if (provider === "gemini" && clients.gemini) {
    return { client: clients.gemini, provider } as const;
  }

  if (provider === "openai" && clients.openai) {
    return { client: clients.openai, provider } as const;
  }

  if (!clients[provider]) {
    throw new Error(
      `MISSING_${provider.toUpperCase()}_CLIENT: falta configurar el cliente requerido por ${model}.`,
    );
  }

  throw new Error(`No se pudo resolver el cliente para ${model}.`);
}

export async function generateSyllabusResearch(params: {
  clients: SyllabusModelClients;
  model: string;
  prompt: string;
  temperature: number;
}): Promise<SyllabusResearchResult> {
  const { clients, model, prompt, temperature } = params;
  const resolved = requireProviderClient(clients, model);

  if (resolved.provider === "gemini") {
    const response = await resolved.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature,
      },
    });
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata as
      | { webSearchQueries?: string[] }
      | undefined;

    return {
      text: response.text || "",
      searchQueries: groundingMetadata?.webSearchQueries || [],
      groundingMetadata,
    };
  }

  const response = await resolved.client.responses.create({
    model,
    input: prompt,
    max_output_tokens: 5000,
    tools: [{ type: "web_search" }],
  });

  return {
    text: response.output_text || "",
    searchQueries: [],
    groundingMetadata: {
      provider: "openai",
      response_id: response.id,
    },
  };
}

export async function generateSyllabusJson(params: {
  clients: SyllabusModelClients;
  model: string;
  prompt: string;
  temperature: number;
}) {
  const { clients, model, prompt, temperature } = params;
  const resolved = requireProviderClient(clients, model);

  if (resolved.provider === "gemini") {
    const response = await resolved.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature,
        responseMimeType: "application/json",
      },
    });

    return response.text || "";
  }

  const response = await resolved.client.responses.create({
    model,
    input: prompt,
    max_output_tokens: 16000,
    text: { format: { type: "json_object" } },
  });

  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens"
  ) {
    throw new Error(
      `TRUNCATED_SYLLABUS_RESPONSE: ${model} alcanzo el limite de salida antes de completar el JSON.`,
    );
  }

  return response.output_text || "";
}
