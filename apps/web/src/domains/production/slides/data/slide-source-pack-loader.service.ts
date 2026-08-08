import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSourceInsights,
  type SlideSourcePack,
} from "../content/slide-source-pack.service";

interface CurationRowSourceRecord {
  cobertura_completa?: boolean | null;
  is_critical?: boolean | null;
  notes?: string | null;
  source_rationale?: string | null;
  source_ref: string;
  source_title?: string | null;
  validation_report?: unknown;
}

function uniqueRowsByRef(rows: CurationRowSourceRecord[]) {
  const seen = new Set<string>();
  const unique: CurationRowSourceRecord[] = [];

  for (const row of rows) {
    if (!row.source_ref || seen.has(row.source_ref)) {
      continue;
    }
    seen.add(row.source_ref);
    unique.push(row);
  }

  return unique;
}

function sortRowsByPreferredRefs(
  rows: CurationRowSourceRecord[],
  preferredSourceRefs: string[],
) {
  if (preferredSourceRefs.length === 0) {
    return rows;
  }

  const preferred = new Set(preferredSourceRefs);
  return [...rows].sort((left, right) => {
    const leftPreferred = preferred.has(left.source_ref) ? 1 : 0;
    const rightPreferred = preferred.has(right.source_ref) ? 1 : 0;
    return rightPreferred - leftPreferred;
  });
}

async function queryApprovedSourceRows(params: {
  curationId: string;
  lessonId?: string | null;
  supabase: SupabaseClient;
}) {
  let query = params.supabase
    .from("curation_rows")
    .select("source_ref, source_title, source_rationale, notes, is_critical, cobertura_completa, validation_report")
    .eq("curation_id", params.curationId)
    .eq("apta", true)
    .or("forbidden_override.is.null,forbidden_override.eq.false")
    .order("is_critical", { ascending: false })
    .order("cobertura_completa", { ascending: false })
    .limit(12);

  if (params.lessonId) {
    query = query.eq("lesson_id", params.lessonId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data || []) as CurationRowSourceRecord[];
}

export async function loadSlideSourcePack(params: {
  artifactId: string;
  lessonId?: string | null;
  sourceRefs?: unknown;
  supabase: SupabaseClient;
}): Promise<SlideSourcePack> {
  const { data: curation, error: curationError } = await params.supabase
    .from("curation")
    .select("id")
    .eq("artifact_id", params.artifactId)
    .maybeSingle();

  if (curationError) {
    throw curationError;
  }

  if (!curation?.id) {
    return { items: [], sourceRefs: [] };
  }

  const preferredSourceRefs = Array.isArray(params.sourceRefs)
    ? params.sourceRefs.filter((sourceRef): sourceRef is string => typeof sourceRef === "string" && sourceRef.trim().length > 0)
    : [];

  const lessonRows = await queryApprovedSourceRows({
    curationId: curation.id,
    lessonId: params.lessonId,
    supabase: params.supabase,
  });
  const sourceRows = lessonRows.length > 0 || !params.lessonId
    ? lessonRows
    : await queryApprovedSourceRows({
        curationId: curation.id,
        supabase: params.supabase,
      });

  const rows = uniqueRowsByRef(
    sortRowsByPreferredRefs(sourceRows, preferredSourceRefs),
  );
  const items = rows.map((row) => {
    const validationReport = row.validation_report &&
      typeof row.validation_report === "object" &&
      !Array.isArray(row.validation_report)
      ? row.validation_report as { content_excerpt?: unknown }
      : null;

    return {
      coberturaCompleta: row.cobertura_completa,
      excerpt: typeof validationReport?.content_excerpt === "string"
        ? validationReport.content_excerpt
        : null,
      isCritical: row.is_critical,
      notes: row.notes,
      rationale: row.source_rationale,
      ref: row.source_ref,
      title: row.source_title,
    };
  });

  return {
    insights: buildSourceInsights(items),
    items,
    sourceRefs: rows.map((row) => row.source_ref),
  };
}
