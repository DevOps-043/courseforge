import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import { load } from "./source-test-loader";

const errors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
const roles = load<typeof import("../../../utils/auth/platform-role")>("src/utils/auth/platform-role.ts");
const actor = { id: "123e4567-e89b-42d3-a456-426614174000", email: "actor@example.invalid" };
function fixture() {
  const state = {
    bridge: { user: actor, accessToken: "bridge-verificado" } as { user: typeof actor; accessToken: string } | null,
    nativeUser: { ...actor, id: "otra-identidad" } as typeof actor | null,
    tokenUser: actor as typeof actor | null,
    nativeError: null as { status?: number } | null,
    tokenError: null as { status?: number } | null,
    sessionError: null as { status?: number } | null,
    bridgeUnavailable: false, sessionUnavailable: false,
  };
  const calls: string[] = [];
  const client = { auth: {
    async getUser(token?: string) {
      calls.push(token ? "token" : "user");
      if (token) assert.equal(token, "gotrue-token");
      return { data: { user: token ? state.tokenUser : state.nativeUser }, error: token ? state.tokenError : state.nativeError };
    },
    async getSession() { calls.push("session"); if (state.sessionUnavailable) throw new Error("detalle-sensible-sintetico"); return { data: { session: { access_token: "gotrue-token" } }, error: state.sessionError }; },
  } };
  const identity = load<typeof import("../../../lib/server/server-identity")>("src/lib/server/server-identity.ts", {
    react: { cache: <T>(fn: T) => fn },
    "@/utils/auth/session": { getAuthBridgeSession: async () => { if (state.bridgeUnavailable) throw new errors.AuthIdentityLookupError(); return state.bridge; } },
    "@/utils/supabase/server": { createClient: async () => client },
    "./auth-identity-error": errors,
  });
  return { state, calls, client, identity };
}
describe("identidad y token coherentes en servidor", () => {
  it("sesiones duales divergentes usan Bridge sin leer GoTrue", async () => {
    const f = fixture(); assert.equal((await f.identity.resolveServerIdentity(f.client))?.user.id, actor.id);
    assert.equal(await f.identity.resolveServerAccessToken(f.client), "bridge-verificado"); assert.equal(f.calls.length, 0);
  });
  it("GoTrue-only resuelve identidad sin conceder autoridad desde metadatos", async () => {
    const f = fixture(); f.state.bridge = null; f.state.nativeUser = actor; f.state.tokenUser = actor;
    assert.equal((await f.identity.resolveServerIdentity())?.user.id, actor.id);
    assert.equal(await f.identity.resolveServerAccessToken(f.client), "gotrue-token");
    assert.ok(f.calls.includes("token"));
  });
  it("no entrega token GoTrue si pertenece a otro actor o no verifica", async () => {
    const f = fixture(); f.state.bridge = null;
    assert.equal(await f.identity.resolveServerAccessToken(f.client), null);
    f.state.tokenError = { status: 401 }; assert.equal(await f.identity.resolveServerAccessToken(f.client), null);
  });
  it("caída Bridge no cambia silenciosamente al actor GoTrue", async () => {
    const f = fixture(); f.state.bridgeUnavailable = true;
    await assert.rejects(f.identity.resolveServerAccessToken(f.client), error => error instanceof errors.AuthIdentityLookupError);
    assert.equal(f.calls.length, 0);
  });
  it("caídas GoTrue o getSession propagan error seguro", async () => {
    const f = fixture(); f.state.bridge = null; f.state.nativeError = { status: 503 };
    await assert.rejects(f.identity.resolveServerIdentity(f.client), error => error instanceof errors.AuthIdentityLookupError);
    f.state.nativeError = null; f.state.sessionUnavailable = true;
    await assert.rejects(f.identity.resolveServerAccessToken(f.client), error => error instanceof errors.AuthIdentityLookupError && !error.message.includes("detalle-sensible"));
    f.state.sessionUnavailable = false; f.state.sessionError = { status: 503 };
    await assert.rejects(f.identity.resolveServerAccessToken(f.client), error => error instanceof errors.AuthIdentityLookupError);
  });
  it("sesión GoTrue ausente o rechazada devuelve null", async () => {
    const f = fixture(); f.state.bridge = null; f.state.nativeUser = null;
    assert.equal(await f.identity.resolveServerIdentity(), null);
    f.state.nativeError = { status: 400 }; assert.equal(await f.identity.resolveServerAccessToken(f.client), null);
  });
});

describe("verificación Bridge sin fallback operativo", () => {
  const secret = new TextEncoder().encode("secreto-sintetico-exclusivo-de-pruebas");
  function session(token: string | null, failConfig = false, dynamicSignal?: unknown) {
    return load<typeof import("../../../utils/auth/session")>("src/utils/auth/session.ts", {
      "next/headers": { cookies: async () => { if (dynamicSignal) throw dynamicSignal; return { get: () => token ? { value: token } : undefined }; } },
      "@/lib/server/env": { getCourseforgeJwtSecret: () => { if (failConfig) throw new Error("secreto-sintetico-no-publicable"); return new TextDecoder().decode(secret); } },
      "@/utils/auth/platform-role": roles,
      "@/lib/server/auth-identity-error": errors,
    });
  }
  it("retorna el mismo token verificado junto al actor", async () => {
    const token = await new SignJWT({ sub: actor.id, email: actor.email }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(secret);
    assert.equal((await session(token).getAuthBridgeSession())?.accessToken, token);
    assert.equal((await session(token).getAuthBridgeUser())?.id, actor.id);
  });
  it("rechaza firma inválida, token sin exp y expirado como ausencia", async () => {
    for (const exp of [undefined, Math.floor(Date.now() / 1000) - 60]) {
      const jwt = new SignJWT({ sub: actor.id, email: actor.email }).setProtectedHeader({ alg: "HS256" });
      if (exp) jwt.setExpirationTime(exp);
      assert.equal(await session(await jwt.sign(secret)).getAuthBridgeSession(), null);
    }
    assert.equal(await session("token-invalido").getAuthBridgeSession(), null);
    const wrongSignature = await new SignJWT({ sub: actor.id, email: actor.email }).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m").sign(new TextEncoder().encode("otra-clave-sintetica-de-prueba"));
    assert.equal(await session(wrongSignature).getAuthBridgeSession(), null);
  });
  it("errores de configuración son seguros y señales Next se propagan", async () => {
    await assert.rejects(session("token", true).getAuthBridgeUser(), error => error instanceof errors.AuthIdentityLookupError && !error.message.includes("secreto"));
    const signal = { digest: "DYNAMIC_SERVER_USAGE" };
    await assert.rejects(session(null, false, signal).getAuthBridgeUser(), error => error === signal);
  });
});
