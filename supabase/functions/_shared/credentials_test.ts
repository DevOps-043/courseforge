import { getOrganizationHyperframesApiKey } from "./credentials.ts";

Deno.test("HyperFrames credentials are scoped to the organization and never fall back to legacy HeyGen or avatars", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://credentials-test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-key");
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests += 1;
    const url = new URL(String(input));
    if (url.pathname !== "/rest/v1/production_provider_credentials"
      || url.searchParams.get("provider") !== "eq.hyperframes_cloud"
      || url.searchParams.get("organization_id") !== "eq.organization-test"
      || url.searchParams.get("status") !== "eq.ACTIVE") {
      throw new Error("Credential query escaped the HyperFrames organization boundary");
    }
    return Response.json([]);
  };
  try {
    let rejected = false;
    try { await getOrganizationHyperframesApiKey("organization-test"); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "No active HyperFrames credential for organization.") throw error;
      rejected = true;
    }
    if (!rejected || requests !== 1) throw new Error("Missing credentials must fail without a legacy fallback");
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});
