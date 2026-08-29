import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { compositionPresetApplicationRequestSchema } from "@/domains/production/composition-editor/composition-preset.types";
import { createCompositionPresetPreview, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { CompositionPresetApplicationError } from "@/domains/production/composition-editor/composition-preset-application.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ draftId: string }>; }

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
    return NextResponse.json({ success: true, data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud del preset no es válida." }, { status: 400 });
    if (error instanceof CompositionPresetApplicationError || error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresetPreview] Creation failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el preview del preset." }, { status: 500 });
  }
}

