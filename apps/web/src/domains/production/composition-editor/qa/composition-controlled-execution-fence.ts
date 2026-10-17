import {randomUUID, createHash} from "node:crypto";
import {lstat, open, realpath, unlink} from "node:fs/promises";
import {isAbsolute, join, resolve} from "node:path";
import {z} from "zod";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import type {ControlledMaterializedExecutor} from "./composition-materialized-supervisor-renderer";

export const CONTROLLED_EXECUTION_FENCE_POLICY = {id: "LOCAL_HOST_PENDING_EXECUTION_V1", maximumBytes: 4096} as const;
const hostIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const leaseSchema = z.object({policy: z.literal(CONTROLLED_EXECUTION_FENCE_POLICY.id), hostId: hostIdSchema,
  nonce: uuid, organizationId: uuid, revisionId: uuid, executionId: uuid, documentHash: hash, projectHash: hash}).strict();
export type ControlledExecutionFenceLease = z.infer<typeof leaseSchema>;
type Descriptor = Parameters<ControlledMaterializedExecutor>[0];
export interface ControlledExecutionFence {
  acquire(descriptor: Descriptor): Promise<ControlledExecutionFenceLease>;
  releaseConfirmed(lease: ControlledExecutionFenceLease): Promise<void>;
}

/** Operator-owned local disk fence: process restarts retain unknown ownership.
 * Requires stable hostId/directory across restarts. Not a distributed lock or power-loss guarantee. */
export class CompositionControlledExecutionFenceStore implements ControlledExecutionFence {
  constructor(private readonly directory: string, private readonly hostId: string) {
    hostIdSchema.parse(hostId);
  }

  async acquire(descriptor: Descriptor): Promise<ControlledExecutionFenceLease> {
    const lease = leaseSchema.parse({policy: CONTROLLED_EXECUTION_FENCE_POLICY.id, hostId: this.hostId,
      nonce: randomUUID(), organizationId: descriptor.organizationId, revisionId: descriptor.revisionId,
      executionId: descriptor.executionId, documentHash: descriptor.documentHash, projectHash: descriptor.projectHash});
    const path = await this.path();
    const bytes = JSON.stringify(lease);
    if (Buffer.byteLength(bytes) > CONTROLLED_EXECUTION_FENCE_POLICY.maximumBytes)
      throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_INVALID");
    let handle;
    try {handle = await open(path, "wx", 0o600);}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_PENDING");
      throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_ACQUIRE_UNCONFIRMED");
    }
    try {
      await handle.writeFile(bytes, "utf8"); await handle.sync();
      return lease;
    } catch {throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_ACQUIRE_UNCONFIRMED");}
    finally {
      try {await handle.close();} catch {throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_ACQUIRE_UNCONFIRMED");}
    }
  }

  /** Only the lifecycle owner calls this after a matching physical-stop confirmation.
   * No public cleanup/delete endpoint, stale-PID, TTL expiry, or automatic reclaim. */
  async releaseConfirmed(raw: ControlledExecutionFenceLease) {
    try {
      const lease = leaseSchema.parse(raw);
      if (lease.hostId !== this.hostId) throw new Error();
      const path = await this.path();
      const stat = await lstat(path);
      if (stat.nlink !== 1) throw new Error();
      const pin = await pinConformanceFile(path, CONTROLLED_EXECUTION_FENCE_POLICY.maximumBytes);
      const handle = await open(path, "r");
      const chunks: Buffer[] = []; let size = 0;
      try {
        for await (const chunk of handle.createReadStream({autoClose: false})) {
          const bytes = chunk as Buffer; size += bytes.length;
          if (size > CONTROLLED_EXECUTION_FENCE_POLICY.maximumBytes || size > pin.sizeBytes) throw new Error();
          chunks.push(bytes);
        }
      } finally {await handle.close();}
      const encoded = Buffer.concat(chunks, size);
      if (size !== pin.sizeBytes || createHash("sha256").update(encoded).digest("hex") !== pin.sha256) throw new Error();
      const stored = leaseSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(encoded)));
      if (JSON.stringify(stored) !== JSON.stringify(lease)) throw new Error();
      await assertConformanceFileUnchanged(path, pin, CONTROLLED_EXECUTION_FENCE_POLICY.maximumBytes);
      await unlink(path);
    } catch {throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_RELEASE_UNCONFIRMED");}
  }

  private async path() {
    try {
      if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new Error();
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.directory) !== this.directory) throw new Error();
      return join(this.directory, `${this.hostId}.pending.json`);
    } catch {throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_DIRECTORY_INVALID");}
  }
}

export function requiresControlledExecutorIntervention(code: string) {
  return code === "CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED"
    || code.startsWith("CONTROLLED_RENDER_EXECUTION_FENCE_");
}
