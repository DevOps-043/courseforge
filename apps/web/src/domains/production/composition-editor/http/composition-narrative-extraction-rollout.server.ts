import { z } from "zod";

/** Code deployment alone cannot activate an unverified RPC. */
export function narrativeExtractionPersistenceReady(): boolean {
  return process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY === "true";
}
export function narrativeExtractionApplyEnabled(): boolean {
  return narrativeExtractionPersistenceReady() && process.env.NARRATIVE_EXTRACTION_ENABLED === "true";
}
export function narrativeExtractionOrganizationEnabled(organizationId: string): boolean {
  const ids = (process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const parsed = z.array(z.string().uuid()).min(1).max(1000).safeParse(ids);
  return parsed.success && parsed.data.includes(organizationId);
}
