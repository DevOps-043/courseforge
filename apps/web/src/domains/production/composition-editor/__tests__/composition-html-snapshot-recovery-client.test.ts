import assert from "node:assert/strict";
import test from "node:test";
import { readHtmlSnapshotLocator,rememberHtmlSnapshotLocator,clearConfirmedHtmlSnapshotLocator } from "../composition-html-snapshot-locator.client";
import { consultHtmlSnapshotRecovery } from "../composition-html-snapshot-recovery.client";
import { htmlEditingFixtureId as uuid,htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
const scope = {actorId:uuid,organizationId:uuid,draftId:uuid};
function memory() {
  const values = new Map<string,string>(); const storage = {getItem:(key:string) => values.get(key) ?? null,
    setItem:(key:string,value:string) => {values.set(key,value);},removeItem:(key:string) => {values.delete(key);}};
  return {storage,values};
}
const summary = {operationId:uuid,status:"NO_INTENT",automaticRetryAllowed:false,
  scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION"};
const envelope = (data:unknown=summary) => ({success:true,data,requestId:uuid,correlationId:uuid});
const response = (data:unknown=envelope()) => new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});

test("locator persists only owner-scoped operation ID and survives storage instance reload", () => {
  const f = memory();assert.equal(rememberHtmlSnapshotLocator(f.storage,scope,uuid,10),"SAVED");
  assert.equal(readHtmlSnapshotLocator({...f.storage},scope)?.operationId,uuid);
  assert.doesNotMatch([...f.values.values()].join(""),/sourceHtml|token|projectHash|documentHash|grant/);
});
test("account, organization and draft boundaries never share locators", () => {
  const f = memory();rememberHtmlSnapshotLocator(f.storage,scope,uuid,10);
  for (const alternate of [{...scope,actorId:other},{...scope,organizationId:other},{...scope,draftId:other}]) {
    assert.equal(readHtmlSnapshotLocator(f.storage,alternate),null);
  }
});
test("another pending operation cannot be silently overwritten", () => {
  const f = memory();rememberHtmlSnapshotLocator(f.storage,scope,uuid,10);
  assert.equal(rememberHtmlSnapshotLocator(f.storage,scope,uuid,11),"EXISTING");
  assert.equal(rememberHtmlSnapshotLocator(f.storage,scope,other,12),"DIFFERENT_PENDING");
  assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.createdAt,10);
});
test("uncertain results never clear tracking; terminal explicit close checks expected ID", () => {
  const f = memory();rememberHtmlSnapshotLocator(f.storage,scope,uuid,10);
  for (const status of ["NO_INTENT","INTENT_ONLY","READ_UNAVAILABLE"]) assert.equal(clearConfirmedHtmlSnapshotLocator(f.storage,scope,uuid,status),false);
  assert.equal(clearConfirmedHtmlSnapshotLocator(f.storage,scope,other,"COMMITTED_ACTIVE"),false);
  assert.equal(clearConfirmedHtmlSnapshotLocator(f.storage,scope,uuid,"COMMITTED_SUPERSEDED"),true);
  assert.equal(readHtmlSnapshotLocator(f.storage,scope),null);
});
test("malformed, oversized or foreign payload under a key does not become a locator", () => {
  const f = memory();rememberHtmlSnapshotLocator(f.storage,scope,uuid,10);const key = [...f.values.keys()][0]!;
  for (const value of ["{", "x".repeat(1025),JSON.stringify({schemaVersion:1,scope:{...scope,actorId:other},operationId:uuid,createdAt:10})]) {
    f.values.set(key,value);assert.equal(readHtmlSnapshotLocator(f.storage,scope),null);
    assert.equal(rememberHtmlSnapshotLocator(f.storage,scope,other,11),"STORAGE_UNAVAILABLE");
    assert.equal(f.values.get(key),value);
  }
});
test("unavailable/quota-failing storage never claims durable tracking", () => {
  assert.equal(rememberHtmlSnapshotLocator(null,scope,uuid),"STORAGE_UNAVAILABLE");
  const storage = {getItem:() => null,setItem:() => {throw new Error();},removeItem:() => {throw new Error();}};
  assert.equal(rememberHtmlSnapshotLocator(storage,scope,uuid),"STORAGE_UNAVAILABLE");
});
test("client recovery is a single same-origin GET with no publication body or retry", async () => {
  const calls:Array<{url:string;init:RequestInit}> = [];
  const result = await consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,fetchImpl:async (url,init) => {
    calls.push({url:String(url),init:init!});return response();}});
  assert.equal(result.status,"NO_INTENT");assert.equal(calls.length,1);
  assert.equal(calls[0]!.url,`/api/production/hyperframes/drafts/${uuid}/html-snapshots/${uuid}`);
  assert.equal(calls[0]!.init.method,"GET");assert.equal(calls[0]!.init.credentials,"same-origin");
  assert.equal(calls[0]!.init.cache,"no-store");assert.equal(calls[0]!.init.redirect,"error");
  assert.equal(calls[0]!.init.body,undefined);
});
test("client rejects foreign operation, automatic retry proposal and impossible active state", async () => {
  for (const data of [{...summary,operationId:other},{...summary,automaticRetryAllowed:true},
    {...summary,status:"COMMITTED_ACTIVE",revisionId:uuid,revisionNumber:1,currentActiveRevisionId:other},
    {...summary,status:"COMMITTED_SUPERSEDED",revisionId:uuid,revisionNumber:1,currentActiveRevisionId:uuid}]) {
    await assert.rejects(consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,fetchImpl:async () => response(envelope(data))}));
  }
});
test("client rejects oversized body and cancels read without retry", async () => {
  let calls = 0,cancelled = false;
  await assert.rejects(consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,fetchImpl:async () => {
    calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}}),
      {headers:{"content-type":"application/json"}});}}));
  assert.equal(calls,1);assert.equal(cancelled,true);
});
test("error status, non-JSON, malformed and uncorrelated responses preserve uncertainty", async () => {
  for (const makeResponse of [() => new Response("private error",{status:503}),() => new Response("<html>"),
    () => response({success:true}),() => response({...envelope(),correlationId:other})]) {
    let calls = 0;await assert.rejects(consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,fetchImpl:async () => {calls++;return makeResponse();}}),
      /No se pudo confirmar/);assert.equal(calls,1);
  }
});
test("invalid ID or pre-abort performs no network request", async () => {
  let calls = 0;const fetchImpl:typeof fetch = async () => {calls++;return response();};
  await assert.rejects(consultHtmlSnapshotRecovery({draftId:"../elsewhere",operationId:uuid,fetchImpl}));
  const controller = new AbortController();controller.abort();
  await assert.rejects(consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,signal:controller.signal,fetchImpl}));
  assert.equal(calls,0);
});
test("superseded registration is accepted as historical, never reactivated", async () => {
  const result = await consultHtmlSnapshotRecovery({draftId:uuid,operationId:uuid,fetchImpl:async () => response(envelope({
    ...summary,status:"COMMITTED_SUPERSEDED",revisionId:uuid,revisionNumber:2,currentActiveRevisionId:null}))});
  assert.equal(result.status,"COMMITTED_SUPERSEDED");assert.equal(result.automaticRetryAllowed,false);
});
