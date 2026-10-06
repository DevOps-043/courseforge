import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ORGANIZATION_FONT_TABLE } from "../fonts/organization-font.types";
import { createNarrativeExtractionReadRepository } from "./composition-narrative-extraction.repository";
import { NARRATIVE_FRAGMENT_MAX_CLIPS } from "./composition-narrative-fragment.types";
import { CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import type { NarrativeFragmentReadRepository } from "./composition-narrative-fragment-query.server";

const REGISTRY_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_FIELDS = "id,organization_id,material_component_id,asset_type,mime_type,checksum,qa_status,duration_milliseconds";
function requireBoundedRows(rows: unknown, maximumRows: number): unknown[] {
  const parsed = z.array(z.unknown()).max(maximumRows).parse(rows);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > REGISTRY_RESPONSE_MAX_BYTES) throw new Error("NARRATIVE_FRAGMENT_REGISTRY_RESPONSE_LIMIT");
  return parsed;
}

/** Metadata-only batch reads; no Storage fetch, signed URLs, client operations or writes. */
export function createNarrativeFragmentReadRepository(supabase: SupabaseClient, signal: AbortSignal): NarrativeFragmentReadRepository {
  const reads = createNarrativeExtractionReadRepository(supabase, signal);
  return { readComponentId: reads.readComponentId, readDocument: reads.readDocument,
    async readAssets(scope, requestedIds, anchorAssetId) {
      const ids = z.array(z.string().uuid()).min(1).max(NARRATIVE_FRAGMENT_MAX_CLIPS).parse([...new Set(requestedIds)]);
      if (!ids.includes(anchorAssetId)) throw new Error("NARRATIVE_FRAGMENT_ANCHOR_MISSING");
      signal.throwIfAborted();
      const links = await supabase.from("video_composition_draft_assets").select("production_asset_id")
        .eq("organization_id", scope.organizationId).eq("draft_id", scope.draftId).in("production_asset_id", ids)
        .limit(ids.length + 1).retry(false).abortSignal(signal);
      signal.throwIfAborted(); if (links.error) throw links.error;
      const linked = z.array(z.object({ production_asset_id: z.string().uuid() }).strict()).max(ids.length)
        .parse(requireBoundedRows(links.data, ids.length));
      if (linked.length !== ids.length || new Set(linked.map(link => link.production_asset_id)).size !== ids.length
        || linked.some(link => !ids.includes(link.production_asset_id))) return [];
      const result = await supabase.from("production_assets").select(MEDIA_FIELDS)
        .eq("organization_id", scope.organizationId).eq("material_component_id", scope.componentId).in("id", ids)
        .limit(ids.length + 1).retry(false).abortSignal(signal);
      signal.throwIfAborted(); if (result.error) throw result.error;
      const rows = requireBoundedRows(result.data, ids.length);
      // Only the anchor needs full script/timestamp metadata, avoiding N transcript payloads.
      const anchor = await reads.readLinkedAsset(scope.draftId, scope.organizationId, scope.componentId, anchorAssetId);
      signal.throwIfAborted(); if (!anchor) return [];
      const boundedAnchor = requireBoundedRows([anchor], 1)[0];
      return rows.map(row => z.object({ id: z.string().uuid() }).parse(row).id === anchorAssetId ? boundedAnchor : row);
    },
    async readFonts(organizationId, requestedIds) {
      const ids = z.array(z.string().uuid()).min(1).max(CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts).parse([...new Set(requestedIds)]);
      signal.throwIfAborted();
      const result = await supabase.from(ORGANIZATION_FONT_TABLE)
        .select("id,organization_id,family,source,status,checksum_sha256,file_size_bytes,mime_type")
        .eq("organization_id", organizationId).in("id", ids).limit(ids.length + 1).retry(false).abortSignal(signal);
      signal.throwIfAborted(); if (result.error) throw result.error;
      return requireBoundedRows(result.data, ids.length);
    },
  };
}
