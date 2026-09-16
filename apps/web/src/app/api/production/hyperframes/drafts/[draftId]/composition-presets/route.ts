import { z } from "zod";
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
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_COMPOSITION_PRESET_REQUEST_BYTES = 16 * 1024;

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Creates a reusable preset from the saved manual edit or a constrained AI transformation. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.composition_presets", { correlationId: requestId });
  try {
    const authorization = await authorizeCompositionPresetRequest(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const precondition = resolveCompositionPresetMutationPrecondition({
      documentId: draftId,
      operation: "CREATE",
      request,
      requestId,
    });
    if (!precondition.ok) return precondition.response;
    const parsed = await parseJsonRequest(request, compositionPresetCreateRequestSchema, MAX_COMPOSITION_PRESET_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Los datos del preset no son válidos.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const body = parsed.data;
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
    logger.info("production.hyperframes.composition_preset_created", {
      diagnosticCount: extracted.diagnostics.length,
      event: "composition_preset_created",
      mode: body.mode,
      ruleCount: extracted.definition.rules.length,
    });
    return apiSuccessResponse({ data }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, headers: { "Cache-Control": "private, no-store" }, message: error.issues[0]?.message || "Los datos del preset no son válidos.", requestId, status: 400 });
    }
    if (error instanceof CompositionAgentProposalError) {
      return apiErrorResponse({ code: error.status === 503 ? API_ERROR_CODE.dependencyUnavailable : API_ERROR_CODE.invalidRequest, details: { reason: error.code }, headers: { "Cache-Control": "private, no-store" }, message: error.message, requestId, retryable: error.retryable, status: error.status });
    }
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error, requestId);
    logger.error("production.hyperframes.composition_preset_create_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, headers: { "Cache-Control": "private, no-store" }, message: "No se pudo crear el preset.", requestId, retryable: true, status: 500 });
  }
}

