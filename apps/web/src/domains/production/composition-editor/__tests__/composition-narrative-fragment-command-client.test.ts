import assert from "node:assert/strict";
import test from "node:test";
import { requestNarrativeFragmentCommand } from "../composition-narrative-fragment-command.client";
import { projectNarrativeFragmentCommandResult } from "../composition-narrative-fragment-command-response.server";
import { narrativeFragmentCommandResultSchema, type NarrativeFragmentApplyRequest } from "../composition-narrative-fragment-command-contract";
import { API_ERROR_CODE, createApiErrorBody } from "../../../../lib/server/api-contract";

const draftId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const command: NarrativeFragmentApplyRequest = { contract: "NARRATIVE_FRAGMENT_APPLY_V1", commandId, reviewFingerprint: "a".repeat(64),
  query: { contract: "NARRATIVE_FRAGMENT_QUERY_V1", selectedTrackIds: ["voice", "visual"],
    selection: { documentHash: "b".repeat(64), occurrenceId: "occurrence", firstSourceIndex: 1, lastSourceIndex: 2 } } };
const receipt = { contract: "NARRATIVE_FRAGMENT_RECEIPT_V1", commandId, requestFingerprint: "c".repeat(64), documentHash: "d".repeat(64),
  version: 2, anchorClipId: `voice-extract-${commandId}`, newClipIds: [`voice-extract-${commandId}`, `fragment-${commandId}-0`] };
const parameters = (mode: "APPLY" | "RECOVERY" = "APPLY") => ({ mode, draftId, command: structuredClone(command), signal: new AbortController().signal });
const success = (status: "COMMITTED" | "REPLAYED" | "CONFIRMED") => Response.json({ success: true, requestId: "request", correlationId: "request",
  data: projectNarrativeFragmentCommandResult(receipt, status) });
test("public projection contains only commit identity and requires reloading current document", () => {
  const result = projectNarrativeFragmentCommandResult(receipt, "COMMITTED");
  assert.equal(result.status, "COMMITTED"); assert.ok("reloadDocumentRequired" in result && result.reloadDocumentRequired);
  assert.ok(!JSON.stringify(result).includes("requestFingerprint")); assert.ok(!JSON.stringify(result).includes("operations"));
  assert.throws(() => projectNarrativeFragmentCommandResult({ ...receipt, newClipIds: [receipt.anchorClipId, `fragment-${commandId}-48`] }, "COMMITTED"));
});
test("apply/recovery send the same strict intention only to audiovisual routes without retry", async () => {
  for (const mode of ["APPLY", "RECOVERY"] as const) {
    let count = 0;
    const result = await requestNarrativeFragmentCommand({ ...parameters(mode), fetcher: async (url, init) => {
      count++; assert.equal(url, `/api/production/hyperframes/drafts/${draftId}/narrative-fragment/${mode === "APPLY" ? "apply" : "receipt"}`);
      assert.deepEqual(JSON.parse(String(init?.body)), command); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
      return success(mode === "APPLY" ? "COMMITTED" : "CONFIRMED");
    } });
    assert.equal(result.kind, "CONFIRMED"); assert.equal(count, 1);
  }
});
test("foreign command, partial/duplicate clips, wrong mode and leaked internal fields cannot confirm", async () => {
  const valid = projectNarrativeFragmentCommandResult(receipt, "COMMITTED");
  for (const change of [{ commandId: draftId }, { newClipIds: [receipt.anchorClipId] }, { newClipIds: [receipt.anchorClipId, receipt.anchorClipId] },
    { status: "CONFIRMED" }, { requestFingerprint: receipt.requestFingerprint }, { operations: [] }]) {
    const result = await requestNarrativeFragmentCommand({ ...parameters(), fetcher: async () => Response.json({ success: true, data: { ...valid, ...change } }) });
    assert.equal(result.kind, "UNCONFIRMED");
  }
  assert.equal((await requestNarrativeFragmentCommand({ ...parameters("RECOVERY"), fetcher: async () => success("COMMITTED") })).kind, "UNCONFIRMED");
});
test("lost ACK, malformed body, oversize, UTF-8 failure and abort after dispatch remain uncertain", async () => {
  for (const fetcher of [async () => { throw Error("secret internal detail"); }, async () => new Response("invalid"),
    async () => new Response(" ".repeat(16 * 1024 + 1)), async () => new Response(new Uint8Array([0xff]))]) {
    const result = await requestNarrativeFragmentCommand({ ...parameters(), fetcher }); assert.equal(result.kind, "UNCONFIRMED");
  }
  const controller = new AbortController();
  const result = await requestNarrativeFragmentCommand({ ...parameters(), signal: controller.signal, fetcher: async () => {
    controller.abort(); return success("COMMITTED");
  } }); assert.equal(result.kind, "UNCONFIRMED");
});
test("only explicit fresh-apply negative ACK rejects; recovery errors never clear uncertainty", async () => {
  for (const mode of ["APPLY", "RECOVERY"] as const) {
    const result = await requestNarrativeFragmentCommand({ ...parameters(mode), fetcher: async () => Response.json(createApiErrorBody({
      code: API_ERROR_CODE.conflict, message: "secret rejected reason", requestId: "request", retryable: false,
      details: { reason: "REVIEW_STALE", requestNotApplied: true, recoveryRequired: false, automaticRetryAllowed: false, commandId },
    }), { status: 409 }) });
    assert.equal(result.kind, mode === "APPLY" ? "REJECTED" : "UNCONFIRMED");
    assert.ok(!result.message.includes("secret"));
  }
});
test("pre-dispatch abort and invalid intention never send; unconfirmed result carries no receipt", async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher: typeof fetch = async () => { throw Error("must not send"); };
  await assert.rejects(requestNarrativeFragmentCommand({ ...parameters(), signal: controller.signal, fetcher }));
  await assert.rejects(requestNarrativeFragmentCommand({ ...parameters(), draftId: "invalid", fetcher }));
  assert.equal(narrativeFragmentCommandResultSchema.safeParse({ contract: "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1", status: "UNCONFIRMED",
    commandId, automaticRetryAllowed: false, recoveryRequired: true }).success, true);
  assert.equal(narrativeFragmentCommandResultSchema.safeParse({ contract: "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1", status: "UNCONFIRMED",
    commandId, automaticRetryAllowed: false, recoveryRequired: true, documentHash: receipt.documentHash }).success, false);
});
