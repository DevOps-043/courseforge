import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encrypt } from "../../../../../lib/server/crypto";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "../heygen-credential-resolver.service";

const CRYPTO_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function withEnv(updates: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    const value = updates[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createCredentialSupabase(row: Record<string, unknown> | null) {
  const query = {
    eq() {
      return query;
    },
    maybeSingle: async () => ({ data: row, error: null }),
    select() {
      return query;
    },
  };

  return {
    from(table: string) {
      assert.equal(table, "production_provider_credentials");
      return query;
    },
  } as any;
}

describe("HeyGen credential resolver", () => {
  it("uses the organization API key when one is active", async () => {
    await withEnv({
      OAUTH_TOKEN_CRYPTO_SECRET: CRYPTO_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
      HEYGEN_API_KEY: undefined,
    }, async () => {
      const result = await getHeygenClientForOrganization({
        organizationId: "org-1",
        supabase: createCredentialSupabase({
          encrypted_secret: encrypt("org-api-key-secret"),
          secret_last4: "cret",
          validation_status: "VALID",
        }),
      });

      assert.equal(result.authMode, "organization_api_key");
      assert.equal(result.credentialLast4, "cret");
    });
  });

  it("uses the global API key only when fallback is explicitly allowed", async () => {
    await withEnv({
      OAUTH_TOKEN_CRYPTO_SECRET: CRYPTO_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
      HEYGEN_API_KEY: "global-api-key-secret",
    }, async () => {
      const result = await getHeygenClientForOrganization({
        allowGlobalFallback: true,
        organizationId: "org-1",
        supabase: createCredentialSupabase(null),
      });

      assert.equal(result.authMode, "global_api_key");
      assert.equal(result.credentialLast4, null);
    });
  });

  it("fails when no organization API key exists and fallback is disabled", async () => {
    await withEnv({
      OAUTH_TOKEN_CRYPTO_SECRET: CRYPTO_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
      HEYGEN_API_KEY: "global-api-key-secret",
    }, async () => {
      await assert.rejects(
        () => getHeygenClientForOrganization({
          allowGlobalFallback: false,
          organizationId: "org-1",
          supabase: createCredentialSupabase(null),
        }),
        (error: unknown) =>
          error instanceof HeygenCredentialResolverError &&
          error.code === "HEYGEN_ORGANIZATION_CREDENTIAL_REQUIRED",
      );
    });
  });
});
