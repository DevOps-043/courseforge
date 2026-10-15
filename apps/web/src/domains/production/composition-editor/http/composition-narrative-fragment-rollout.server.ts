import { z } from "zod";

/** Operational acknowledgement of audiovisual RPC validation, not a migration detector. */
export function narrativeFragmentPersistenceReady(): boolean {
  return process.env.NARRATIVE_FRAGMENT_ATOMIC_RECEIPTS_READY === "true";
}
export function narrativeFragmentApplyEnabled(): boolean {
  return narrativeFragmentPersistenceReady() && process.env.NARRATIVE_FRAGMENT_ENABLED === "true";
}
export function narrativeFragmentOrganizationEnabled(organizationId: string): boolean {
  const ids = (process.env.NARRATIVE_FRAGMENT_ORGANIZATION_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const parsed = z.array(z.string().uuid()).min(1).max(1000).safeParse(ids);
  return parsed.success && parsed.data.includes(organizationId);
}
