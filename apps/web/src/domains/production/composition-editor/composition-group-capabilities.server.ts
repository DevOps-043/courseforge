import type { SupabaseClient } from "@supabase/supabase-js";

const CAPABILITY_CACHE_MS = 30_000;
let capabilityCache: { expiresAt: number; available: boolean } | undefined;
let pendingCapability: Promise<boolean> | undefined;

async function readSqlCapability(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("composition_grouping_capabilities").retry(false).abortSignal(AbortSignal.timeout(3_000));
    return !error && data?.groupingVersion === 2 && data?.maxDepth === 8 && data?.contract === "nested-composition-groups-v2";
  } catch { return false; }
}

/** La env habilita intención; el contrato SQL confirma disponibilidad, con fallo cerrado. */
export async function getCompositionGroupingCapabilities(supabase: SupabaseClient) {
  let available = false;
  if (process.env.COMPOSITION_NESTED_GROUPS_ENABLED === "true") {
    const cached = capabilityCache;
    if (cached && cached.expiresAt > Date.now()) available = cached.available;
    else {
      // El proceso servidor usa un único proyecto Supabase; compartir la consulta
      // evita que cada cliente service-role nuevo consulte por cada gesto.
      pendingCapability ??= readSqlCapability(supabase);
      available = await pendingCapability;
      capabilityCache = { expiresAt: Date.now() + CAPABILITY_CACHE_MS, available };
      pendingCapability = undefined;
    }
  }
  return { groupingVersion: 2 as const, canCreateNestedGroups: available };
}
