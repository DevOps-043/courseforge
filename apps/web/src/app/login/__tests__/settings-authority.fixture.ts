import { load } from "./source-test-loader";
import * as pipeline from "../../../lib/pipeline-constants";
import * as contract from "../../../lib/server/api-contract";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";

export const settingsActor = "11111111-1111-4111-8111-111111111111";
export const settingsOrganization = "22222222-2222-4222-8222-222222222222";
export const foreignSettingsOrganization = "33333333-3333-4333-8333-333333333333";
export const settingsPromptId = "44444444-4444-4444-8444-444444444444";
type Tenant = { userId: string; organizationId: string; organizationSlug: string; platformRole: string };
export type QueryRecord = { table: string; operation: string; filters: Array<[string, string, unknown]>; payload?: Record<string, unknown> };
export interface SettingsResult { success: boolean; error?: string; errorCode?: string; retryable?: boolean;
  prompts?: Array<{ organization_id?: string | null }>; settings?: Array<{ id: number }>; prompt?: { organization_id?: string | null } }
export const SETTINGS_ACTION_CASES = [
  { name: "getSystemPromptsAction", mode: "READ", args: [] },
  { name: "getModelSettingsAction", mode: "READ", args: [] },
  { name: "getSystemPromptHistoryAction", mode: "READ", args: ["ARTIFACT_BASE"] },
  { name: "updateSystemPromptAction", mode: "WRITE", args: [{ id: settingsPromptId, content: "Contenido cambiado" }] },
  { name: "resetPromptToDefaultAction", mode: "WRITE", args: ["ARTIFACT_BASE"] },
  { name: "restorePromptVersionAction", mode: "WRITE", args: [settingsPromptId] },
  { name: "updateModelSettingsAction", mode: "WRITE", args: [[{ id: 98765, model_name: "modelo-sintetico", setting_type: "SYLLABUS", temperature: 0.5 }]] },
] as const;

export function settingsFixture() {
  const effects: string[] = [];
  const queries: QueryRecord[] = [];
  const state = { actorId: settingsActor as string | null,
    tenant: { userId: settingsActor, organizationId: settingsOrganization, organizationSlug: "empresa", platformRole: "ADMIN" } as Tenant | null,
    identityFailure: null as unknown, tenantFailure: null as unknown, reviewFailure: null as unknown,
    dbFailure: false, selectedPromptOrganization: null as string | null };
  const stageIdentity = async () => { effects.push("identity"); if (state.identityFailure) throw state.identityFailure; return state.actorId; };
  const tenantModule = { resolveActiveTenantContext: async () => { effects.push("tenant"); if (state.tenantFailure) throw state.tenantFailure; return state.tenant; } };
  const logger = { createOperationalLogger: () => ({ warn: () => effects.push("log.warn"), error: () => effects.push("log.error") }) };
  const auth = {
    getAuthenticatedUser: async () => { const actorId = await stageIdentity(); return actorId ? { userId: actorId } : null; },
    canReviewContent: async (actorId: string, tenant: unknown) => {
      effects.push("review"); if (state.reviewFailure) throw state.reviewFailure;
      return actorId === state.actorId && tenant === state.tenant && pipeline.REVIEWER_ROLE_SET.has(state.tenant?.platformRole ?? "");
    },
  };
  const createSessionClient = async () => { effects.push("session"); return {}; };
  const prompt = (organizationId: string | null) => ({ id: settingsPromptId, code: "ARTIFACT_BASE", version: "1.0.0",
    organization_id: organizationId, content: "Contenido anterior", description: null, is_active: true,
    created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z" });
  const createAdminClient = () => {
    effects.push("admin");
    return { from: (table: string) => {
      const record: QueryRecord = { table, operation: "select", filters: [] };
      let projection = "";
      const execute = (single = false) => {
        queries.push(record);
        if (state.dbFailure) return { data: null, error: { message: "CANARIO_PRIVADO_SQL" } };
        if (table === "profiles") return { data: { platform_role: "SUPERADMIN" }, error: null };
        if (record.operation === "insert") return { data: { ...prompt(settingsOrganization), ...record.payload }, error: null };
        if (record.operation === "update") return { data: null, error: null };
        const organization = record.filters.find(([method, field]) => method === "eq" && field === "organization_id")?.[2];
        if (table === "model_settings") return { data: single ? { id: 17 } : [], error: null };
        if (projection === "version") return { data: [{ version: "1.0.0" }], error: null };
        return { data: single ? prompt(record.filters.some(([, field]) => field === "id")
          ? state.selectedPromptOrganization : typeof organization === "string" ? organization : null)
          : [prompt(typeof organization === "string" ? organization : null)], error: null };
      };
      const query = {
        select: (fields: string) => { projection = fields; return query; },
        eq: (field: string, value: unknown) => { record.filters.push(["eq", field, value]); return query; },
        is: (field: string, value: unknown) => { record.filters.push(["is", field, value]); return query; },
        or: (value: string) => { record.filters.push(["or", "", value]); return query; },
        order: () => query, limit: () => query,
        update: (payload: Record<string, unknown>) => { record.operation = "update"; record.payload = payload; return query; },
        insert: (payload: Record<string, unknown>) => { record.operation = "insert"; record.payload = payload; return query; },
        single: async () => execute(true), maybeSingle: async () => execute(true),
        then: <TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
          fulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
          rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) => Promise.resolve(execute()).then(fulfilled, rejected),
      };
      return query;
    } };
  };
  const resolveSettingsAccess = (mode: "READ" | "WRITE") => {
    const helper = load<{ resolveSettingsAccess: (mode: "READ" | "WRITE") => Promise<unknown> }>(
      "src/domains/prompts/server/settings-access.server.ts", {
        "@/lib/server/artifact-action-auth": auth, "@/lib/server/tenant-context": tenantModule,
        "@/utils/supabase/server": { createClient: createSessionClient },
        "@/lib/server/auth-identity-error": { AuthIdentityLookupError },
        "@/lib/server/tenant-context-error": { TenantContextLookupError },
        "@/lib/server/api-contract": contract, "@/lib/server/operational-logger": logger,
      });
    return helper.resolveSettingsAccess(mode);
  };
  const actions = load<Record<string, (...args: unknown[]) => Promise<SettingsResult>>>("src/app/admin/settings/actions.ts", {
    "@supabase/supabase-js": { createClient: createAdminClient },
    "@/domains/prompts/server/settings-access.server": { resolveSettingsAccess },
    "@/utils/auth/session": {
      getAuthBridgeUser: async () => { const actorId = await stageIdentity(); return actorId ? { id: actorId, platform_role: "SUPERADMIN" } : null; },
      getActiveOrganizationId: async () => { effects.push("cookie"); return foreignSettingsOrganization; },
    },
    "@/lib/server/env": { getSupabaseUrl: () => "https://synthetic.invalid", getSupabaseServiceRoleKey: () => "sintetico" },
    "@/lib/server/tenant-context": tenantModule,
    "@/shared/ai/materials-model-provider": { isSupportedMaterialsModel: () => true },
    "@/lib/pipeline-constants": pipeline,
    "next/cache": { revalidatePath: () => effects.push("revalidate") },
  }, { console: { ...console, error: () => effects.push("log.error") } });
  return { state, effects, queries, actions };
}
