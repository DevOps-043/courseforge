import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heygenFixture, heygenRoutes, stages, actorId, organizationId, componentId, jobId, clip } from "./heygen-authority-http.fixture";
import { identityErrors, tenantErrors, heygenApi, credentials, scenes, video, platform, catalog, constraints, productionTypes } from "./heygen-authority-http.runtime";

const zeroEffects = { clients: 0, services: 0, credentials: 0, reads: 0, writes: 0, provider: 0, signatures: 0, dispatches: 0, background: 0, storage: 0 };
const route = (path: string, method: string) => heygenRoutes.find(candidate => candidate.path === path && candidate.method === method)!;
const event = (f: ReturnType<typeof heygenFixture>, name: string) => f.events.find(candidate => candidate.name === name)!;

describe("autoridad HTTP en operaciones, clips y jobs HeyGen", () => {
  for (const entry of heygenRoutes) {
    it(`${entry.method} ${entry.path}: caída de autoridad no inicia efectos`, async () => {
      for (const stage of stages(entry)) for (const ErrorType of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
        const failure = new ErrorType(); failure.message = "detalle-sensible-sintetico";
        const f = heygenFixture(entry, { stage, failure }); const response = await f.run();
        assert.equal(response.status, 503, `${stage}/${ErrorType.name}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("x-request-id"), "heygen-autoridad-test");
        const body = await response.json(); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
        assert.doesNotMatch(JSON.stringify(body), /detalle-sensible/); assert.deepEqual(f.effects, zeroEffects);
        assert.equal(f.logs.filter(log => log.level === "error").length, 0); assert.doesNotMatch(JSON.stringify(f.logs), /detalle-sensible/);
      }
    });
    it(`${entry.method} ${entry.path}: conserva respuesta válida y tenant del servidor`, async () => {
      const f = heygenFixture(entry); const response = await f.run();
      assert.equal(response.status, entry.status ?? 200, JSON.stringify(f.logs));
      const body = await response.json(); assert.equal(body.success, true); assert.ok(body.data);
      for (const call of f.events.filter(call => call.name === "credential")) {
        assert.equal((call.input as Record<string, unknown>).organizationId, organizationId);
        assert.equal((call.input as Record<string, unknown>).allowGlobalFallback, false);
      }
      assert.equal(f.effects.background, 0);
    });
  }
  it("conserva 401/403/404 sin efectos posteriores a la denegación", async () => {
    for (const entry of heygenRoutes) for (const missingAt of stages(entry)) {
      const f = heygenFixture(entry, { missingAt }); const response = await f.run();
      assert.equal(response.status, missingAt === "identity" ? 401 : missingAt === "component" ? 404 : 403, `${entry.path}/${missingAt}`);
      assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("un código de autoridad falsificado no se convierte en 503", async () => {
    for (const entry of heygenRoutes) {
      const genuine = new tenantErrors.TenantContextLookupError();
      const failure = Object.assign(new Error("detalle-sensible-sintetico"), { code: genuine.code, name: genuine.name });
      const f = heygenFixture(entry, { stage: "identity", failure }); const response = await f.run();
      assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /detalle-sensible/); assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("conserva rechazo de JSON inválido y solicitudes demasiado grandes", async () => {
    for (const entry of heygenRoutes.filter(entry => entry.body)) for (const [body, expected] of [["{", 400], [JSON.stringify({ extra: "x".repeat(2 * 1024 * 1024) }), 413]] as const) {
      const f = heygenFixture(entry);
      const response = await f.run(new Request("https://example.invalid", { method: entry.method, headers: { "content-type": "application/json" }, body }));
      assert.equal(response.status, expected, `${entry.method}/${entry.path}`); assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("el payload no concede organización o actor", async () => {
    for (const entry of heygenRoutes.filter(entry => entry.body)) {
      const f = heygenFixture(entry);
      const response = await f.run(f.request({ ...entry.body, organizationId: actorId, createdBy: organizationId }));
      assert.equal(response.status, 400, `${entry.method}/${entry.path}`); assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("conserva paginación y preparación/completado de assets", async () => {
    const list = heygenFixture(route("assets", "GET")); await list.run();
    assert.equal((event(list, "platform-request").input as { path: string }).path, "/v3/assets?limit=100&token=pagina-sintetica");
    const prepare = heygenFixture(route("assets", "POST")); await prepare.run();
    const input = event(prepare, "platform-request").input as Record<string, unknown>;
    assert.equal(input.path, "/v3/assets/direct-uploads"); assert.match(String(input.idempotencyKey), /^[a-f0-9-]{36}$/);
    assert.deepEqual(structuredClone(input.body), { checksum_sha256: undefined, content_type: "video/mp4", filename: "sintetico.mp4", size_bytes: 1024 });
    const complete = heygenFixture(route("assets", "POST"));
    await complete.run(complete.request({ action: "complete", assetId: "asset/a b" }));
    assert.equal((event(complete, "platform-request").input as { path: string }).path, "/v3/assets/asset%2Fa%20b/complete");
  });
  it("conserva consultas de operación/audio y atribución de acciones", async () => {
    for (const [query, name] of [[`?resource=operation&operationId=${actorId}`, "operation"], ["?resource=audio-search&query=musica", "audio-search"]]) {
      const f = heygenFixture(route("platform", "GET")); assert.equal((await f.run(f.request(undefined, query))).status, 200); assert.ok(event(f, name));
    }
    const submit = heygenFixture(route("platform", "POST")); await submit.run();
    assert.equal((event(submit, "submit-operation").input as Record<string, unknown>).createdBy, actorId);
    assert.equal((event(submit, "submit-operation").input as Record<string, unknown>).organizationId, organizationId);
    for (const [archiveResult, status] of [["NOT_FOUND", 404], ["DEFAULT", 409]] as const) {
      assert.equal((await heygenFixture(route("presets", "PATCH"), { archiveResult }).run()).status, status);
    }
  });
  it("mantiene recuperación de escenas y advertencia de sincronización opcional", async () => {
    const f = heygenFixture(route("scenes", "POST"), { composition: true }); const response = await f.run();
    assert.equal(response.status, 200); assert.ok(event(f, "draft"));
    assert.ok(f.filters.some(filter => filter.table === "video_compositions" && filter.column === "organization_id" && filter.value === organizationId));
    const optional = heygenFixture(route("scenes", "POST"), { operationError: new tenantErrors.TenantContextLookupError(), failAt: "editor-sync" });
    const body = await (await optional.run()).json(); assert.match(body.data.editorSyncWarning, /no pudo sincronizarse/);
    assert.ok(event(optional, "recover-scenes")); assert.equal(optional.effects.dispatches, 0);
  });
  it("firma y despacha vídeos y clips solo con identidad/organización del servidor", async () => {
    for (const path of ["videos", "clips/generate"]) {
      const f = heygenFixture(route(path, "POST")); const body = await (await f.run()).json();
      assert.equal(body.data.submissionStatus, "QUEUED");
      const signed = event(f, "sign").input as Record<string, unknown>;
      assert.equal(signed.organizationId, organizationId); assert.equal(signed.createdBy, actorId);
      assert.ok(f.events.findIndex(call => call.name === "credential") < f.events.findIndex(call => call.name === "dispatch"));
      if (path === "clips/generate") assert.ok(f.events.findIndex(call => call.name === "preflight") < f.events.findIndex(call => call.name === "queue-clips"));
    }
    const voice = heygenFixture(route("clips/generate", "POST"));
    await voice.run(voice.request({ componentId, clipIds: [clip.id], clips: [clip], generationTarget: "voice_only" }));
    assert.equal(voice.events.some(call => call.name === "preflight"), false);
    const failed = heygenFixture(route("clips/generate", "POST"), { operationError: new Error("despacho-sintetico"), failAt: "dispatch" });
    assert.equal((await failed.run()).status, 503); assert.ok(event(failed, "fail-clips"));
  });
  it("compensa reservas sync sin omitir la proyección de autoridad", async () => {
    const f = heygenFixture(route("sync", "POST"), { operationError: new identityErrors.AuthIdentityLookupError(), failAt: "dispatch" });
    assert.equal((await f.run()).status, 503); assert.ok(event(f, "compensate-sync"));
    const input = event(f, "compensate-sync").input as Record<string, unknown>;
    assert.equal(input.organizationId, organizationId); assert.equal(input.syncRunId, jobId); assert.equal(input.status, "FAILED");
    const conflict = heygenFixture(route("sync", "POST"), { operationError: { code: "23505" }, failAt: "reserve-sync" });
    assert.equal((await conflict.run()).status, 409); assert.equal(conflict.effects.dispatches, 0);
    const incomplete = heygenFixture(route("sync", "POST"), { operationError: new catalog.HeygenCatalogSyncIncompleteError("Sincronización parcial"), failAt: "dispatch" });
    assert.equal((await incomplete.run()).status, 409); assert.equal(incomplete.events.some(call => call.name === "compensate-sync"), false);
  });
  it("conserva generación de voz standalone y ruta de Storage por tenant", async () => {
    const f = heygenFixture(route("speech", "POST")); const response = await f.run(f.request({ script: "Texto sintético", voicePresetId: actorId }));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.data.standalone, true);
    const upload = event(f, "upload-voice").input as { bucket: string; path: string; settings: { upsert: boolean } };
    assert.equal(upload.bucket, "production-assets"); assert.equal(upload.path, `heygen/standalone/${organizationId}/speech-sintetico.wav`); assert.equal(upload.settings.upsert, true);
    assert.equal((event(f, "upsert-voice").input as { input: { organization_id: string } }).input.organization_id, organizationId);
  });
  it("conserva DTO de jobs y no expone voz de clip antes de SUCCEEDED", async () => {
    for (const status of ["PENDING", "SUCCEEDED"]) {
      const latestJob = { id: jobId, status, input_snapshot: { job_type: productionTypes.PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP }, output_snapshot: { provider_request_id: "provider-sintetico" } };
      const f = heygenFixture(route("jobs", "GET"), { latestJob }); const body = await (await f.run()).json();
      assert.equal(body.data.latestJob.providerJobId, "provider-sintetico"); assert.equal(body.data.voiceAsset !== null, status === "SUCCEEDED");
      if (body.data.voiceAsset) assert.equal(body.data.voiceAsset.durationSeconds, 1.25);
      assert.deepEqual(structuredClone(event(f, "latest-job").input), { componentId, organizationId });
    }
    const f = heygenFixture(route("jobs/[jobId]", "GET")); await f.run();
    assert.deepEqual(structuredClone(event(f, "job-status").input), { autoPromote: true, createdBy: actorId, jobId, organizationId });
  });
  it("conserva errores API, Retry-After y permiso insuficiente del catálogo", async () => {
    for (const entry of heygenRoutes.filter(entry => !["presets", "jobs"].includes(entry.path))) for (const status of [401, 429, 503]) {
      const error = new heygenApi.HeygenApiError({ status, message: "detalle-proveedor-sintetico", providerCode: "PROVIDER_TEST", retryAfterSeconds: 7 });
      const f = heygenFixture(entry, { operationError: error }); const response = await f.run();
      const syncPermission = entry.path === "sync" && status === 401;
      assert.equal(response.status, syncPermission ? 400 : status === 429 ? 429 : 502, entry.path);
      assert.equal(response.headers.get("retry-after"), syncPermission ? null : "7");
      const body = await response.json(); assert.equal(body.retryable, !syncPermission && status >= 429); assert.equal(body.details.providerCode, "PROVIDER_TEST");
      assert.doesNotMatch(JSON.stringify(body), /detalle-proveedor-sintetico/);
    }
  });
  it("mantiene errores de credencial, servicios y validación como errores propios", async () => {
    for (const [entry, error, status] of [
      [route("platform", "POST"), new platform.HeygenPlatformServiceError("Conflicto", 409, "DOMAIN_TEST"), 409],
      [route("scenes", "DELETE"), new scenes.HeygenScenesServiceError("No encontrado", 404), 404],
      [route("jobs/[jobId]", "GET"), new video.HeygenVideoServiceError("Conflicto", 409), 409],
      [route("speech", "POST"), new constraints.HeygenRequestValidationError("Guion inválido", 422), 422],
      [route("videos", "POST"), new credentials.HeygenCredentialResolverError("Conecta HeyGen"), 409],
    ] as const) assert.equal((await heygenFixture(entry, { operationError: error }).run()).status, status);
  });
});
