import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlSnapshotReconciler } from "../composition-html-editing-snapshot-reconciliation.server";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

const request = {actorId:uuid, operationId:uuid, organizationId:uuid, compositionId:uuid, draftId:uuid,
  documentHash:"a".repeat(64), projectHash:"b".repeat(64)};
const acknowledgment = {operationId:uuid, organizationId:uuid, compositionId:uuid, draftId:uuid,
  documentHash:request.documentHash, projectHash:request.projectHash, revisionId:uuid, revisionNumber:1,
  activeRevisionId:uuid, disposition:"CREATED"};
function fixture() {
  const state = {data:{status:"COMMITTED", acknowledgment, currentActiveRevisionId:uuid} as unknown,
    error:false, fail:false, afterRead:undefined as (() => void) | undefined};
  const calls:Array<{name:string; args:Record<string,unknown>}> = [];
  const reconcile = createHtmlSnapshotReconciler({rpc:(name:string,args:Record<string,unknown>) => ({
    abortSignal:async (signal:AbortSignal) => {
      signal.throwIfAborted(); calls.push({name,args}); state.afterRead?.();
      if (state.fail) throw new Error("private details");
      return {data:state.data, error:state.error ? {message:"private SQL details"} : null};
    }})} as never);
  return {state,calls,reconcile};
}

test("read-only reconciliation distinguishes committed active and superseded without changing historical ACK", async () => {
  for (const active of [uuid,other,null]) {
    const f = fixture(); f.state.data = {status:"COMMITTED", acknowledgment, currentActiveRevisionId:active};
    const result = await f.reconcile(request);
    assert.equal(result.status,active === uuid ? "COMMITTED_ACTIVE" : "COMMITTED_SUPERSEDED");
    assert.equal(result.automaticRetryAllowed,false);
    assert.equal(result.scope,"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION");
    assert.ok("acknowledgment" in result); assert.equal(result.acknowledgment.activeRevisionId,uuid);
    assert.equal(f.calls.length,1); assert.equal(f.calls[0]!.name,"read_html_editing_snapshot_operation");
  }
});

test("absent operation is only an observation, not a retry authorization", async () => {
  const f = fixture(); f.state.data = {status:"NOT_FOUND"};
  const result = await f.reconcile(request);
  assert.equal(result.status,"NOT_FOUND"); assert.equal(result.automaticRetryAllowed,false);
  assert.equal("acknowledgment" in result,false); assert.equal(f.calls.length,1);
});

test("RPC receives exact operation, actor, tenant, draft and expected native/archive identities", async () => {
  const f = fixture(); await f.reconcile(request);
  assert.deepEqual(f.calls[0]!.args,{p_org:uuid,p_actor:uuid,p_composition:uuid,p_draft:uuid,p_operation:uuid,
    p_document_hash:request.documentHash,p_project_hash:request.projectHash});
});

test("ACK drift on any scope/hash, extra fields or impossible activation rejects reconciliation", async () => {
  for (const patch of [{operationId:other},{organizationId:other},{compositionId:other},{draftId:other},
    {documentHash:"f".repeat(64)},{projectHash:"f".repeat(64)},{activeRevisionId:other},{extra:"private"}]) {
    const f = fixture(); f.state.data = {status:"COMMITTED", acknowledgment:{...acknowledgment,...patch}, currentActiveRevisionId:uuid};
    await assert.rejects(f.reconcile(request),/INVALID_RESPONSE/); assert.equal(f.calls.length,1);
  }
});

test("malformed, oversized, extra and ambiguous responses fail closed", async () => {
  for (const data of [null,"x".repeat(5000),{status:"NOT_FOUND",acknowledgment},
    {status:"COMMITTED",acknowledgment},{status:"COMMITTED",acknowledgment,currentActiveRevisionId:"invalid"},
    {status:"RETRY"},{status:"COMMITTED",acknowledgment,currentActiveRevisionId:uuid,extra:true}]) {
    const f = fixture(); f.state.data = data;
    await assert.rejects(f.reconcile(request),/INVALID_RESPONSE/); assert.equal(f.calls.length,1);
  }
});

test("database error or lost response remains unavailable, never NOT_FOUND or retry", async () => {
  for (const failure of ["error","fail"] as const) {
    const f = fixture(); f.state[failure] = true;
    await assert.rejects(f.reconcile(request),/READ_UNAVAILABLE/); assert.equal(f.calls.length,1);
  }
});

test("invalid or pre-aborted request never calls repository", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reconcile({...request,signal:controller.signal}));
  await assert.rejects(f.reconcile({...request,actorId:"invalid"}));
  assert.equal(f.calls.length,0);
});

test("cancellation after response dispatch cannot be presented as committed", async () => {
  const f = fixture(); const controller = new AbortController(); f.state.afterRead = () => controller.abort();
  await assert.rejects(f.reconcile({...request,signal:controller.signal}),/READ_UNAVAILABLE/);
  assert.equal(f.calls.length,1);
});
