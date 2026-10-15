import assert from "node:assert/strict";
import test from "node:test";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { publishCompositionHtmlEditingSnapshot, HtmlEditingSnapshotPublicationError, type HtmlEditingSnapshotPublicationPorts } from "../composition-html-editing-snapshot-publication.server";
import { createHtmlSnapshotReconciler } from "../composition-html-editing-snapshot-reconciliation.server";

async function fixture() {
  const prepared = await createPreparedHtmlArchiveFixture();
  const calls: string[] = [];
  const state = {intentFailure: false, intentPatch: {} as Record<string,unknown>, uploadFailure: false, commitFailure: false, mutateUpload: false,
    uploadPatch: {} as Record<string,unknown>, commitPatch: {} as Record<string,unknown>, disposition: "CREATED",
    onUpload: undefined as (() => void) | undefined, onCommit: undefined as (() => void) | undefined};
  const ports: HtmlEditingSnapshotPublicationPorts = {
    recordPublicationIntent: async input => {
      calls.push("intent"); input.signal.throwIfAborted();
      if (state.intentFailure) throw new Error("private intent error");
      return {status:"RECORDED",identity:input.identity,expectedActiveRevisionId:input.expectedActiveRevisionId,
        archiveSizeBytes:input.archiveSizeBytes,...state.intentPatch};
    },
    storeImmutableArchive: async input => {
      calls.push("upload"); input.signal.throwIfAborted(); state.onUpload?.();
      if (state.uploadFailure) throw new Error("private storage error");
      if (state.mutateUpload) input.bytes[0] = input.bytes[0]! ^ 1;
      return {projectHash: input.projectHash, sizeBytes: input.bytes.length, storageBucket: "production-assets",
        storagePath: `composition-snapshots/${input.organizationId}/${input.compositionId}/${input.projectHash}.zip`, ...state.uploadPatch};
    },
    commitSnapshotAtomically: async input => {
      calls.push("commit"); input.signal.throwIfAborted(); state.onCommit?.();
      assert.equal(input.actorId, uuid); assert.equal(input.expectedActiveRevisionId, null);
      assert.equal(input.prepared.bundle.sha256, input.prepared.metadata.htmlEditingSnapshot!.sha256);
      assert.equal("archiveBytes" in input.prepared, false);
      if (state.commitFailure) throw new Error("private repository error");
      return {operationId: input.operationId, organizationId: input.organizationId, compositionId: input.compositionId,
        draftId: input.draftId, documentHash: input.documentHash, projectHash: input.archive.projectHash,
        revisionId: other, revisionNumber: 1, activeRevisionId: other, disposition: state.disposition, ...state.commitPatch};
    },
  };
  return {input: {...prepared.input, compositionId: uuid, expectedActiveRevisionId: null, operationId: uuid, ports},
    calls, state, preparationState: prepared.state};
}

test("publication prepares exact archive then verifies upload and atomic host acknowledgment", async () => {
  const f = await fixture(); const result = await publishCompositionHtmlEditingSnapshot(f.input);
  assert.deepEqual(f.calls, ["intent", "upload", "commit"]); assert.equal(f.preparationState.rpcReads, 2);
  assert.equal(result.scope, "REGISTERED_BY_HOST_PORT_NOT_RENDERED"); assert.equal(result.disposition, "CREATED");
});

test("reuse is accepted only with an exact authorized host acknowledgment", async () => {
  const f = await fixture(); f.state.disposition = "REUSED";
  assert.equal((await publishCompositionHtmlEditingSnapshot(f.input)).disposition, "REUSED");
  assert.deepEqual(f.calls, ["intent", "upload", "commit"]);
});

test("invalid storage scope, hash, size or bucket prevents commit", async () => {
  for (const patch of [{storagePath: "elsewhere.zip"}, {projectHash: "f".repeat(64)}, {sizeBytes: 1}, {storageBucket: "foreign"}]) {
    const f = await fixture(); f.state.uploadPatch = patch;
    await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input), /UPLOAD_ACK_INVALID/);
    assert.deepEqual(f.calls, ["intent", "upload"]);
  }
});

test("mutation by upload port is detected before commit", async () => {
  const f = await fixture(); f.state.mutateUpload = true;
  await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input), /UPLOAD_ACK_INVALID/);
  assert.deepEqual(f.calls, ["intent", "upload"]);
});

