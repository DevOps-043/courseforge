import { createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createHtmlPrivateHandoffFiles } from "./composition-html-private-handoff-files.server";
import { HTML_RECONSTRUCTION_POLICY, htmlReconstructionReviewRecordSchema, type HtmlReconstructionReviewRecord } from "./composition-html-editing-reconstruction.contract";

const envelope = z.object({version: z.literal(1), record: htmlReconstructionReviewRecordSchema,
  seal: z.string().regex(/^[a-f0-9]{64}$/)}).strict();

/** Private review-intent root, separate from candidate and operation roots.
 * Preserve BEFORE the attestation RPC. A valid local intent is not remote success
 * or retry authority; uncertain writes are reconciled through the review reader. */
export function createHtmlReconstructionReviewJournal(configuration: {rootDirectory: string; integrityKey: Uint8Array}) {
  if (!isAbsolute(configuration.rootDirectory) || !(configuration.integrityKey instanceof Uint8Array) || configuration.integrityKey.length !== 32)
    throw new Error("HTML_RECONSTRUCTION_REVIEW_JOURNAL_CONFIGURATION_INVALID");
  const files = createHtmlPrivateHandoffFiles(configuration.rootDirectory), key = Buffer.from(configuration.integrityKey);
  const seal = (record: HtmlReconstructionReviewRecord) => createHmac("sha256", key)
    .update("COURSEFORGE_PRIVATE_RECONSTRUCTION_REVIEW_INTENT_V1\n")
    .update(JSON.stringify(htmlReconstructionReviewRecordSchema.parse(record))).digest("hex");
  async function read(candidateId: string, signal?: AbortSignal) {
    const parsed = envelope.parse(JSON.parse((await files.read(candidateId, "review-intent.json",
      HTML_RECONSTRUCTION_POLICY.receiptBytes, signal)).toString("utf8")));
    if (parsed.record.locator.candidateId !== candidateId || !timingSafeEqual(Buffer.from(parsed.seal, "hex"), Buffer.from(seal(parsed.record), "hex"))) throw new Error();
    return parsed.record;
  }
  return {
    async preserve(input: HtmlReconstructionReviewRecord, signal?: AbortSignal) {
      const record = htmlReconstructionReviewRecordSchema.parse(input);
      try {
        const bytes = Buffer.from(JSON.stringify({version: 1, record, seal: seal(record)}));
        if (bytes.length > HTML_RECONSTRUCTION_POLICY.receiptBytes) throw new Error();
        await files.create(record.locator.candidateId, signal);
        await files.write(record.locator.candidateId, "review-intent.json", bytes, signal);
        const checked = await read(record.locator.candidateId, signal);
        if (!isDeepStrictEqual(checked, record)) throw new Error();
        return checked;
      } catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_REVIEW_JOURNAL_UNCONFIRMED");}
    },
    async read(candidateId: string, signal?: AbortSignal) {
      try {return await read(z.string().uuid().parse(candidateId), signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_REVIEW_JOURNAL_UNAVAILABLE");}
    },
  };
}
