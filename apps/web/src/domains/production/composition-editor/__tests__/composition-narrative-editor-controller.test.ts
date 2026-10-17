import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeEditorController, type NarrativeEditorReload } from "../composition-narrative-editor-controller";
import { reserveNarrativeCommandPending, readNarrativeCommandPending, type NarrativeExtractionPendingStorage } from "../composition-narrative-extraction-pending";
import type { NarrativeFragmentSummary } from "../composition-narrative-fragment-contract";
import type { NarrativeExtractionSummary } from "../composition-narrative-extraction-contract";
import { acceptsNarrativeExtractionReload } from "../composition-narrative-reload-policy";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  draftId: "33333333-3333-4333-8333-333333333333" };
const query = { contract: "NARRATIVE_FRAGMENT_QUERY_V1" as const, selectedTrackIds: ["voice", "text"],
  selection: { documentHash: "a".repeat(64), occurrenceId: "voice", firstSourceIndex: 0, lastSourceIndex: 2 } };
const fragmentSummary: NarrativeFragmentSummary = { contract: "NARRATIVE_FRAGMENT_ELIGIBILITY_V1", documentHash: query.selection.documentHash,
  reviewFingerprint: "b".repeat(64), scope: "AUDIOVISUAL", binding: "REGISTRY_METADATA_MATCH_ONLY", requiresRevalidationBeforeApply: true,
  sourceStartSeconds: 1, sourceEndSeconds: 3, destinationStartSeconds: 10, destinationEndSeconds: 12,
  clipCount: 2, trackCount: 2, captionCuts: 0, wordCuts: 0 };
const voiceSummary: NarrativeExtractionSummary = { contract: "NARRATIVE_VOICE_EXTRACTION_ELIGIBILITY_V2",
  documentHash: query.selection.documentHash, reviewFingerprint: fragmentSummary.reviewFingerprint, scope: "VOICE_ONLY",
  binding: "REGISTRY_METADATA_MATCH_ONLY", requiresRevalidationBeforeApply: true, sourceStartSeconds: 1, sourceEndSeconds: 3,
  destinationStartSeconds: 10, destinationEndSeconds: 12 };
function fixture() {
  const entries = new Map<string, string>(); const urls: string[] = []; const reloads: NarrativeEditorReload[] = [];
  const storage: NarrativeExtractionPendingStorage = { getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } };
  const fetcher: typeof fetch = async (url, options) => {
    urls.push(String(url)); const command = JSON.parse(String(options?.body));
    const audiovisual = String(url).includes("narrative-fragment");
    const anchor = `voice-extract-${command.commandId}`;
    return Response.json({ success: true, data: {
      contract: audiovisual ? "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1" : "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1",
      commandId: command.commandId, status: String(url).endsWith("receipt") ? "CONFIRMED" : "COMMITTED",
      documentHash: "c".repeat(64), version: 2, scope: "DATABASE_COMMIT_ONLY",
      automaticRetryAllowed: false, recoveryRequired: false, reloadDocumentRequired: true,
      ...(audiovisual ? { anchorClipId: anchor, newClipIds: [anchor, `fragment-${command.commandId}-0`] } : { newClipId: anchor }),
    } });
  };
  const dependencies = { storage, scope, fetcher, onState: () => undefined,
    exclusiveLock: async <T>(_key: string, task: () => Promise<T>) => task(),
    reloadDocument: async (receipt: NarrativeEditorReload) => { reloads.push(receipt); return true; } };
  return { dependencies, storage, urls, reloads };
}
const signal = () => new AbortController().signal;
test("one editor owner switches reviewed policies but never replaces an active command", async () => {
  const current = fixture(); const controller = new NarrativeEditorController(current.dependencies); controller.initialize();
  assert.equal(controller.review(query.selection, voiceSummary), true);
  assert.equal(controller.reviewFragment(query, fragmentSummary), true);
  assert.equal(await controller.applyFragment(query, signal()), true);
  assert.equal(controller.review(query.selection, voiceSummary), false);
  assert.equal(await controller.apply(query.selection, signal()), false);
  assert.equal(current.urls.length, 1); assert.ok(current.urls[0]!.endsWith("/narrative-fragment/apply"));
  assert.equal(await controller.reload(), true); assert.equal(current.reloads[0]!.kind, "AUDIOVISUAL");
  assert.equal(current.reloads[0]!.newClipIds.length, 2);
  assert.equal(controller.review(query.selection, voiceSummary), true);
  assert.equal(await controller.apply(query.selection, signal()), true);
  assert.equal(await controller.reload(), true); assert.equal(current.reloads[1]!.kind, "VOICE");
  assert.equal(current.reloads[1]!.newClipIds.length, 1);
});
test("remount routes each existing pointer to receipt only, independent of new-apply flags", async () => {
  for (const kind of ["VOICE", "AUDIOVISUAL"] as const) {
    const current = fixture(); const commandId = "44444444-4444-4444-8444-444444444444";
    reserveNarrativeCommandPending(current.storage, scope, kind === "VOICE"
      ? { contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1", commandId, selection: query.selection, reviewFingerprint: voiceSummary.reviewFingerprint }
      : { contract: "NARRATIVE_FRAGMENT_APPLY_V1", commandId, query, reviewFingerprint: fragmentSummary.reviewFingerprint });
    const controller = new NarrativeEditorController(current.dependencies); controller.initialize();
    assert.equal(controller.state.phase, "UNCONFIRMED"); assert.equal(controller.unavailable, false);
    assert.equal(controller.reviewFragment(query, fragmentSummary), false);
    assert.equal(controller.review(query.selection, voiceSummary), false);
    assert.equal(current.urls.length, 0); assert.equal(await controller.recover(signal()), true);
    assert.ok(current.urls[0]!.endsWith(kind === "VOICE" ? "/narrative-extraction/receipt" : "/narrative-fragment/receipt"));
    assert.equal(await controller.reload(), true); assert.equal(current.reloads[0]!.kind, kind);
    assert.equal(readNarrativeCommandPending(current.storage, scope).status, "EMPTY");
  }
});
test("lock waiting is busy immediately and rejects policy switching or duplicate confirmation", async () => {
  const current = fixture(); let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  current.dependencies.exclusiveLock = async (_key, task) => { await waiting; return task(); };
  const controller = new NarrativeEditorController(current.dependencies); controller.initialize();
  controller.reviewFragment(query, fragmentSummary);
  const applying = controller.applyFragment(query, signal()); assert.equal(controller.isBusy, true);
  assert.equal(controller.review(query.selection, voiceSummary), false);
  assert.equal(await controller.applyFragment(query, signal()), false);
  release(); assert.equal(await applying, true); assert.equal(current.urls.length, 1);
});
test("matching commit hash requires every extracted clip; later authorized revision is never replaced", () => {
  const document = createNarrativeDocumentFixture();
  const receipt: NarrativeEditorReload = { newClipIds: ["voice-1", "visual-copy"], anchorClipId: "voice-1", documentHash: "c".repeat(64), kind: "AUDIOVISUAL" };
  assert.equal(acceptsNarrativeExtractionReload(document, receipt.documentHash, receipt), false);
  document.clips.push({ ...document.clips[0]!, id: "visual-copy", hfId: "hf-visual-copy" });
  assert.equal(acceptsNarrativeExtractionReload(document, receipt.documentHash, receipt), true);
  document.clips = [];
  assert.equal(acceptsNarrativeExtractionReload(document, "d".repeat(64), receipt), true);
  assert.equal(acceptsNarrativeExtractionReload(document, "", receipt), false);
});