test("lost upload or commit acknowledgment is uncertain, safe and never retried", async () => {
  for (const stage of ["uploadFailure", "commitFailure"] as const) {
    const f = await fixture(); f.state[stage] = true;
    await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input), stage === "uploadFailure" ? /UPLOAD_OUTCOME_UNKNOWN/ : /COMMIT_OUTCOME_UNKNOWN/);
    assert.deepEqual(f.calls, stage === "uploadFailure" ? ["intent", "upload"] : ["intent", "upload", "commit"]);
  }
});

test("mismatched operation, tenant, native or archive identity and active revision reject commit ACK", async () => {
  for (const patch of [{operationId: other}, {organizationId: other}, {compositionId: other}, {draftId: other},
    {documentHash: "f".repeat(64)}, {projectHash: "f".repeat(64)}, {activeRevisionId: uuid}, {extra: "private"}]) {
    const f = await fixture(); f.state.commitPatch = patch;
    await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input), /COMMIT_ACK_INVALID/);
    assert.deepEqual(f.calls, ["intent", "upload", "commit"]);
  }
});

test("pre-aborted publication performs no reads or writes", async () => {
  const f = await fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(publishCompositionHtmlEditingSnapshot({...f.input, signal: controller.signal}), /abort/i);
  assert.equal(f.preparationState.rpcReads, 0); assert.deepEqual(f.calls, []);
});

test("abort after a dispatched write reports uncertain outcome rather than successful activation", async () => {
  for (const stage of ["onUpload", "onCommit"] as const) {
    const f = await fixture(); const controller = new AbortController(); f.state[stage] = () => controller.abort();
    await assert.rejects(publishCompositionHtmlEditingSnapshot({...f.input, signal: controller.signal}),
      stage === "onUpload" ? /UPLOAD_OUTCOME_UNKNOWN/ : /COMMIT_OUTCOME_UNKNOWN/);
    assert.deepEqual(f.calls, stage === "onUpload" ? ["intent", "upload"] : ["intent", "upload", "commit"]);
  }
});

test("lost commit retains immutable identity for explicit read-only reconciliation without rebuilding ZIP", async () => {
  const f = await fixture(); f.state.commitFailure = true;
  let failure:HtmlEditingSnapshotPublicationError | undefined;
  try {await publishCompositionHtmlEditingSnapshot(f.input);} catch (error) {
    assert.ok(error instanceof HtmlEditingSnapshotPublicationError); failure = error;
  }
  assert.ok(failure?.operationIdentity); const identity = failure.operationIdentity;
  assert.ok(Object.isFrozen(identity)); assert.equal(identity.operationId,uuid);
  assert.doesNotMatch(JSON.stringify(identity), /sourceHtml|grantedAssetIds|secret|bytes/);
  let reads = 0;
  const reconcile = createHtmlSnapshotReconciler({rpc:(name:string) => ({abortSignal:async () => {
    reads++; assert.equal(name,"read_html_editing_snapshot_operation");
    return {error:null,data:{status:"COMMITTED",currentActiveRevisionId:other,acknowledgment:{...identity,
      revisionId:other,revisionNumber:1,activeRevisionId:other,disposition:"CREATED"}}};
  }})} as never);
  assert.equal((await reconcile({...identity,actorId:uuid})).status,"COMMITTED_ACTIVE");
  assert.equal(reads,1); assert.equal(f.preparationState.rpcReads,2); assert.deepEqual(f.calls,["intent", "upload","commit"]);
});

test("lost durable intent ACK prevents upload and commit and retains recovery identity", async () => {
  const f = await fixture(); f.state.intentFailure = true;
  await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input), error => {
    assert.ok(error instanceof HtmlEditingSnapshotPublicationError); assert.equal(error.code,"INTENT_OUTCOME_UNKNOWN");
    assert.equal(error.operationIdentity?.operationId,uuid); return true;
  });
  assert.deepEqual(f.calls,["intent"]);
});

test("incorrect durable intent hash, size, CAS or status prevents upload", async () => {
  for (const intentPatch of [{status:"COMMITTED"},{archiveSizeBytes:1},{expectedActiveRevisionId:other},
    {identity:{operationId:uuid,organizationId:uuid,compositionId:uuid,draftId:uuid,documentHash:"a".repeat(64),projectHash:"b".repeat(64)}}]) {
    const f = await fixture(); f.state.intentPatch = intentPatch;
    await assert.rejects(publishCompositionHtmlEditingSnapshot(f.input),/INTENT_ACK_INVALID/);
    assert.deepEqual(f.calls,["intent"]);
  }
});
