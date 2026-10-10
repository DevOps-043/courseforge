import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createStore } from "zustand/vanilla";
import { createAuthStoreState } from "../auth-store-state";
import { loadAuthSessionUser, AUTH_SESSION_LOAD_ERROR } from "../session.client";
import { authSessionUserSchema, projectAuthSessionUser, type AuthSessionUser } from "../session.contract";
import { createAuthSessionHandler } from "../session-http";
import { resolveAuthSessionUser } from "../session.service";

const user = { id: "4fe67fb0-01fb-454f-91df-8b5c3b67d818", email: "test@example.invalid" };
const request = () => new Request("https://example.invalid/api/auth/session");
const responseFetch = (response: Response): typeof fetch => async () => response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("Server-verified client identity", () => {
  it("accepts Auth Bridge without requiring a GoTrue session", async () => {
    const identity = await resolveAuthSessionUser({
      readBridgeUser: async () => user,
      readSupabaseUser: async () => { throw new Error("GoTrue must not be consulted"); },
    });
    assert.equal(identity?.id, user.id);
  });
  it("preserves legacy Supabase sessions when no bridge identity exists", async () => {
    const identity = await resolveAuthSessionUser({ readBridgeUser: async () => null, readSupabaseUser: async () => user });
    assert.equal(identity?.id, user.id);
  });
  it("returns no identity when neither provider has a valid session", async () => {
    assert.equal(await resolveAuthSessionUser({ readBridgeUser: async () => null, readSupabaseUser: async () => null }), null);
  });
  it("does not silently fall back when verification fails operationally", async () => {
    await assert.rejects(resolveAuthSessionUser({
      readBridgeUser: async () => { throw new Error("verification unavailable"); },
      readSupabaseUser: async () => user,
    }));
  });
  it("projects only declared fields and rejects invalid actor identities", () => {
    const providerSession = { ...user, access_token: "fake-test-token", organization_ids: ["tenant"],
      platform_permissions: ["grant"], first_name: null };
    const identity = projectAuthSessionUser(providerSession);
    assert.doesNotMatch(JSON.stringify(identity), /fake-test-token|organization_ids|platform_permissions/);
    assert.equal(identity.first_name, undefined);
    assert.throws(() => projectAuthSessionUser({ id: "invalid", email: "" }));
    assert.equal(authSessionUserSchema.safeParse(providerSession).success, false);
  });
});

describe("Session HTTP and client contract", () => {
  it("returns a non-cacheable, token-free identity with correlation headers", async () => {
    const handler = createAuthSessionHandler({ readBridgeUser: async () => ({ ...user, access_token: "fake" }),
      readSupabaseUser: async () => null });
    const response = await handler(request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("x-request-id"), body.requestId);
    assert.equal(body.user.id, user.id);
    assert.doesNotMatch(JSON.stringify(body), /access_token|fake/);
  });
  it("returns non-cacheable 401 for absent or expired sessions", async () => {
    const response = await createAuthSessionHandler({ readBridgeUser: async () => null,
      readSupabaseUser: async () => null })(request());
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  });
  it("returns safe non-cacheable 500 without provider details", async () => {
    const response = await createAuthSessionHandler({ readBridgeUser: async () => { throw new Error("fake-secret-detail"); },
      readSupabaseUser: async () => null })(request());
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await response.text(), /fake-secret-detail/);
  });
  it("uses same-origin credentials, no-store and a bounded request", async () => {
    const fetchIdentity: typeof fetch = async (url, options) => {
      assert.equal(url, "/api/auth/session");
      assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.cache, "no-store");
      assert.ok(options?.signal instanceof AbortSignal);
      return Response.json({ success: true, user, requestId: "metadata" });
    };
    assert.equal((await loadAuthSessionUser(fetchIdentity))?.id, user.id);
  });
  it("treats 401 as unauthenticated, but rejects server errors and malformed identities", async () => {
    assert.equal(await loadAuthSessionUser(responseFetch(new Response(null, { status: 401 }))), null);
    for (const response of [new Response(null, { status: 500 }), Response.json({ success: true, user: { ...user, id: "invalid" } }),
      Response.json({ success: true, user: { ...user, access_token: "fake" } })]) {
      await assert.rejects(loadAuthSessionUser(responseFetch(response)), new Error(AUTH_SESSION_LOAD_ERROR));
    }
  });
});

describe("Client identity lifecycle", () => {
  it("deduplicates concurrent initialization and hydrates actorId", async () => {
    const lookup = deferred<AuthSessionUser | null>();
    let calls = 0;
    const store = createStore(createAuthStoreState({ loadUser: () => { calls++; return lookup.promise; }, signOut: async () => {} }));
    const first = store.getState().initialize();
    const second = store.getState().initialize();
    assert.equal(first, second);
    lookup.resolve(user);
    await first;
    assert.equal(calls, 1);
    assert.equal(store.getState().user?.id, user.id);
    assert.equal(store.getState().isAuthenticated, true);
    assert.equal(store.getState().isLoading, false);
  });
  it("does not resurrect a user when a lookup finishes after logout", async () => {
    const lookup = deferred<AuthSessionUser | null>();
    const store = createStore(createAuthStoreState({ loadUser: () => lookup.promise, signOut: async () => {} }));
    const pending = store.getState().initialize();
    await store.getState().logout();
    lookup.resolve(user);
    await pending;
    assert.equal(store.getState().user, null);
    assert.equal(store.getState().isAuthenticated, false);
  });
  it("clears stale identity on expiration and supports retry after network failure", async () => {
    let attempt = 0;
    const store = createStore(createAuthStoreState({ loadUser: async () => {
      attempt++;
      if (attempt === 1 || attempt === 4) return user;
      if (attempt === 2) return null;
      throw new Error("fake-private-detail");
    }, signOut: async () => {} }));
    await store.getState().initialize();
    await store.getState().initialize();
    assert.equal(store.getState().user, null);
    assert.equal(store.getState().sessionError, null);
    await store.getState().initialize();
    assert.equal(store.getState().sessionError, AUTH_SESSION_LOAD_ERROR);
    await store.getState().initialize();
    assert.equal(store.getState().user?.id, user.id);
    assert.equal(store.getState().sessionError, null);
  });
  it("retains the scope guard and shows a recovery action instead of silently hiding", () => {
    const inspector = readFileSync("src/domains/materials/components/composition-editor/CompositionHtmlEditorialInspector.tsx", "utf8");
    assert.match(inspector, /scopeSchema.safeParse/);
    assert.match(inspector, /if \(!scope.success\) return enabled \?/);
    assert.match(inspector, /Volver a comprobar sesión/);
    assert.match(inspector, /role="alert"/);
    const adapter = readFileSync("src/core/stores/authStore.ts", "utf8");
    assert.match(adapter, /signOut: logoutAction/);
    assert.doesNotMatch(adapter, /auth.getUser/);
  });
});
