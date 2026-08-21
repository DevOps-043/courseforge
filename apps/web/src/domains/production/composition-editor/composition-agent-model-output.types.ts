import { z } from "zod";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types";
import { COMPOSITION_MOTION_PRESET_IDS } from "./composition-motion.types";
import { compositionEditorPatchRequestSchema } from "./editor-patch.types";
import { COMPOSITION_LAYER_MAX, COMPOSITION_LAYER_MIN } from "./composition-layer-depth";

const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
const secondsSchema = z.number().finite().min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS);
const nullableBoolean = z.boolean().nullable();
const nullableNumber = z.number().finite().nullable();

const nullableLayoutSchema = z.object({
  height: nullableNumber,
  opacity: nullableNumber,
  rotation: nullableNumber,
  width: nullableNumber,
  x: nullableNumber,
  y: nullableNumber,
  zIndex: z.number().int().min(COMPOSITION_LAYER_MIN).max(COMPOSITION_LAYER_MAX).nullable(),
}).strict();

const modelOperationSchema = z.discriminatedUnion("type", [
  z.object({ clipId: editorIdSchema, startSeconds: secondsSchema, trackId: editorIdSchema.nullable(), type: z.literal("clip.move") }).strict(),
  z.object({ clipId: editorIdSchema, durationSeconds: secondsSchema.positive(), type: z.literal("clip.duration") }).strict(),
  z.object({ clipId: editorIdSchema, layout: nullableLayoutSchema, type: z.literal("clip.layout") }).strict(),
  z.object({ clipId: editorIdSchema, hidden: z.boolean(), type: z.literal("clip.visibility") }).strict(),
  z.object({
    settings: z.object({ hidden: nullableBoolean, locked: nullableBoolean, muted: nullableBoolean, volume: nullableNumber }).strict(),
    trackId: editorIdSchema,
    type: z.literal("track.update"),
  }).strict(),
  z.object({
    settings: z.object({ attackSeconds: nullableNumber, duckedVolumeRatio: nullableNumber, enabled: nullableBoolean, releaseSeconds: nullableNumber }).strict(),
    type: z.literal("audio-mix.update"),
  }).strict(),
  z.object({
    animationId: editorIdSchema,
    clipId: editorIdSchema,
    durationSeconds: secondsSchema.positive(),
    presetId: z.enum(COMPOSITION_MOTION_PRESET_IDS),
    type: z.literal("animation.add-preset"),
  }).strict(),
  z.object({
    animationId: editorIdSchema,
    timing: z.object({
      anchor: z.enum(["CLIP_END", "CLIP_START"]).nullable(),
      durationSeconds: secondsSchema.positive().nullable(),
      offsetSeconds: secondsSchema.nullable(),
    }).strict(),
    type: z.literal("animation.update-timing"),
  }).strict(),
]);

/** Provider-facing schema: every key is required; unused partial values are null. */
export const compositionAgentModelOutputSchema = z.object({
  operations: z.array(modelOperationSchema).min(1).max(12),
  summary: z.string().trim().min(3).max(300),
}).strict();

export type CompositionAgentModelOutput = z.infer<typeof compositionAgentModelOutputSchema>;

const compositionAgentLooseEnvelopeSchema = z.object({
  operations: z.array(z.unknown()).min(1).max(12),
  summary: z.string().trim().min(3).max(300),
}).strict();

/** Converts the strict provider contract into the narrower persisted patch contract. */
export function normalizeCompositionAgentModelOutput(input: unknown) {
  const output = compositionAgentLooseEnvelopeSchema.parse(stripNullValues(input));
  return compositionEditorPatchRequestSchema.parse({ ...output, source: "AGENT" });
}

export function getCompositionAgentJsonSchema() {
  const schema = z.toJSONSchema(compositionAgentModelOutputSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Provider-safe envelope; the decoded payload is still validated by the authoritative Zod union. */
export function getCompositionAgentProviderJsonSchema() {
  const operationTypes = [
    "animation.add-preset", "animation.update-timing", "audio-mix.update",
    "clip.duration", "clip.layout", "clip.move", "clip.visibility", "track.update",
  ];
  return {
    additionalProperties: false,
    properties: {
      operations: {
        items: {
          additionalProperties: false,
          properties: {
            argumentsJson: { description: "JSON object with the operation fields except type.", type: "string" },
            type: { enum: operationTypes, type: "string" },
          },
          propertyOrdering: ["type", "argumentsJson"],
          required: ["type", "argumentsJson"],
          type: "object",
        },
        maxItems: 12,
        minItems: 1,
        type: "array",
      },
      summary: { type: "string" },
    },
    propertyOrdering: ["operations", "summary"],
    required: ["operations", "summary"],
    type: "object",
  };
}

/** Decodes the compact provider envelope before authoritative Zod validation. */
export function normalizeCompactCompositionAgentModelOutput(input: unknown) {
  const envelope = z.object({
    operations: z.array(z.object({
      argumentsJson: z.string().min(2).max(4_000),
      type: z.string().min(1).max(80),
    }).strict()).min(1).max(12),
    summary: z.string().trim().min(3).max(300),
  }).strict().parse(input);
  const operations = envelope.operations.map((operation) => {
    const args = JSON.parse(operation.argumentsJson) as unknown;
    if (!args || typeof args !== "object" || Array.isArray(args) || "type" in args) {
      throw new Error("Los argumentos de la operación no son válidos.");
    }
    return { ...(args as Record<string, unknown>), type: operation.type };
  });
  return normalizeCompositionAgentModelOutput({ operations, summary: envelope.summary });
}

function stripNullValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, stripNullValues(entry)]),
  );
}
