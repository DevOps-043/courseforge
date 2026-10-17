import assert from "node:assert/strict";
import test from "node:test";
import { beginHistoricalHtmlJournal, readHistoricalHtmlJournal, recordHistoricalHtmlJournalReceipt, closeVerifiedHistoricalHtmlJournal } from "../composition-html-editing-historical-publication-journal.client";
import { computeHistoricalHtmlPublicationDigest } from "../composition-html-editing-historical-publication.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = {actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid};
const command = {...scope, operationId: uuid, request: {candidateId: uuid, candidateSha256: "a".repeat(64)}};
function fixture() {
  const values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, raw: string) => {values.set(key, raw);}, removeItem: () => {throw new Error("must never delete");}};
  return {values, storage};
}
async function receipt() {
  return {...command, scope: "HISTORICAL_PUBLICATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", requestSha256: await computeHistoricalHtmlPublicationDigest(command),
    originalRevisionId: uuid, originalProjectHash: "b".repeat(64), projectHash: "c".repeat(64), revisionId: other,
    revisionNumber: 2, activeRevisionIdAtCommit: uuid, currentDraftHashAtCommit: "d".repeat(64), activated: false, draftChanged: false};
}
test("historical journal durably binds owner/command/digest before POST and refuses overwrite", async () => {
  const fixtureState = fixture(); assert.deepEqual(await readHistoricalHtmlJournal(fixtureState.storage, scope), {status: "EMPTY"});
  const entry = await beginHistoricalHtmlJournal(fixtureState.storage, command, 42); assert.ok(entry);
  assert.equal(entry.requestSha256, await computeHistoricalHtmlPublicationDigest(command));
  assert.deepEqual(await readHistoricalHtmlJournal(fixtureState.storage, scope), {status: "PENDING", entry});
  assert.equal(await beginHistoricalHtmlJournal(fixtureState.storage, {...command, operationId: other}), null);
  assert.equal(fixtureState.values.size, 1); assert.doesNotMatch([...fixtureState.values.values()][0]!, /sourceHtml|approval|archiveBytes/);
});
test("journal is unavailable when storage is denied, missing, corrupt, oversized or owner/digest is swapped", async () => {
  assert.deepEqual(await readHistoricalHtmlJournal(null, scope), {status: "UNAVAILABLE"});
  for (const mode of ["corrupt", "large", "digest", "owner"] as const) {
    const fixtureState = fixture(), entry = await beginHistoricalHtmlJournal(fixtureState.storage, command); assert.ok(entry);
    const key = [...fixtureState.values.keys()][0]!;
    fixtureState.values.set(key, mode === "corrupt" ? "{" : mode === "large" ? "x".repeat(9000)
      : JSON.stringify({...entry, ...(mode === "digest" ? {requestSha256: "e".repeat(64)} : {command: {...command, actorId: other}})}));
    assert.deepEqual(await readHistoricalHtmlJournal(fixtureState.storage, scope), {status: "UNAVAILABLE"});
    assert.equal(await beginHistoricalHtmlJournal(fixtureState.storage, command), null);
  }
});
test("failed local persistence/readback never returns permission to send", async () => {
  const fixtureState = fixture();
  assert.equal(await beginHistoricalHtmlJournal({...fixtureState.storage, setItem: () => {throw new Error("quota");}}, command), null);
  assert.equal(await beginHistoricalHtmlJournal({...fixtureState.storage, setItem: () => {}}, command), null);
});
test("journal records only exact inactive receipt and preserves uncertain intent on mismatch", async () => {
  const fixtureState = fixture(), entry = await beginHistoricalHtmlJournal(fixtureState.storage, command); assert.ok(entry);
  const valid = await receipt();
  for (const patch of [{actorId: other}, {activated: true}, {draftChanged: true}, {requestSha256: "e".repeat(64)}, {request: {...command.request, candidateId: other}}])
    assert.equal(await recordHistoricalHtmlJournalReceipt(fixtureState.storage, scope, entry, {...valid, ...patch}), false);
  assert.deepEqual(await readHistoricalHtmlJournal(fixtureState.storage, scope), {status: "PENDING", entry});
  assert.equal(await recordHistoricalHtmlJournalReceipt(fixtureState.storage, scope, entry, valid), true);
  const current = await readHistoricalHtmlJournal(fixtureState.storage, scope);
  assert.equal(current.status, "PENDING"); if (current.status === "PENDING") assert.deepEqual(current.entry.receipt, valid);
  assert.equal(await recordHistoricalHtmlJournalReceipt(fixtureState.storage, scope, entry, valid), false);
});
test("mutated tracking during async validation fails closed instead of overwriting newer storage", async () => {
  const fixtureState = fixture(), entry = await beginHistoricalHtmlJournal(fixtureState.storage, command); assert.ok(entry);
  let reads = 0;
  const storage = {...fixtureState.storage, getItem: (key: string) => {
    reads++; if (reads > 1) return "changed"; return fixtureState.storage.getItem(key);
  }};
  assert.deepEqual(await readHistoricalHtmlJournal(storage, scope), {status: "UNAVAILABLE"});
  assert.equal(fixtureState.values.size, 1);
});

test("local closure cannot delete an uncertain, substituted or concurrently changed journal", async () => {
  const fixtureState = fixture(), entry = await beginHistoricalHtmlJournal(fixtureState.storage, command); assert.ok(entry);
  let deletions = 0;
  const storage = {...fixtureState.storage, removeItem: (key: string) => {deletions++; fixtureState.values.delete(key);}};
  assert.equal(await closeVerifiedHistoricalHtmlJournal(storage, scope, entry, () => true), false);
  const valid = await receipt(); assert.equal(await recordHistoricalHtmlJournalReceipt(storage, scope, entry, valid), true);
  const state = await readHistoricalHtmlJournal(storage, scope); assert.equal(state.status, "PENDING");
  if (state.status !== "PENDING") throw new Error();
  assert.equal(await closeVerifiedHistoricalHtmlJournal(storage, scope, {...state.entry, createdAt: 0}, () => true), false);
  assert.equal(await closeVerifiedHistoricalHtmlJournal(storage, scope, state.entry, () => false), false);
  assert.equal(deletions, 0);
  assert.equal(await closeVerifiedHistoricalHtmlJournal(storage, scope, state.entry, () => true), true);
  assert.equal(deletions, 1); assert.deepEqual(await readHistoricalHtmlJournal(storage, scope), {status: "EMPTY"});
});
