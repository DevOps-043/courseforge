import assert from "node:assert/strict";
import test from "node:test";
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

test("usa Terra para una configuración histórica", async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const openai = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        capturedRequest = request;
        return { status: "completed", output_text: '{"modules":[]}' };
      },
    },
  } as unknown as OpenAI;

  const result = await generateSyllabusJson({
    clients: { openai },
    model: "gemini-3.5-flash",
    prompt: "Genera JSON",
    temperature: 0.7,
  });

  assert.equal(result, '{"modules":[]}');
  assert.equal(capturedRequest?.model, "gpt-6.1-terra");
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
          output: [
            { type: "web_search_call", action: { type: "search", queries: ["tema", "documentación"] } },
            { type: "message", content: [{ type: "output_text", annotations: [
              { type: "url_citation", title: "Referencia", url: "https://example.org/tema" },
              { type: "url_citation", title: "Inválida", url: "javascript:void(0)" },
            ] }] },
          ],
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
  assert.deepEqual(result.searchQueries, ["tema", "documentación"]);
  assert.deepEqual(result.groundingMetadata.citations, [{ title: "Referencia", url: "https://example.org/tema" }]);
  assert.deepEqual(capturedRequest?.tools, [{ type: "web_search" }]);
});
