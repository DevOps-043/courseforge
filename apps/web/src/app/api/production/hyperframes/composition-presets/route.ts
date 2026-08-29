import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { listCompositionPresetCatalog, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../_composition-preset-route-support";

export async function GET() {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const data = await listCompositionPresetCatalog({
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresets] Catalog failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo cargar el catálogo de presets." }, { status: 500 });
  }
}

