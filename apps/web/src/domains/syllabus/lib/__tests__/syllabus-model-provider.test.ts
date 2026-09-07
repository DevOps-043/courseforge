import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import {
  generateSyllabusJson,
  generateSyllabusResearch,
} from "../syllabus-model-provider";

test("envia modelos GPT al cliente OpenAI", async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const openai = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        capturedRequest = request;
        return {
          id: "response-test",
          incomplete_details: null,
          output_text: '{"modules":[]}',
          status: "completed",
        };
      },
    },
  } as unknown as OpenAI;

  const result = await generateSyllabusJson({
    clients: { openai },
    model: "gpt-5.6-luna",
    prompt: "Genera JSON",
    temperature: 0.7,
  });

  assert.equal(result, '{"modules":[]}');
  assert.equal(capturedRequest?.model, "gpt-5.6-luna");
  assert.deepEqual(capturedRequest?.text, {
    format: { type: "json_object" },
  });
});

test("envia modelos Gemini al cliente Google", async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const gemini = {
    models: {
      generateContent: async (request: Record<string, unknown>) => {
        capturedRequest = request;
        return { text: '{"modules":[]}' };
      },
    },
  } as unknown as GoogleGenAI;

  const result = await generateSyllabusJson({
    clients: { gemini },
    model: "gemini-3.5-flash",
    prompt: "Genera JSON",
    temperature: 0.7,
  });

  assert.equal(result, '{"modules":[]}');
  assert.equal(capturedRequest?.model, "gemini-3.5-flash");
});

test("usa web_search de OpenAI durante la investigacion", async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const openai = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        capturedRequest = request;
        return {
          id: "research-test",
          output_text: "Contexto investigado",
        };
      },
    },
  } as unknown as OpenAI;

  const result = await generateSyllabusResearch({
    clients: { openai },
    model: "gpt-5.6-luna",
    prompt: "Investiga",
    temperature: 0.7,
  });

  assert.equal(result.text, "Contexto investigado");
  assert.deepEqual(capturedRequest?.tools, [{ type: "web_search" }]);
});
