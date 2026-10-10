import { createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createHtmlPrivateHandoffFiles } from "./composition-html-private-handoff-files.server";
import { HTML_RECONSTRUCTION_POLICY as policy, htmlReconstructionStagingSchema, type HtmlReconstructionStaging } from "./composition-html-editing-reconstruction.contract";

const domain = "COURSEFORGE_PRIVATE_RECONSTRUCTION_OPERATION_V1\n";
const envelope = z.object({version: z.literal(1), phase: z.enum(["BEFORE_STAGING", "BEFORE_CREATION"]),
  staging: htmlReconstructionStagingSchema, seal: z.string().regex(/^[a-f0-9]{64}$/)}).strict();

/** Pre-existing private root/OS ACL and external key owned by the host. Local
 * journal means ATTEMPT identity, not approval, remote success or retry authority.
 * Create-only files; no overwrite/resume/adoption/cleanup of partial operations.
 * A distinct root from candidate handoff is required by host configuration. */
export function createHtmlReconstructionOperationJournal(configuration: {rootDirectory: string; integrityKey: Uint8Array}) {
  if (!isAbsolute(configuration.rootDirectory) || !(configuration.integrityKey instanceof Uint8Array) || configuration.integrityKey.length !== 32)
    throw new Error("HTML_RECONSTRUCTION_JOURNAL_CONFIGURATION_INVALID");
  const files = createHtmlPrivateHandoffFiles(configuration.rootDirectory), key = Buffer.from(configuration.integrityKey);
  const seal = (phase: z.infer<typeof envelope>["phase"], staging: HtmlReconstructionStaging) => createHmac("sha256", key)
    .update(domain).update(JSON.stringify({phase, staging: htmlReconstructionStagingSchema.parse(staging)})).digest("hex");
  async function read(operationId: string, phase: z.infer<typeof envelope>["phase"], signal?: AbortSignal) {
    const filename = phase === "BEFORE_STAGING" ? "operation.json" : "creation-intent.json";
    const record = envelope.parse(JSON.parse((await files.read(operationId, filename, policy.receiptBytes, signal)).toString("utf8")));
    if (record.phase !== phase || record.staging.operationId !== operationId
      || !timingSafeEqual(Buffer.from(record.seal, "hex"), Buffer.from(seal(record.phase, record.staging), "hex"))) throw new Error();
    return record.staging;
  }
  async function write(staging: HtmlReconstructionStaging, phase: z.infer<typeof envelope>["phase"], signal?: AbortSignal) {
    const encoded = Buffer.from(JSON.stringify({version: 1, phase, staging, seal: seal(phase, staging)}));
    if (encoded.byteLength > policy.receiptBytes) throw new Error();
    await files.write(staging.operationId, phase === "BEFORE_STAGING" ? "operation.json" : "creation-intent.json", encoded, signal);
    const checked = await read(staging.operationId, phase, signal);
    if (!isDeepStrictEqual(checked, staging)) throw new Error();
    return checked;
  }
  return {
    async preserveStaging(input: HtmlReconstructionStaging, signal?: AbortSignal) {
      const staging = htmlReconstructionStagingSchema.parse(input);
      try {await files.create(staging.operationId, signal); return await write(staging, "BEFORE_STAGING", signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_WRITE_UNCONFIRMED");}
    },
    async preserveCreationIntent(input: HtmlReconstructionStaging, signal?: AbortSignal) {
      const staging = htmlReconstructionStagingSchema.parse(input);
      try {
        if (!isDeepStrictEqual(await read(staging.operationId, "BEFORE_STAGING", signal), staging)) throw new Error();
        return await write(staging, "BEFORE_CREATION", signal);
      } catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_WRITE_UNCONFIRMED");}
    },
    async readStaging(operationId: string, signal?: AbortSignal) {
      try {return await read(z.string().uuid().parse(operationId), "BEFORE_STAGING", signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_UNAVAILABLE");}
    },
    async readCreationIntent(operationId: string, signal?: AbortSignal) {
      try {return await read(z.string().uuid().parse(operationId), "BEFORE_CREATION", signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_JOURNAL_UNAVAILABLE");}
    },
  };
}
