import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { compositionPresetApplicationRequestSchema } from "@/domains/production/composition-editor/composition-preset.types";
import {
  createCompositionPresetPreview,
  getRecoverableCompositionPresetApplication,
  CompositionPresetStoreError,
} from "@/domains/production/composition-editor/composition-preset-store.service";
import { CompositionPresetApplicationError } from "@/domains/production/composition-editor/composition-preset-application.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Recovers a safe undo affordance after the editor is reloaded. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const data = await getRecoverableCompositionPresetApplication({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "El borrador no es válido." }, {
      status: 400,
      headers: { "Cache-Control": "private, no-store" },
    });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresetRecovery] Lookup failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo recuperar la última aplicación del preset." }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

/** Persists an expiring preview; the current editor document remains untouched. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const body = compositionPresetApplicationRequestSchema.parse(await request.json());
    const data = await createCompositionPresetPreview({
      draftId: z.string().uuid().parse((await context.params).draftId),
      organizationId: authorization.organizationId,
      presetId: body.presetId,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    console.info("[CompositionPresets] Preview created", {
      affectedClipCount: data.summary.affectedClipCount,
      affectedTrackCount: data.summary.affectedTrackCount,
      event: "composition_preset_preview_created",
      generatedAnimationCount: data.summary.generatedAnimationCount,
      warningCount: data.summary.warnings.length,
    });
    return NextResponse.json({ success: true, data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud del preset no es válida." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof CompositionPresetApplicationError || error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresetPreview] Creation failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el preview del preset." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

