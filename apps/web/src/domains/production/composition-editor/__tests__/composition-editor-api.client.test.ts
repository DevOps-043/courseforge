import assert from "node:assert/strict";
import test from "node:test";
import { readCompositionApiResponse } from "../composition-editor-api.client";

test("composition API responses preserve valid JSON contracts", async () => {
  const result = await readCompositionApiResponse<{ data: { id: string } }>(
    Response.json({ data: { id: "revision-1" } }),
    "No se pudo cargar.",
  );

  assert.equal(result.data.id, "revision-1");
});

test("composition API responses classify missing deployments", async () => {
  await assert.rejects(
    () => readCompositionApiResponse(
      new Response("Not found", { status: 404, headers: { "content-type": "text/html" } }),
      "No se pudo cargar.",
    ),
    /endpoint de snapshots no está disponible/,
  );
});

test("composition API responses reject malformed JSON predictably", async () => {
  await assert.rejects(
    () => readCompositionApiResponse(
      new Response("{", { headers: { "content-type": "application/json" } }),
      "No se pudo cargar.",
    ),
    /JSON inválido/,
  );
});
