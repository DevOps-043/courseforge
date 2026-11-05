import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audio, identityErrors, mediaBucket, mediaFixture, mediaId, mediaRoutes, organizationId, sfx, signedUrl, tenantErrors, waveform, waveformJobs } from "./media-authority-http.fixture";

const zeroEffects = { clients: 0, reads: 0, signs: 0, writes: 0, jobs: 0, audit: 0, context: 0 };
describe("autoridad HTTP en medios, descargas, audio y SFX", () => {
  for (const route of mediaRoutes) {
    it(`${route.method} ${route.path}: caída de autoridad detiene efectos`, async () => {
      for (const stage of route.stages) for (const ErrorType of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
        const failure = new ErrorType(); failure.message = "detalle-sensible-sintetico";
        const f = mediaFixture(route, { stage, failure }); const response = await f.run();
        assert.equal(response.status, 503, `${route.path}/${route.method}/${stage}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-request-id"), "medio-test");
        const body = await response.json(); assert.equal(body.retryable, true); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
        assert.doesNotMatch(JSON.stringify(body), /detalle-sensible|token=|storage_path/); assert.deepEqual(f.effects, zeroEffects);
      }
    });
  }
  it("conserva denegaciones de identidad, tenant, revisión y componente", async () => {
    for (const route of mediaRoutes) for (const missingAt of route.stages) {
      const f = mediaFixture(route, { missingAt });
      assert.equal((await f.run()).status, { identity: 401, tenant: 403, role: 403, component: 404 }[missingAt]);
      assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("conserva redirects privados, TTL, download y auditoría", async () => {
    const paths = ["storage/media", "production/assets/[assetId]/download", "production/sound-effects/[soundEffectId]/preview", "production/sound-effects/[soundEffectId]/download"];
    for (const path of paths) {
      const route = mediaRoutes.find(route => route.path === path)!;
      const f = mediaFixture(route); const response = await f.run();
      assert.equal(response.status, path.endsWith("preview") ? 302 : 307); assert.equal(response.headers.get("location"), signedUrl);
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-request-id"), "medio-test");
      assert.equal(await response.text(), ""); assert.equal(f.signatures.length, 1);
      assert.equal(f.signatures[0].ttl, path === "storage/media" ? 600 : 300);
      assert.equal(f.signatures[0].download, path.includes("assets/") ? "descarga.wav" : path.endsWith("download") ? "sonido.wav" : undefined);
      assert.equal(f.effects.audit, path.endsWith("download") ? 1 : 0);
      if (path.includes("assets/")) assert.ok(f.filters.some(filter => filter.column === "organization_id" && filter.value === organizationId));
    }
  });
  it("un fallo de auditoría no altera la entrega autorizada existente", async () => {
    for (const route of mediaRoutes.filter(route => route.path.endsWith("download"))) {
      assert.equal((await mediaFixture(route, { auditError: new Error("detalle-sensible-sintetico") }).run()).status, 307);
    }
  });
  it("media rechaza paths ajenos o inválidos sin firmar", async () => {
    const route = mediaRoutes.find(route => route.path === "storage/media")!;
    for (const [path, status] of [["voices/ajeno.wav", 403], ["../secreto.wav", 400]]) {
      const f = mediaFixture(route); const response = await f.run(new Request(`https://example.invalid/?bucket=${mediaBucket}&componentId=${mediaId}&path=${path}`));
      assert.equal(response.status, status); assert.equal(f.effects.signs, 0);
    }
    for (const route of mediaRoutes.filter(route => route.path.endsWith("download") || route.path.endsWith("preview"))) {
      const f = mediaFixture(route, { storagePath: "../ajeno.wav" }); assert.equal((await f.run()).status, 500); assert.equal(f.effects.signs, 0);
    }
  });
  it("conserva consulta waveform y estados de análisis sin audio o pendientes", async () => {
    const route = mediaRoutes.find(route => route.path.includes("audio-analysis") && route.method === "GET")!;
    const response = await mediaFixture(route).run(); assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, { testMarker: "waveform" });
    for (const [status, output, expected] of [["PENDING", {}, "PENDING"], ["SUCCEEDED", { status: "NO_AUDIO" }, "NO_AUDIO"]] as const) {
      const f = mediaFixture(route, { job: { status, output_snapshot: output } });
      const result = await f.run(new Request(`https://example.invalid/?componentId=${mediaId}&jobId=${mediaId}`));
      const body = await result.json();
      assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.deepEqual(body.data, null); assert.equal(body.status, expected);
      assert.ok(f.filters.some(filter => filter.column === "organization_id" && filter.value === organizationId));
    }
  });
  it("conserva los 202 de creación y la consulta sin trabajo solicitado", async () => {
    for (const route of mediaRoutes.filter(route => route.method === "POST" && /audio-analysis|audio-processing/.test(route.path))) {
      const f = mediaFixture(route); const response = await f.run(); assert.equal(response.status, 202);
      assert.equal((await response.json()).data.jobId, mediaId); assert.equal(f.effects.jobs, 1);
    }
    const route = mediaRoutes.find(route => route.path.includes("audio-processing") && route.method === "GET")!;
    const response = await mediaFixture(route).run(); assert.equal(response.status, 200); assert.equal((await response.json()).data.status, "NOT_REQUESTED");
  });
  it("un contexto de componente de otra organización no encola trabajos", async () => {
    for (const route of mediaRoutes.filter(route => route.method === "POST" && /audio-analysis|audio-processing/.test(route.path))) {
      const f = mediaFixture(route, { contextOrganizationId: mediaId });
      assert.equal((await f.run()).status, 404); assert.equal(f.effects.jobs, 0); assert.equal(f.effects.writes, 0);
    }
  });
  it("conserva validación JSON, filtros y ventanas inválidas", async () => {
    for (const route of mediaRoutes.filter(route => route.method === "POST")) {
      const f = mediaFixture(route); const response = await f.run(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      assert.equal(response.status, 400); assert.equal(f.effects.writes, 0); assert.equal(f.effects.jobs, 0);
    }
    const getSfx = mediaRoutes.find(route => route.path === "production/sound-effects" && route.method === "GET")!;
    assert.equal((await mediaFixture(getSfx).run(new Request("https://example.invalid/?limit=0"))).status, 400);
    const getWaveform = mediaRoutes.find(route => route.path.includes("audio-analysis") && route.method === "GET")!;
    const f = mediaFixture(getWaveform); assert.equal((await f.run(new Request(`https://example.invalid/?componentId=${mediaId}&width=0`))).status, 400);
    assert.equal(f.effects.reads, 0);
  });
  it("preserva biblioteca, enlace JSON y multipart SFX", async () => {
    const get = mediaRoutes.find(route => route.path === "production/sound-effects" && route.method === "GET")!;
    assert.deepEqual((await (await mediaFixture(get).run()).json()).data, []);
    const post = mediaRoutes.find(route => route.path === "production/sound-effects" && route.method === "POST")!;
    assert.equal((await mediaFixture(post).run()).status, 200);
    const form = new FormData(); form.set("file", new File(["WAV-sintetico"], "sonido.wav")); form.set("category", "UI"); form.set("name", "Sonido");
    const f = mediaFixture(post); assert.equal((await f.run(new Request("https://example.invalid", { method: "POST", body: form }))).status, 201); assert.equal(f.effects.writes, 1);
    assert.equal((await mediaFixture(post).run(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }))).status, 415);
    assert.equal((await mediaFixture(post).run(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(28 * 1024 * 1024) } }))).status, 413);
  });
  it("mantiene errores propios de audio y SFX", async () => {
    const audioPost = mediaRoutes.find(route => route.path.includes("audio-processing") && route.method === "POST")!;
    for (const [code, status] of [["AUDIO_SOURCE_NOT_FOUND", 404], ["AUDIO_SOURCE_TOO_LARGE", 413], ["AUDIO_TENANT_UNRESOLVED", 409]] as const) {
      assert.equal((await mediaFixture(audioPost, { domainError: new audio.AudioProcessingJobError(code, "Audio rechazado.") }).run()).status, status);
    }
    const waveformGet = mediaRoutes.find(route => route.path.includes("audio-analysis") && route.method === "GET")!;
    assert.equal((await mediaFixture(waveformGet, { domainError: new waveform.AudioWaveformReadError(422, "Audio rechazado.") }).run()).status, 422);
    const waveformPost = mediaRoutes.find(route => route.path.includes("audio-analysis") && route.method === "POST")!;
    assert.equal((await mediaFixture(waveformPost, { domainError: new waveformJobs.WaveformSourceError("Audio rechazado.") }).run()).status, 422);
    const sfxPost = mediaRoutes.find(route => route.path === "production/sound-effects" && route.method === "POST")!;
    for (const status of [404, 409, 500]) assert.equal((await mediaFixture(sfxPost, { domainError: new sfx.SoundEffectLibraryError("Efecto rechazado.", status) }).run()).status, status);
  });
  it("errores genéricos o códigos falsos de autoridad conservan 500 seguro", async () => {
    for (const route of mediaRoutes) for (const domainError of [new Error("detalle-sensible-sintetico"), { code: "TENANT_LOOKUP_UNAVAILABLE" }]) {
      const response = await mediaFixture(route, { domainError }).run(); assert.equal(response.status, 500);
      assert.doesNotMatch(await response.text(), /detalle-sensible|token=/);
    }
  });
});
