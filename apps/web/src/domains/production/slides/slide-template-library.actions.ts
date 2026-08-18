"use server";

import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getAuthBridgeUser, getUserOrganizations } from "@/utils/auth/session";
import { createClient } from "@/utils/supabase/server";

export interface SlideTemplateLibraryItem {
  id: string;
  conversation_id: string;
  organization_id: string;
  spec_id: string | null;
  title: string;
  description: string | null;
  package_id: string | null;
  status: "QUEUED" | "RUNNING" | "PACKAGED" | "VALIDATION_FAILED" | "SUBMITTED_FOR_REVIEW" | "FAILED";
  bundle_storage_path: string | null;
  output_hash: string | null;
  error_sanitized: string | null;
  created_at: string;
  finished_at: string | null;
  layouts: string[];
  example_slide_count: number;
  preview_design: { accent: string; accent2: string; background: string; muted: string; surface: string; text: string } | null;
  preview_slides: Array<{ body_items: string[]; chart_points: number[]; layout: string | null; order: number; subtitle: string | null; title: string; type: string }>;
  runtime_canvas: { width: number; height: number; aspectRatio: string } | null;
  validation_report: { isValid?: boolean; errors?: string[]; warnings?: string[]; info?: Record<string, unknown> } | null;
}

export async function getSlideTemplatePackagesAction(): Promise<{ success: boolean; slideTemplates?: SlideTemplateLibraryItem[]; error?: string }> {
  try {
    const supabase = await createClient();
    if (!await getAuthenticatedUser(supabase)) return { success: false, error: "Unauthorized" };
    const organizationId = await resolveOrganizationId();
    if (!organizationId) return { success: true, slideTemplates: [] };
    const admin = getServiceRoleClient();
    const { data: runs, error } = await admin.from("soflia_bundle_generation_runs")
      .select("id, conversation_id, organization_id, spec_id, status, output_hash, bundle_storage_path, validation_report, error_sanitized, created_at, finished_at")
      .eq("organization_id", organizationId).is("template_id", null).order("created_at", { ascending: false }).limit(80);
    if (error) throw error;
    if (!runs?.length) return { success: true, slideTemplates: [] };
    const conversationIds = [...new Set(runs.map((run: any) => run.conversation_id).filter(Boolean))];
    const specIds = [...new Set(runs.map((run: any) => run.spec_id).filter(Boolean))];
    const [{ data: conversations, error: conversationsError }, { data: specs, error: specsError }] = await Promise.all([
      conversationIds.length ? admin.from("soflia_bundle_conversations").select("id, title").eq("organization_id", organizationId).in("id", conversationIds) : Promise.resolve({ data: [], error: null }),
      specIds.length ? admin.from("soflia_bundle_specs").select("id, spec_json").eq("organization_id", organizationId).in("id", specIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (conversationsError) throw conversationsError;
    if (specsError) throw specsError;
    const conversationsById = new Map((conversations || []).map((row: any) => [row.id, row]));
    const specsById = new Map((specs || []).map((row: any) => [row.id, row]));
    return { success: true, slideTemplates: runs.flatMap((run: any) => {
      const specJson = specsById.get(run.spec_id)?.spec_json;
      if (!isSlideTemplateRun(run, specJson)) return [];
      const spec = asRecord(specJson);
      const conversation = conversationsById.get(run.conversation_id);
      return [{ id: run.id, conversation_id: run.conversation_id, organization_id: run.organization_id, spec_id: run.spec_id || null,
        title: typeof spec?.title === "string" ? spec.title : conversation?.title || "Plantilla de slides", description: typeof spec?.description === "string" ? spec.description : null,
        package_id: typeof spec?.packageId === "string" ? spec.packageId : null, status: run.status, bundle_storage_path: run.bundle_storage_path || null, output_hash: run.output_hash || null,
        error_sanitized: run.error_sanitized || null, created_at: run.created_at, finished_at: run.finished_at || null, layouts: getLayouts(specJson), example_slide_count: getExampleCount(specJson),
        preview_design: getPreviewDesign(specJson), preview_slides: getPreviewSlides(specJson), runtime_canvas: getCanvas(specJson), validation_report: asRecord(run.validation_report) }];
    }) };
  } catch (error: any) {
    console.error("[SlideTemplateLibrary] Failed to load packages", { message: error instanceof Error ? error.message : "unknown" });
    return { success: false, error: error?.message || "Error al obtener plantillas de slides" };
  }
}

async function resolveOrganizationId(): Promise<string | null> {
  const tenant = await resolveActiveTenantContext();
  if (tenant?.organizationId) return tenant.organizationId;
  const bridgeUser = await getAuthBridgeUser();
  if (bridgeUser?.active_organization_id) return bridgeUser.active_organization_id;
  if (bridgeUser?.organization_ids?.length) return bridgeUser.organization_ids[0];
  return (await getUserOrganizations())[0]?.id || null;
}
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function getLayouts(value: unknown): string[] { const spec = asRecord(value); const layouts = asRecord(spec?.templateBlueprint)?.layouts; return Array.isArray(layouts) ? layouts.map((item) => { const row = asRecord(item); return row?.label || row?.id; }).filter((item): item is string => typeof item === "string") : []; }
function getExampleCount(value: unknown): number { const examples = asRecord(value)?.examples; const first = Array.isArray(examples) ? asRecord(examples[0]) : null; return Array.isArray(first?.slides) ? first.slides.length : 0; }
function getPreviewDesign(value: unknown): SlideTemplateLibraryItem["preview_design"] { const tokens = asRecord(asRecord(value)?.templateBlueprint)?.designTokens; const color = (key: string, fallback: string) => typeof tokens?.[key] === "string" && /^#[0-9a-f]{6}$/i.test(tokens[key]) ? tokens[key] : fallback; return { accent: color("accent", "#00D4B3"), accent2: color("accent2", "#2D7D6E"), background: color("background", "#F7FAFC"), muted: color("muted", "#65758B"), surface: color("surface", "#FFFFFF"), text: color("text", "#0A2540") }; }
function getPreviewSlides(value: unknown): SlideTemplateLibraryItem["preview_slides"] { const examples = asRecord(value)?.examples; const slides = Array.isArray(examples) ? asRecord(examples[0])?.slides : []; return Array.isArray(slides) ? slides.slice(0, 4).map((slide, index) => { const row = asRecord(slide) || {}; const hints = asRecord(row.renderHints); const chart = asRecord(row.chart); return { body_items: Array.isArray(row.bodyBlocks) ? row.bodyBlocks.flatMap((block: unknown) => { const body = asRecord(block); return Array.isArray(body?.items) ? body.items.filter((item: unknown): item is string => typeof item === "string") : typeof body?.text === "string" ? [body.text] : []; }).slice(0, 4) : [], chart_points: Array.isArray(chart?.points) ? chart.points.map((point: unknown) => asRecord(point)?.value).filter((point: unknown): point is number => typeof point === "number" && Number.isFinite(point)).slice(0, 4) : [], layout: typeof hints?.layout === "string" ? hints.layout : null, order: typeof row.order === "number" ? row.order : index + 1, subtitle: typeof row.subtitle === "string" ? row.subtitle : null, title: typeof row.title === "string" ? row.title : `Slide ${index + 1}`, type: typeof row.type === "string" ? row.type : "slide" }; }) : []; }
function getCanvas(value: unknown): SlideTemplateLibraryItem["runtime_canvas"] { const canvas = asRecord(asRecord(asRecord(value)?.templateManifest)?.runtime)?.canvas; return typeof canvas?.width === "number" && typeof canvas?.height === "number" && typeof canvas?.aspectRatio === "string" ? { width: canvas.width, height: canvas.height, aspectRatio: canvas.aspectRatio } : null; }
function isSlideTemplateRun(run: Record<string, any>, specJson: unknown): boolean { return asRecord(asRecord(run.validation_report)?.info)?.artifactKind === "slide_template" || asRecord(specJson)?.artifactKind === "slide_template"; }
