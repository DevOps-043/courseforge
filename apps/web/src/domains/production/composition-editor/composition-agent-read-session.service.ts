import { z } from "zod";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document-hash";
import { COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES, COMPOSITION_AGENT_MAX_OPERATIONS } from "./composition-agent-policy.service";
import { COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";
import { assertCompositionAgentJsonInputBudget, CompositionAgentInputBudgetError } from "./composition-agent-input-budget.service";
import {
  assertCompositionAgentReadDocumentLimits,
  compositionAgentReadBytes,
  CompositionAgentReadError,
  freezeCompositionAgentReadValue,
  getCompositionAgentTimelineConflicts,
  projectCompositionAgentReadDocument,
} from "./composition-agent-read-tools.service";

export const COMPOSITION_AGENT_READ_TOOL_NAMES = [
  "get_composition", "get_selected_elements", "get_timeline_conflicts", "get_motion_catalog", "get_operation_catalog",
] as const;

export const COMPOSITION_AGENT_SESSION_LIMITS = Object.freeze({
  maxRequestBytes: 4 * 1024,
  maxCalls: 12,
  maxResponseBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxWorkUnits: 50_000,
  maxDocumentBytes: 2 * 1024 * 1024,
});

export const compositionAgentScopeSchema = z.object({
  documentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  revision: z.number().int().positive().safe(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type CompositionAgentScope = z.infer<typeof compositionAgentScopeSchema>;

/** Host-only authorization result. Never deserialize a grant from model/client input. */
export const compositionAgentAuthorizationSchema = z.object({
  scope: compositionAgentScopeSchema,
  expiresAtMs: z.number().int().nonnegative().safe(),
  tools: z.array(z.enum(COMPOSITION_AGENT_READ_TOOL_NAMES)).max(COMPOSITION_AGENT_READ_TOOL_NAMES.length),
  canSimulate: z.boolean(),
  operationTypes: z.array(z.enum(COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES)).max(COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES.length),
}).strict();
export type CompositionAgentAuthorization = z.infer<typeof compositionAgentAuthorizationSchema>;

const pageSchema = z.object({ offset: z.number().int().min(0).max(500).default(0), limit: z.number().int().min(1).max(50).default(50) }).strict();
export const compositionAgentReadRequestSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("get_composition"), arguments: pageSchema.extend({ section: z.enum(["summary", "clips", "tracks", "motion"]) }).strict() }).strict(),
  z.object({ tool: z.literal("get_selected_elements"), arguments: pageSchema }).strict(),
  z.object({ tool: z.literal("get_timeline_conflicts"), arguments: pageSchema }).strict(),
  z.object({ tool: z.literal("get_motion_catalog"), arguments: z.object({}).strict() }).strict(),
  z.object({ tool: z.literal("get_operation_catalog"), arguments: z.object({}).strict() }).strict(),
]);

const budgetSchema = z.object({
  maxCalls: z.number().int().min(1).max(COMPOSITION_AGENT_SESSION_LIMITS.maxCalls),
  maxResponseBytes: z.number().int().min(1).max(COMPOSITION_AGENT_SESSION_LIMITS.maxResponseBytes),
  maxTotalBytes: z.number().int().min(1).max(COMPOSITION_AGENT_SESSION_LIMITS.maxTotalBytes),
  maxWorkUnits: z.number().int().min(1).max(COMPOSITION_AGENT_SESSION_LIMITS.maxWorkUnits),
}).strict();
type ReadBudget = z.infer<typeof budgetSchema>;

export function assertCompositionAgentScope(scope: CompositionAgentScope, grant: CompositionAgentAuthorization, now: number) {
  if (!Number.isFinite(now) || grant.expiresAtMs <= now) {
    throw new CompositionAgentReadError("AGENT_READ_EXPIRED", "La autorización local del agente expiró.");
  }
  if (scope.documentId !== grant.scope.documentId || scope.organizationId !== grant.scope.organizationId || scope.userId !== grant.scope.userId) {
    throw new CompositionAgentReadError("AGENT_READ_FORBIDDEN", "La autorización no corresponde al documento, empresa o usuario.");
  }
  if (scope.revision !== grant.scope.revision || scope.documentHash !== grant.scope.documentHash) {
    throw new CompositionAgentReadError("AGENT_READ_STALE", "La autorización corresponde a otra revisión de la composición.");
  }
}

export function prepareCompositionAgentAuthorizedDocument(params: {
  document: CompositionEditorDocument;
  scope: CompositionAgentScope;
  authorization: CompositionAgentAuthorization;
  now: number;
}) {
  const scope = compositionAgentScopeSchema.parse(params.scope);
  const authorization = compositionAgentAuthorizationSchema.parse(params.authorization);
  assertCompositionAgentScope(scope, authorization, params.now);
  assertCompositionAgentReadDocumentLimits(params.document);
  if (compositionAgentReadBytes(params.document) > COMPOSITION_AGENT_SESSION_LIMITS.maxDocumentBytes) {
    throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "El documento excede el presupuesto de simulación/lectura.");
  }
  const document = compositionEditorDocumentSchema.parse(params.document);
  if (hashCompositionDocument(document) !== scope.documentHash) {
    throw new CompositionAgentReadError("AGENT_READ_STALE", "El hash autorizado no corresponde al documento recibido.");
  }
  return { document, scope, authorization };
}

