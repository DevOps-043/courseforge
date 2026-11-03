import type { SupabaseClient } from "@supabase/supabase-js";

const CAPABILITY_CACHE_MS = 30_000;
type SqlCapability = { available: boolean; timelineNesting: boolean };
let capabilityCache: { expiresAt: number; value: SqlCapability } | undefined;
let pendingCapability: Promise<SqlCapability> | undefined;

async function readSqlCapability(supabase: SupabaseClient): Promise<SqlCapability> {
  try {
    const { data, error } = await supabase.rpc("composition_grouping_capabilities").retry(false).abortSignal(AbortSignal.timeout(3_000));
    const available = !error && data?.groupingVersion === 2 && data?.maxDepth === 8 && data?.contract === "nested-composition-groups-v2";
    return { available, timelineNesting: available && data?.timelineNesting === true };
  } catch { return { available: false, timelineNesting: false }; }
}

/** La env habilita intención; el contrato SQL confirma disponibilidad, con fallo cerrado. */
export async function getCompositionGroupingCapabilities(supabase: SupabaseClient) {
  let capability: SqlCapability = { available: false, timelineNesting: false };
  if (process.env.COMPOSITION_NESTED_GROUPS_ENABLED === "true") {
    const cached = capabilityCache;
    if (cached && cached.expiresAt > Date.now()) capability = cached.value;
    else {
      // El proceso servidor usa un único proyecto Supabase; compartir la consulta
      // evita que cada cliente service-role nuevo consulte por cada gesto.
      pendingCapability ??= readSqlCapability(supabase);
      capability = await pendingCapability;
      capabilityCache = { expiresAt: Date.now() + CAPABILITY_CACHE_MS, value: capability };
      pendingCapability = undefined;
    }
  }
  return { groupingVersion: 2 as const, canCreateNestedGroups: capability.available, canNestTimeline: capability.timelineNesting };
}
