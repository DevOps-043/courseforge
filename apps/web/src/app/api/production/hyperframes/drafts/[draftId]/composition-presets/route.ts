import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { proposeCompositionEdits, CompositionAgentProposalError } from "@/domains/production/composition-editor/composition-agent.service";
import { getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { applyCompositionEditorPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { extractCompositionPresetDefinition } from "@/domains/production/composition-editor/composition-preset-extraction.service";
import { compositionPresetCreateRequestSchema } from "@/domains/production/composition-editor/composition-preset.types";
import { createStoredCompositionPreset, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Creates a reusable preset from the saved manual edit or a constrained AI transformation. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const body = compositionPresetCreateRequestSchema.parse(await request.json());
    const current = await getCurrentCompositionDocument({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    let patternSource = current.document;
    if (body.mode === "INSTRUCTIONS") {
      const proposal = await proposeCompositionEdits({
        baseDocumentHash: current.documentHash,
        document: current.document,
        input: { instruction: body.instruction },
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      });
      patternSource = applyCompositionEditorPatches(current.document, proposal.operations, "AGENT");
    }
    const extracted = extractCompositionPresetDefinition(patternSource);
    const data = await createStoredCompositionPreset({
      definition: extracted.definition,
      description: body.description,
      diagnostics: extracted.diagnostics,
      instruction: body.instruction,
      name: body.name,
      organizationId: authorization.organizationId,
      sourceDocumentHash: current.documentHash,
      sourceKind: body.mode,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Los datos del preset no son válidos." }, { status: 400 });
    }
    if (error instanceof CompositionAgentProposalError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
    }
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresets] Creation failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo crear el preset." }, { status: 500 });
  }
}