/** Pure local session. Its counters are not an organization quota or a durable authorization service. */
export function createCompositionAgentReadSession(params: {
  document: CompositionEditorDocument;
  scope: CompositionAgentScope;
  authorization: CompositionAgentAuthorization;
  selectedClipIds?: string[];
  budget?: Partial<ReadBudget>;
  now?: () => number;
}) {
  const now = params.now ?? Date.now;
  const { document, scope, authorization } = prepareCompositionAgentAuthorizedDocument({ ...params, now: now() });
  const budget = budgetSchema.parse({
    maxCalls: COMPOSITION_AGENT_SESSION_LIMITS.maxCalls,
    maxResponseBytes: COMPOSITION_AGENT_SESSION_LIMITS.maxResponseBytes,
    maxTotalBytes: COMPOSITION_AGENT_SESSION_LIMITS.maxTotalBytes,
    maxWorkUnits: COMPOSITION_AGENT_SESSION_LIMITS.maxWorkUnits,
    ...params.budget,
  });
  const selectedClipIds = z.array(z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i)).max(50).parse(params.selectedClipIds ?? []);
  if (new Set(selectedClipIds).size !== selectedClipIds.length || selectedClipIds.some((id) => !document.clips.some((clip) => clip.id === id))) {
    throw new CompositionAgentReadError("AGENT_READ_FORBIDDEN", "La selección autorizada contiene IDs desconocidos o repetidos.");
  }
  const composition = freezeCompositionAgentReadValue(projectCompositionAgentReadDocument(document));
  const used = { calls: 0, responseBytes: 0, workUnits: 0 };
  const consumeWork = (units: number) => {
    used.workUnits += units;
    if (used.workUnits > budget.maxWorkUnits) limitExceeded();
  };

  const page = <T>(items: readonly T[], offset: number, limit: number) => ({
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  });

  return Object.freeze({
    usage: () => Object.freeze({ ...used }),
    read(input: unknown) {
      // Failed/forbidden/malformed calls also consume attempts; no reset on model repair.
      used.calls += 1;
      if (used.calls > budget.maxCalls) limitExceeded();
      assertCompositionAgentScope(scope, authorization, now());
      try {
        assertCompositionAgentJsonInputBudget(input, COMPOSITION_AGENT_SESSION_LIMITS.maxRequestBytes);
      } catch (error) {
        if (error instanceof CompositionAgentInputBudgetError && error.code === "AGENT_INPUT_LIMIT_EXCEEDED") limitExceeded();
        throw error;
      }
      const request = compositionAgentReadRequestSchema.parse(input);
      if (!authorization.tools.includes(request.tool)) {
        throw new CompositionAgentReadError("AGENT_READ_FORBIDDEN", "La herramienta de lectura no está autorizada.");
      }
      consumeWork(document.clips.length + document.tracks.length + document.motion.animations.length + 1);
      let result: unknown;
      switch (request.tool) {
        case "get_composition": {
          const args = request.arguments;
          result = args.section === "summary"
            ? { audioMix: composition.audioMix, canvas: composition.canvas, counts: { clips: composition.clips.length, tracks: composition.tracks.length, motion: composition.motion.length } }
            : page<unknown>(composition[args.section], args.offset, args.limit);
          break;
        }
        case "get_selected_elements":
          result = page(composition.clips.filter((clip) => selectedClipIds.includes(clip.id)), request.arguments.offset, request.arguments.limit);
          break;
        case "get_timeline_conflicts":
          consumeWork(document.clips.length * document.tracks.length);
          result = page(getCompositionAgentTimelineConflicts(document, consumeWork), request.arguments.offset, request.arguments.limit);
          break;
        case "get_motion_catalog":
          result = { presetIds: [...COMPOSITION_MOTION_PRESET_IDS] };
          break;
        case "get_operation_catalog":
          result = { operationTypes: [...authorization.operationTypes], maxOperations: COMPOSITION_AGENT_MAX_OPERATIONS, requiresConfirmation: true, automaticApply: false };
          break;
      }
      const response = { documentHash: scope.documentHash, revision: scope.revision, tool: request.tool, result };
      const bytes = compositionAgentReadBytes(response);
      if (bytes > budget.maxResponseBytes || used.responseBytes + bytes > budget.maxTotalBytes) limitExceeded();
      used.responseBytes += bytes;
      return freezeCompositionAgentReadValue(response);
    },
  });
}

function limitExceeded(): never {
  throw new CompositionAgentReadError("AGENT_READ_LIMIT_EXCEEDED", "La lectura excede el presupuesto local del agente.");
}
