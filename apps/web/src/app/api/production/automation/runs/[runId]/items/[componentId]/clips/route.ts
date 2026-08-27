import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenScenesService } from "@/domains/production/providers/heygen/heygen-scenes.service";
import { createClient } from "@/utils/supabase/server";

const editsSchema = z.object({ clips: z.array(z.object({ id: z.string().min(1), avatarPresetId: z.string().uuid().optional(), voicePresetId: z.string().uuid().optional() }).strict()).min(1) }).strict();

async function authorize(params: Promise<{ componentId: string; runId: string }>) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  const tenant = await resolveActiveTenantContext();
  if (!user || !tenant || !(await canReviewContent(user.userId, tenant))) return null;
  const ids = await params;
  const admin = getServiceRoleClient();
  const { data: item } = await admin.from("production_run_items")
    .select("material_component_id")
    .eq("production_run_id", ids.runId).eq("organization_id", tenant.organizationId).eq("material_component_id", ids.componentId).maybeSingle();
  return item ? { admin, ids, tenant } : null;
}

/** Creates editable scene drafts only; it does not contact HeyGen. */
export async function POST(_request: Request, context: { params: Promise<{ componentId: string; runId: string }> }) {
  const authorized = await authorize(context.params);
  if (!authorized) return NextResponse.json({ error: "No autorizado o componente no encontrado." }, { status: 403 });
  const { data: component, error } = await authorized.admin.from("material_components").select("id, assets, content").eq("id", authorized.ids.componentId).maybeSingle();
  if (error || !component) return NextResponse.json({ error: "Componente no encontrado." }, { status: 404 });
  const scenes = new HeygenScenesService(authorized.admin).buildSceneClips({ componentContent: component.content, existingClips: component.assets?.avatar_clips });
  const assets = await new HeygenScenesService(authorized.admin).saveSceneClips({ avatarGenerationMode: "scene_clips", clips: scenes, componentId: component.id });
  return NextResponse.json({ success: true, data: { clips: assets.avatar_clips || [] } });
}

/** Saves explicit avatar/voice choices per scene before the worker is dispatched. */
export async function PUT(request: Request, context: { params: Promise<{ componentId: string; runId: string }> }) {
  const authorized = await authorize(context.params);
  if (!authorized) return NextResponse.json({ error: "No autorizado o componente no encontrado." }, { status: 403 });
  const parsed = editsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Cambios de clips inválidos." }, { status: 400 });
  const { data: component, error } = await authorized.admin.from("material_components").select("id, assets, content").eq("id", authorized.ids.componentId).maybeSingle();
  if (error || !component) return NextResponse.json({ error: "Componente no encontrado." }, { status: 404 });
  const service = new HeygenScenesService(authorized.admin);
  const edits = new Map(parsed.data.clips.map((clip) => [clip.id, clip]));
  const clips = service.buildSceneClips({ componentContent: component.content, existingClips: component.assets?.avatar_clips }).map((clip) => {
    const edit = edits.get(clip.id);
    return edit ? {
      ...clip,
      ...(edit.avatarPresetId ? { avatar_preset_id: edit.avatarPresetId } : {}),
      ...(edit.voicePresetId ? { voice_preset_id: edit.voicePresetId } : {}),
    } : clip;
  });
  const assets = await service.saveSceneClips({ avatarGenerationMode: "scene_clips", clips, componentId: component.id });
  return NextResponse.json({ success: true, data: { clips: assets.avatar_clips || [] } });
}
