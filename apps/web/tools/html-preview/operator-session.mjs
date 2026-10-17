import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";

const require = createRequire(import.meta.url);
/** Shared private-CLI authentication mechanism, not an HTTP grant. Every RPC
 * still checks current membership/role/draft independently. Config never comes
 * from a request, and no credential/profile is returned in operator output. */
export function createPrivateHtmlOperatorSession(configuration) {
  const {supabaseUrl, serviceRoleKey, jwtSecret, accessToken, organizationId, signal} = {...configuration};
  const endpoint = new URL(supabaseUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== "/" || endpoint.port && endpoint.port !== "443" || !serviceRoleKey || /[\r\n]/.test(serviceRoleKey)
    || (jwtSecret?.length ?? 0) < 32 || !accessToken || accessToken.length > 16_384) throw new Error();
  const {normalizePlatformRole} = require("../../.tmp/cap029-tests/utils/auth/platform-role.js");
  const {REVIEWER_ROLE_SET} = require("../../.tmp/cap029-tests/lib/pipeline-constants.js"), {z} = require("zod");
  const client = createClient(endpoint.href, serviceRoleKey, {auth: {persistSession: false, autoRefreshToken: false}});
  return {client, endpoint: endpoint.href, authenticate: async () => {
    signal.throwIfAborted();
    const {payload} = await jwtVerify(accessToken, new TextEncoder().encode(jwtSecret), {algorithms: ["HS256"], requiredClaims: ["exp", "sub"]});
    const actorId = z.string().uuid().parse(payload.sub), tenantId = z.string().uuid().parse(organizationId);
    if (!Array.isArray(payload.app_metadata?.organization_ids) || !payload.app_metadata.organization_ids.includes(tenantId)) throw new Error();
    const profile = await client.from("profiles").select("id,platform_role").eq("id", actorId).limit(1).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    if (profile.error || profile.data?.id !== actorId || !REVIEWER_ROLE_SET.has(normalizePlatformRole(profile.data.platform_role))) throw new Error();
    return {actorId, organizationId: tenantId};
  }};
}
