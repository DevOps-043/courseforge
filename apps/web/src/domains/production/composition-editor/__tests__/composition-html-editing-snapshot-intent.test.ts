import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createHtmlSnapshotIntentRepository } from "../composition-html-editing-snapshot-intent.server";
import { createHtmlEditingSnapshotHost } from "../composition-html-editing-snapshot-host.server";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { htmlEditingFixtureId as uuid,htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

const identity = {organizationId:uuid,compositionId:uuid,draftId:uuid,operationId:uuid,documentHash:"a".repeat(64),projectHash:"b".repeat(64)};
const intent = {status:"RECORDED" as const,identity,expectedActiveRevisionId:null,archiveSizeBytes:10};
const owner = {organizationId:uuid,compositionId:uuid,draftId:uuid,operationId:uuid,actorId:uuid};
function fixture() {
  const state = {response:intent as unknown,error:false}; const calls:string[] = [];
  const repository = createHtmlSnapshotIntentRepository({rpc:(name:string) => ({abortSignal:async (signal:AbortSignal) => {
    signal.throwIfAborted(); calls.push(name); return {data:state.response,error:state.error ? {message:"private"} : null};
  }})} as never);
  return {state,calls,repository};
}

test("record and locator read verify scope and mark identity as no commit or retry proof", async () => {
  const f = fixture(); await f.repository.recordPublicationIntent({...intent,actorId:uuid,signal:new AbortController().signal});
  const recovered = await f.repository.readPublicationIntent(owner);
  assert.equal(recovered.status,"RECORDED"); assert.equal(recovered.automaticRetryAllowed,false);
  assert.deepEqual(f.calls,["record_html_editing_snapshot_intent","read_html_editing_snapshot_intent"]);
});

test("unknown operation is not registration failure or automatic retry authorization", async () => {
  const f = fixture(); f.state.response = {status:"NOT_FOUND"};
  const result = await f.repository.readPublicationIntent(owner);
  assert.equal(result.status,"NOT_FOUND"); assert.equal(result.automaticRetryAllowed,false);
});

test("record rejects substituted identity, CAS or size", async () => {
  for (const response of [{...intent,identity:{...identity,projectHash:"f".repeat(64)}}, {...intent,expectedActiveRevisionId:other},
    {...intent,archiveSizeBytes:11}]) {
    const f = fixture(); f.state.response = response;
    await assert.rejects(f.repository.recordPublicationIntent({...intent,actorId:uuid,signal:new AbortController().signal}),/ACK_INVALID/);
  }
});

test("locator rejects foreign scopes, malformed/oversized responses and database failures", async () => {
  for (const response of [{...intent,identity:{...identity,operationId:other}}, {...intent,identity:{...identity,organizationId:other}},
    {...intent,identity:{...identity,compositionId:other}}, {...intent,identity:{...identity,draftId:other}}, null,"x".repeat(5000)]) {
    const f = fixture(); f.state.response = response; await assert.rejects(f.repository.readPublicationIntent(owner));
  }
  const f = fixture(); f.state.error = true; await assert.rejects(f.repository.readPublicationIntent(owner),/INTENT_UNCONFIRMED/);
});

test("pre-abort and invalid input perform no durable write or read", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repository.readPublicationIntent({...owner,signal:controller.signal}));
  await assert.rejects(f.repository.recordPublicationIntent({...intent,actorId:"invalid",signal:controller.signal}));
  assert.equal(f.calls.length,0);
});

test("concrete host records intent before Storage and recovers lost commit using only operation locator", async () => {
  const f = await createPreparedHtmlArchiveFixture(); const events:string[] = [];
  const base = f.input.supabase as unknown as {rpc():unknown;from(table:string):unknown};
  let recorded:typeof intent | undefined; let uploaded:Uint8Array | undefined;
  const supabase = {from:(table:string) => base.from(table),rpc:(name:string,args:Record<string,unknown>) => {
    if (name === "read_html_editing_compilation") return base.rpc();
    return {abortSignal:async () => {
      events.push(name);
      if (name === "record_html_editing_snapshot_intent") {recorded = args.p_intent as typeof intent; return {data:recorded,error:null};}
      if (name === "commit_html_editing_snapshot") throw new Error("lost ack after synthetic commit");
      if (name === "read_html_editing_snapshot_intent") return {data:recorded,error:null};
      assert.equal(name,"read_html_editing_snapshot_operation");
      return {error:null,data:{status:"COMMITTED",currentActiveRevisionId:other,acknowledgment:{...recorded!.identity,
        revisionId:other,revisionNumber:1,activeRevisionId:other,disposition:"CREATED"}}};
    }};
  }};
  const host = createHtmlEditingSnapshotHost({supabase:supabase as never,supabaseUrl:"https://project.supabase.co",serviceRoleKey:"test-only-key",
    fetchImpl:async (_url,init) => {
      events.push(init!.method!);
      if (init!.method === "POST") {assert.ok(recorded); uploaded = new Uint8Array(init!.body as Uint8Array); return new Response(null,{status:201});}
      return new Response(uploaded! as BodyInit,{headers:{"content-type":"application/zip"}});
    }});
  await assert.rejects(host.publish({...f.input,compositionId:uuid,operationId:uuid,expectedActiveRevisionId:null}),/COMMIT_OUTCOME_UNKNOWN/);
  assert.equal(recorded!.identity.projectHash,createHash("sha256").update(uploaded!).digest("hex"));
  const readsBefore = f.state.rpcReads; const result = await host.recover(owner);
  assert.ok(result.registration); assert.equal(result.registration.status,"COMMITTED_ACTIVE");
  assert.equal(result.automaticRetryAllowed,false); assert.equal(f.state.rpcReads,readsBefore);
  assert.deepEqual(events,["record_html_editing_snapshot_intent","POST","GET","commit_html_editing_snapshot",
    "read_html_editing_snapshot_intent","read_html_editing_snapshot_operation"]);
});
