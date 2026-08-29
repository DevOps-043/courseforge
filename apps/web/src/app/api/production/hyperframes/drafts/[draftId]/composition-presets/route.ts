import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { proposeCompositionEdits, CompositionAgentProposalError } from "@/domains/production/composition-editor/composition-agent.service";
import { getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { applyCompositionEditorPatches } from "@/domains/production/composition-editor/editor-patch.service";
import { extractCompositionPresetDefinition } from "@/domains/production/composition-editor/composition-preset-extraction.service";
import { compositionPresetCreateRequestSchema } from "@/domains/production/composition-editor/composition-preset.types";
import { createStoredCompositionPreset, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import {
  authorizeCompositionPresetRequest,
  compositionPresetErrorResponse,
  resolveCompositionPresetMutationPrecondition,
} from "../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Creates a reusable preset from the saved manual edit or a constrained AI transformation. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const precondition = resolveCompositionPresetMutationPrecondition({
      documentId: draftId,
      operation: "CREATE",
      request,
    });
    if (!precondition.ok) return precondition.response;
    const body = compositionPresetCreateRequestSchema.parse(await request.json());
    const current = await getCurrentCompositionDocument({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    if (current.documentHash !== precondition.documentHash) {
      throw new CompositionPresetStoreError(
        "La edición cambió antes de crear el preset. Recarga el editor y vuelve a intentarlo.",
        "COMPOSITION_PRESET_VERSION_CONFLICT",
        409,
      );
    }
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
    console.info("[CompositionPresets] Preset created", {
      diagnosticCount: extracted.diagnostics.length,
      event: "composition_preset_created",
      mode: body.mode,
      ruleCount: extracted.definition.rules.length,
    });
    return NextResponse.json({ success: true, data }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Los datos del preset no son válidos." }, {
        status: 400,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (error instanceof CompositionAgentProposalError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresets] Creation failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo crear el preset." }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

