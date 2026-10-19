import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeygenClient, HeygenApiError } from "../heygen.client";
import { resolveExternalVideoSource } from "../heygen-external-import-source";

describe("Resolución de importación externa HeyGen", () => {
  const unexpectedLookup = async (): Promise<never> => { throw new Error("Consulta inesperada a HeyGen"); };

  it("prioriza URL explícita sin consultar credenciales, incluso con ID", async () => {
    for (const provider of ["heygen", "custom"] as const) {
      assert.deepEqual(await resolveExternalVideoSource({ provider, videoId: "video-1", videoUrl: "https://cdn.example/video.mp4" }, unexpectedLookup),
        { status: "ready", url: "https://cdn.example/video.mp4" });
    }
  });

  it("conserva URLs enviadas en videoId", async () => {
    assert.deepEqual(await resolveExternalVideoSource({ provider: "heygen", videoId: "https://cdn.example/legacy.mp4" }, unexpectedLookup),
      { status: "ready", url: "https://cdn.example/legacy.mp4" });
  });

  it("no consulta el proveedor si falta una fuente utilizable", async () => {
    for (const input of [{ provider: "heygen" }, { provider: "custom", videoId: "video-1" }] as const) {
      assert.deepEqual(await resolveExternalVideoSource(input, unexpectedLookup), { status: "missing" });
    }
  });

  it("consulta GET v3 con ID codificado y utiliza la URL completada", async () => {
    const client = new HeygenClient({ apiKey: "test-organization-key", fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.heygen.com/v3/videos/video%2F1");
      assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("X-Api-Key"), "test-organization-key");
      return Response.json({ data: { status: "completed", video_url: "https://cdn.heygen.com/final.mp4" } });
    } });
    assert.deepEqual(await resolveExternalVideoSource({ provider: "heygen", videoId: "video/1" }, (id) => client.getVideo(id)),
      { status: "ready", url: "https://cdn.heygen.com/final.mp4" });
  });

  it("distingue pendientes, completados sin URL y fallidos", async () => {
    for (const status of ["waiting", "processing", "completed", "failed"] as const) {
      assert.deepEqual(await resolveExternalVideoSource({ provider: "heygen", videoId: "video-1" },
        async () => ({ status, raw: {}, videoId: "video-1" })), { status: status === "failed" ? "failed" : "pending" });
    }
  });

  it("propaga errores de credenciales y proveedor sin convertirlos en pendientes", async () => {
    for (const failure of [new Error("Sin credencial"), new HeygenApiError({ message: "Límite", status: 429 })]) {
      await assert.rejects(resolveExternalVideoSource({ provider: "heygen", videoId: "video-1" }, async () => { throw failure; }), (error) => error === failure);
    }
  });
});
