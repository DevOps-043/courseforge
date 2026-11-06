import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemblyPath, credentials, generationSettings, identityErrors, integrationFixture, integrationId, integrationOrg, integrationRequest, integrationRoutes, liveavatar, syntheticKey, tenantErrors } from "./integration-authority-http.fixture";

const zeroEffects = { clients: 0, services: 0, reads: 0, writes: 0, webhooks: 0, providers: 0, media: 0, removed: 0, disposed: 0 };
const stages = ["identity", "role", "tenant"] as const;
// Los defaults cargados en VM deben compararse desde el realm del test.
const expectedSettings = structuredClone(generationSettings.DEFAULT_HYPERFRAMES_GENERATION_SETTINGS);
describe("autoridad HTTP en conexiones y configuración de producción", () => {
  for (const route of integrationRoutes) {
    it(`${route.method} ${route.path}: autoridad caída no accede a configuración`, async () => {
      for (const stage of stages) for (const ErrorType of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
        const failure = new ErrorType(); failure.message = "detalle-sensible-sintetico";
        const f = integrationFixture(route, { stage, failure }); const response = await f.run();
        assert.equal(response.status, 503, `${route.method}/${route.path}/${stage}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-request-id"), "integracion-test");
        const body = await response.json(); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
        assert.doesNotMatch(JSON.stringify(body), /detalle-sensible|clave-sintetica/); assert.deepEqual(f.effects, zeroEffects);
      }
    });
  }
  it("mantiene 401/403 sin construir clientes ni leer credenciales", async () => {
    for (const route of integrationRoutes) for (const missingAt of stages) {
      const f = integrationFixture(route, { missingAt }); assert.equal((await f.run()).status, missingAt === "identity" ? 401 : 403); assert.deepEqual(f.effects, zeroEffects);
    }
  });
  it("conserva DTO de consultas y validaciones sin exponer claves", async () => {
    for (const route of integrationRoutes.filter(route => route.method === "GET" || route.path.endsWith("validate"))) {
      const f = integrationFixture(route); const response = await f.run(); assert.equal(response.status, 200);
      const text = await response.text(); assert.doesNotMatch(text, /clave-sintetica/);
      const body = JSON.parse(text); assert.ok(body.data);
      if (route.path === "assembly-branding") {
        assert.deepEqual(body.data, { assets: [], settings: null });
        assert.equal(f.filters.filter(filter => filter.column === "organization_id" && filter.value === integrationOrg).length, 2);
      } else if (route.path === "hyperframes/settings") assert.deepEqual(body.data, expectedSettings);
      else if (route.path === "liveavatar") { assert.deepEqual(body.data.avatars, []); assert.equal(body.data.credits, null); assert.equal(f.effects.providers, 0); }
      else assert.equal(typeof body.data.connected, "boolean");
    }
  });
  it("guarda conexiones en el tenant y configura webhook después de guardar", async () => {
    for (const provider of ["heygen", "hyperframes"]) {
      const route = integrationRoutes.find(route => route.path === `${provider}/connection` && route.method === "POST")!;
      const f = integrationFixture(route); const response = await f.run(); assert.equal(response.status, 200);
      const save = f.events.findIndex(event => event.name === `save-${provider === "heygen" ? "avatar" : "hyperframes"}`);
      const hook = f.events.findIndex(event => event.name === `configure-${provider === "heygen" ? "avatar" : "hyperframes"}`);
      assert.ok(save >= 0 && hook > save); assert.equal(f.events[save].input.organizationId, integrationOrg); assert.equal(f.events[save].input.createdBy, integrationId);
      assert.equal(f.events[hook].input.organizationId, integrationOrg); assert.doesNotMatch(await response.text(), /clave-sintetica/);
      const failed = integrationFixture(route, { serviceError: new Error("detalle-sensible-sintetico"), failAt: f.events[hook].name });
      const failure = await failed.run(); assert.equal(failure.status, 500); assert.equal(failed.effects.writes, 1); assert.doesNotMatch(await failure.text(), /detalle-sensible/);
    }
  });
  it("conserva desconexión compartida y limpieza RPC sin clave anterior", async () => {
    for (const route of integrationRoutes.filter(route => route.path.endsWith("connection") && route.method === "DELETE")) {
      for (const connected of [true, false]) {
        const f = integrationFixture(route, { connected }); assert.equal((await f.run()).status, 200);
        assert.equal(f.effects.webhooks, connected ? 0 : 1); assert.equal(f.events.at(-1)?.name, "revoke");
        assert.equal(f.events.at(-1)?.input.organizationId, integrationOrg);
      }
    }
    const route = integrationRoutes.find(route => route.path === "hyperframes/connection" && route.method === "DELETE")!;
    const f = integrationFixture(route, { noSecret: true }); assert.equal((await f.run()).status, 200);
    assert.ok(f.events.some(event => event.name === "rpc:clear_heygen_webhook" && event.input.p_organization_id === integrationOrg));
  });
  it("mantiene settings de generación y rechaza fallback igual al principal", async () => {
    const route = integrationRoutes.find(route => route.path === "hyperframes/settings" && route.method === "PUT")!;
    const f = integrationFixture(route); const response = await f.run(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, expectedSettings);
    assert.equal(f.events.at(-1)?.input.organizationId, integrationOrg); assert.equal(f.events.at(-1)?.input.updatedBy, integrationId);
    const invalid = integrationFixture(route); assert.equal((await invalid.run(integrationRequest(route, { ...route.body, fallbackModel: route.body!.agentModel }))).status, 400); assert.equal(invalid.effects.writes, 0);
  });
  it("conserva selección y finalización de ensamble con filtros de tenant", async () => {
    const selection = integrationRoutes.find(route => route.path === "assembly-branding" && route.method === "PUT")!;
    const f = integrationFixture(selection); assert.equal((await f.run(integrationRequest(selection, { assetId: integrationId, kind: "OUTRO" }))).status, 200);
    assert.ok(f.filters.some(filter => filter.column === "organization_id" && filter.value === integrationOrg));
    assert.equal(f.events.at(-1)?.input.organization_id, integrationOrg); assert.equal(f.events.at(-1)?.input.updated_by, integrationId);
    const denied = integrationFixture(selection, { assetUnavailable: true }); assert.equal((await denied.run(integrationRequest(selection, { assetId: integrationId, kind: "OUTRO" }))).status, 400); assert.equal(denied.effects.writes, 0);
    const finalize = integrationRoutes.find(route => route.path === "assembly-branding" && route.method === "PATCH")!;
    const success = integrationFixture(finalize); assert.equal((await success.run()).status, 201); assert.equal(success.effects.media, 1); assert.equal(success.effects.disposed, 1);
    assert.equal(success.events.at(-1)?.input.organization_id, integrationOrg);
    for (const [existingPath, status] of [[assemblyPath, 200], ["anterior/otro.mp4", 409]] as const) {
      const replay = integrationFixture(finalize, { existingPath }); assert.equal((await replay.run()).status, status); assert.equal(replay.effects.writes, 0); assert.equal(replay.effects.media, 0);
    }
  });
  it("mantiene rechazo y liberación de medios de ensamble inválidos", async () => {
    const route = integrationRoutes.find(route => route.path === "assembly-branding" && route.method === "PATCH")!;
    for (const options of [{ badMetadata: true }, { noVideo: true }, { duration: 0 }]) {
      const f = integrationFixture(route, options); assert.equal((await f.run()).status, 400); assert.equal(f.effects.removed, 1); assert.equal(f.effects.writes, 0);
      assert.equal(f.effects.disposed, "badMetadata" in options ? 0 : 1);
    }
    const foreign = integrationFixture(route); assert.equal((await foreign.run(integrationRequest(route, { ...route.body, path: assemblyPath.replace(integrationOrg, integrationId) }))).status, 400); assert.equal(foreign.effects.reads, 0);
  });
  it("mantiene catálogo LiveAvatar conectado y creación de embedding", async () => {
    const get = integrationRoutes.find(route => route.path === "liveavatar" && route.method === "GET")!;
    const f = integrationFixture(get, { connected: true }); assert.equal((await f.run()).status, 200); assert.equal(f.effects.providers, 4);
    const post = integrationRoutes.find(route => route.path === "liveavatar" && route.method === "POST")!;
    const request = () => integrationRequest(post, { action: "create_embedding", avatarId: "avatar", contextId: "contexto", isSandbox: true });
    const missing = integrationFixture(post, { noSecret: true }); assert.equal((await missing.run(request())).status, 409); assert.equal(missing.effects.providers, 0);
    const embed = integrationFixture(post); assert.equal((await embed.run(request())).status, 201); assert.equal(embed.events.at(-1)?.input.organization_id, integrationOrg);
    const connect = integrationFixture(post); const response = await connect.run(); assert.equal(response.status, 200); assert.equal(connect.effects.writes, 1); assert.doesNotMatch(await response.text(), new RegExp(syntheticKey));
  });
  it("conserva validación estricta y límite declarado sin efectos externos", async () => {
    for (const route of integrationRoutes.filter(route => route.body)) {
      for (const body of [{}, { ...route.body, organizationId: integrationId }]) {
        const f = integrationFixture(route); assert.equal((await f.run(integrationRequest(route, body))).status, 400); assert.equal(f.effects.writes, 0); assert.equal(f.effects.webhooks, 0); assert.equal(f.effects.providers, 0);
      }
      assert.equal((await integrationFixture(route).run(new Request("https://example.invalid", { method: route.method, headers: { "content-type": "application/json", "content-length": "100000" }, body: "{}" }))).status, 413);
    }
  });
  it("preserva errores propios de credenciales y LiveAvatar", async () => {
    const routes = integrationRoutes.filter(route => route.path === "liveavatar" || route.path.endsWith("validate") || (route.path.endsWith("connection") && route.method === "POST"));
    for (const route of routes) {
      const f = integrationFixture(route, { serviceError: new credentials.ProductionProviderCredentialError("Credencial rechazada.", 409, "REQUIERE_CONFIG") });
      const response = await f.run(); assert.equal(response.status, 409); assert.equal((await response.json()).details.providerCode, "REQUIERE_CONFIG");
    }
    const route = integrationRoutes.find(route => route.path === "liveavatar" && route.method === "POST")!;
    for (const [providerStatus, status, retryable] of [[401, 400, false], [403, 400, false], [429, 429, true], [500, 502, true]] as const) {
      const response = await integrationFixture(route, { serviceError: new liveavatar.LiveAvatarApiError("detalle-sensible-sintetico", providerStatus) }).run();
      assert.equal(response.status, status); const body = await response.json(); assert.equal(body.retryable, retryable); assert.doesNotMatch(JSON.stringify(body), /detalle-sensible/);
    }
  });
  it("un error genérico o un objeto con código de autoridad conserva 500 seguro", async () => {
    for (const route of integrationRoutes) for (const serviceError of [new Error("detalle-sensible-sintetico"), { code: "TENANT_LOOKUP_UNAVAILABLE" }]) {
      const response = await integrationFixture(route, { serviceError }).run(); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /detalle-sensible|clave-sintetica/);
    }
  });
});
