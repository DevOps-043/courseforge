import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  authenticateSofliaPassword,
  mapSofliaAuthFailure,
  SOFLIA_USER_SELECT,
  type SupabasePasswordAuthClient,
} from "../auth-bridge-contract";

function authClient(result: Awaited<ReturnType<SupabasePasswordAuthClient["auth"]["signInWithPassword"]>>) {
  return {
    auth: {
      signInWithPassword: async () => result,
    },
  } satisfies SupabasePasswordAuthClient;
}

describe("Auth Bridge contract", () => {
  it("selects the migrated Learning profile contract", () => {
    assert.match(SOFLIA_USER_SELECT, /platform_role/);
    assert.doesNotMatch(SOFLIA_USER_SELECT, /cargo_rol/);
    assert.doesNotMatch(SOFLIA_USER_SELECT, /password_hash/);
  });

  it("accepts Learning Supabase Auth when the UUID matches the profile", async () => {
    const result = await authenticateSofliaPassword({
      authClient: authClient({ data: { user: { id: "user-1" } }, error: null }),
      email: "learner@soflia.com",
      expectedUserId: "user-1",
      password: "correct-password",
    });

    assert.deepEqual(result, { success: true });
  });

  it("supports username login after the bridge resolves the profile email", async () => {
    let receivedEmail = "";
    const client = {
      auth: {
        signInWithPassword: async (credentials: { email: string; password: string }) => {
          receivedEmail = credentials.email;
          return { data: { user: { id: "user-1" } }, error: null };
        },
      },
    } satisfies SupabasePasswordAuthClient;

    const result = await authenticateSofliaPassword({
      authClient: client,
      email: "resolved-from-username@soflia.com",
      expectedUserId: "user-1",
      password: "correct-password",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(receivedEmail, "resolved-from-username@soflia.com");
  });

  it("rejects invalid credentials with a safe message", async () => {
    const result = await authenticateSofliaPassword({
      authClient: authClient({
        data: { user: null },
        error: { message: "Invalid login credentials", status: 400 },
      }),
      email: "learner@soflia.com",
      expectedUserId: "user-1",
      password: "wrong-password",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.failure.code, "INVALID_CREDENTIALS");
      assert.equal(result.failure.message, "Credenciales invalidas");
    }
  });

  it("rejects mismatched Auth and profile UUIDs", async () => {
    const result = await authenticateSofliaPassword({
      authClient: authClient({ data: { user: { id: "other-user" } }, error: null }),
      email: "learner@soflia.com",
      expectedUserId: "user-1",
      password: "correct-password",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.failure.code, "AUTH_USER_ID_MISMATCH");
    }
  });

  it("maps operational auth failures without exposing internals", () => {
    assert.equal(mapSofliaAuthFailure("Email not confirmed").code, "AUTH_EMAIL_NOT_CONFIRMED");
    assert.equal(mapSofliaAuthFailure("Too many requests").code, "AUTH_RATE_LIMITED");
    assert.equal(mapSofliaAuthFailure("AUTH_USER_NOT_FOUND").code, "MISSING_AUTH_USER");
  });

  it("keeps the bridge source away from removed Learning columns", () => {
    const sourceRoot = join(process.cwd(), "src", "app", "login");
    const bridgeSource = readFileSync(join(sourceRoot, "auth-bridge.ts"), "utf8");

    assert.doesNotMatch(bridgeSource, /password_hash/);
    assert.doesNotMatch(bridgeSource, /cargo_rol/);
  });

  it("keeps the JWT metadata compatible while promoting platform_role", () => {
    const helperSource = readFileSync(
      join(process.cwd(), "src", "app", "login", "auth-bridge-helpers.ts"),
      "utf8",
    );

    assert.match(helperSource, /platform_role: user\.platform_role/);
    assert.match(helperSource, /cargo_rol: user\.platform_role/);
  });

  it("declares the Learning Auth anon key as required runtime config", () => {
    const envSource = readFileSync(
      join(process.cwd(), "src", "lib", "server", "env.ts"),
      "utf8",
    );

    assert.match(envSource, /SOFLIA_AUTH_SUPABASE_ANON_KEY/);
    assert.match(envSource, /getSofliaAuthSupabaseAnonKey/);
  });
});
