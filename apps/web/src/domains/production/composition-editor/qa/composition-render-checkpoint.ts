import {isAbsolute} from "node:path";
import {z} from "zod";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {COMPOSITION_EVENT_PLAN_MAX_BATCHES} from "../composition-conformance-batch-contract";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {renderSupervisorReceiptSchema} from "../composition-render-supervisor-receipt";
import {buildControlledSupervisorBinding} from "./composition-render-supervisor-binding";

export const CONTROLLED_RENDER_CHECKPOINT_POLICY = {version:1, maximumBytes:20 * 1024 ** 2} as const;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const renderCheckpointScopeSchema = z.object({organizationId:uuid,requestId:uuid,executionId:uuid,
  revisionId:uuid,productionJobId:uuid}).strict();
export type RenderCheckpointScope = z.output<typeof renderCheckpointScopeSchema>;
const singleInput = z.object({contract:compositionConformanceContractSchema,observation:z.unknown(),
  documentHash:hash,videoSha256:hash,seekRepeatability:z.unknown().optional(),nativeEvidence:z.unknown().optional()}).strict();
const eventInput = z.object({document:compositionEditorDocumentSchema,parentContract:compositionConformanceContractSchema,
  observation:z.unknown(),videoSha256:hash,batches:z.array(z.object({contract:compositionConformanceContractSchema,
    seekRepeatability:z.unknown().optional(),nativeEvidence:z.unknown().optional()}).strict()).min(1).max(COMPOSITION_EVENT_PLAN_MAX_BATCHES)}).strict();
const checkpointSchema = z.object({version:z.literal(CONTROLLED_RENDER_CHECKPOINT_POLICY.version),
  scope:renderCheckpointScopeSchema,leaseToken:uuid,supervisorReceipt:renderSupervisorReceiptSchema,
  videoPath:z.string().min(1).max(4096).refine(isAbsolute),artifacts:z.discriminatedUnion("kind",[
    z.object({kind:z.literal("SINGLE_CONTRACT"),input:singleInput}).strict(),
    z.object({kind:z.literal("EVENT_BATCH_SET"),input:eventInput}).strict(),
  ])}).strict();
export type ControlledRenderCheckpoint = z.output<typeof checkpointSchema>;

/** Validates local recovery evidence; the authority service still verifies signature, revocation and ledger. */
export function parseControlledRenderCheckpoint(raw: unknown, expectedScope: RenderCheckpointScope): ControlledRenderCheckpoint {
  try {
    if (Buffer.byteLength(JSON.stringify(raw),"utf8") > CONTROLLED_RENDER_CHECKPOINT_POLICY.maximumBytes) throw new Error();
    const expected = renderCheckpointScopeSchema.parse(expectedScope);
    const checkpoint = checkpointSchema.parse(raw);
    if (Object.entries(expected).some(([field,value]) => checkpoint.scope[field as keyof RenderCheckpointScope] !== value))
      throw new Error();
    const signed = checkpoint.supervisorReceipt.payload.binding;
    if (Object.entries(expected).some(([field,value]) => signed[field as keyof RenderCheckpointScope] !== value)) throw new Error();
    const contract = checkpoint.artifacts.kind === "SINGLE_CONTRACT" ? checkpoint.artifacts.input.contract
      : checkpoint.artifacts.input.parentContract;
    const derived = buildControlledSupervisorBinding({...signed,contract},checkpoint.artifacts,
      {sha256:signed.videoSha256,sizeBytes:signed.sizeBytes});
    if (JSON.stringify(derived) !== JSON.stringify(signed)) throw new Error();
    return checkpoint;
  } catch {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_INVALID");}
}
