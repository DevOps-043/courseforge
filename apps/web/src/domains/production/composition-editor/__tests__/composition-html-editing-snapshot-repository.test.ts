import assert from "node:assert/strict";
import test from "node:test";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { prepareCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";
import { createHtmlEditingSnapshotRepository } from "../composition-html-editing-snapshot-repository.server";
import { publishCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-publication.server";

async function fixture() {
  const f = await createPreparedHtmlArchiveFixture();
  const prepared = await prepareCompositionHtmlEditingSnapshotArchive(f.input);
  const {archiveBytes, ...receipt} = prepared;
  const archive = {projectHash:prepared.projectHash, sizeBytes:archiveBytes.length, storageBucket:"production-assets" as const,
    storagePath:`composition-snapshots/${uuid}/${uuid}/${prepared.projectHash}.zip`};
  const commits: Array<Record<string,unknown>> = [];
  const state = {error:false, fail:false, oversized:false};
  const base = f.input.supabase as unknown as {rpc(): {abortSignal(signal:AbortSignal):Promise<unknown>}};
  const supabase = {rpc:(name:string, args:Record<string,unknown>) => {
    if (name !== "commit_html_editing_snapshot") return base.rpc();
    return {abortSignal:async (signal:AbortSignal) => {
      signal.throwIfAborted(); commits.push(args);
      if (state.fail) throw new Error("private database details");
      return {data:state.oversized ? "x".repeat(5000) : {operationId:uuid, organizationId:uuid, compositionId:uuid,
        draftId:uuid, documentHash:prepared.documentHash, projectHash:(args.p_payload as {archive:{projectHash:string}}).archive.projectHash, revisionId:other,
        revisionNumber:1, activeRevisionId:other, disposition:"CREATED"}, error:state.error ? {message:"private error"} : null};
    }};
  }};
  const repository = createHtmlEditingSnapshotRepository(supabase as never);
  const input = {actorId:uuid, organizationId:uuid, compositionId:uuid, draftId:uuid, operationId:uuid,
    expectedActiveRevisionId:null, documentHash:prepared.documentHash, archive, prepared:receipt,
    signal:new AbortController().signal};
  return {f, repository, input, commits, state};
}

test("repository refreshes historical authority and sends exact bounded publication payload to one commit RPC", async () => {
  const f = await fixture(); await f.repository(f.input);
  assert.equal(f.commits.length,1); assert.equal(f.f.state.rpcReads,3);
  const args = f.commits[0]!;
  assert.equal(args.p_org,uuid); assert.equal(args.p_actor,uuid); assert.equal(args.p_expected_active,null);
  const payload = args.p_payload as {manifest:Record<string,unknown>; htmlUsedAssetIds:string[]};
  assert.deepEqual(payload.htmlUsedAssetIds,[uuid]);
  assert.equal(payload.manifest.draft_document_id,uuid);
  assert.equal(payload.manifest.conformance_contract_version,4);
  assert.doesNotMatch(JSON.stringify(payload), /"(?:grantedAssetIds|encodedBundle|sourceHtml|signedUrl)":/);
});

test("authority revoked after upload prevents commit RPC", async () => {
  const f = await fixture(); f.f.state.revokeOnRefresh = true;
  await assert.rejects(f.repository(f.input)); assert.equal(f.commits.length,0);
});

test("archive scope/hash and receipt native identity mismatch reject before new authority read", async () => {
  const f = await fixture();
  for (const patch of [{archive:{...f.input.archive, storagePath:"elsewhere"}},
    {archive:{...f.input.archive, projectHash:"f".repeat(64)}}, {documentHash:"f".repeat(64)}]) {
    await assert.rejects(f.repository({...f.input, ...patch}), /RECEIPT_INVALID/);
  }
  assert.equal(f.f.state.rpcReads,2); assert.equal(f.commits.length,0);
});

test("altered bundle, metadata, native pin, assets and contract fail before commit", async () => {
  const f = await fixture();
  const alterations = [
    {...f.input.prepared, bundle:{...f.input.prepared.bundle, encodedBundle:"{}"}},
    {...f.input.prepared, metadata:{...f.input.prepared.metadata, nativeDocumentSha256:"f".repeat(64)}},
    {...f.input.prepared, metadata:{...f.input.prepared.metadata, contractSha256:"f".repeat(64)}},
    {...f.input.prepared, assets:f.input.prepared.assets.map(asset => ({...asset, checksum:"f".repeat(64)}))},
    {...f.input.prepared, contract:{...f.input.prepared.contract, documentHash:"f".repeat(64)}},
  ];
  for (const prepared of alterations) await assert.rejects(f.repository({...f.input, prepared}));
  assert.equal(f.commits.length,0);
});

test("RPC errors/lost acknowledgment/oversized response are safe single-attempt failures", async () => {
  for (const mode of ["error","fail","oversized"] as const) {
    const f = await fixture(); f.state[mode] = true;
    await assert.rejects(f.repository(f.input), /HTML_SNAPSHOT_COMMIT_UNCONFIRMED/); assert.equal(f.commits.length,1);
  }
});

test("pre-aborted repository does no read or commit", async () => {
  const f = await fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repository({...f.input, signal:controller.signal}));
  assert.equal(f.f.state.rpcReads,2); assert.equal(f.commits.length,0);
});

test("publication coordinator accepts concrete repository with mocked database transport", async () => {
  const f = await fixture();
  const result = await publishCompositionHtmlEditingSnapshot({...f.f.input, compositionId:uuid, expectedActiveRevisionId:null,
    operationId:uuid, ports:{recordPublicationIntent:async input => ({status:"RECORDED",identity:input.identity,
      expectedActiveRevisionId:input.expectedActiveRevisionId,archiveSizeBytes:input.archiveSizeBytes}),
      storeImmutableArchive:async input => ({projectHash:input.projectHash, sizeBytes:input.bytes.length,
      storageBucket:"production-assets", storagePath:`composition-snapshots/${uuid}/${uuid}/${input.projectHash}.zip`}),
      commitSnapshotAtomically:f.repository}});
  assert.equal(result.revisionId,other); assert.equal(f.commits.length,1);
});
