import assert from "node:assert/strict";
import test from "node:test";
import { dispatchTrackedHtmlSnapshotPublication, HtmlSnapshotClientPublicationError } from "../composition-html-snapshot-publication.client";
import { readHtmlSnapshotLocator, rememberHtmlSnapshotLocator } from "../composition-html-snapshot-locator.client";
import { resolveHtmlSnapshotPublicationLock, type HtmlSnapshotPublicationLock } from "../composition-html-snapshot-publication-lock.client";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

const scope = {actorId:uuid,organizationId:uuid,draftId:uuid};
function fixture() {
  const values = new Map<string,string>();
  const storage = {getItem:(key:string) => values.get(key) ?? null, setItem:(key:string,value:string) => {values.set(key,value);},
    removeItem:(key:string) => {values.delete(key);}};
  let busy = false;
  const lock:HtmlSnapshotPublicationLock = {runExclusive:async (_scope, task) => {
    if (busy) throw new Error("busy");
    busy = true;try {return await task();} finally {busy = false;}
  }};
  return {values,storage,lock,scope,createOperationId:() => uuid};
}
const summary = {operationId:uuid,status:"COMMITTED_ACTIVE",revisionId:uuid,revisionNumber:1,currentActiveRevisionId:uuid,
  automaticRetryAllowed:false,scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION"};
const failure = (code:string) => (error:unknown) => error instanceof HtmlSnapshotClientPublicationError
  && error.code === code && error.automaticRetryAllowed === false;

test("publication saves owner-scoped locator before its single dispatch and keeps it after confirmation", async () => {
  const f = fixture();let calls = 0;
  const result = await dispatchTrackedHtmlSnapshotPublication({...f,dispatch:async input => {
    calls++;assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.operationId,input.operationId);
    assert.deepEqual(Object.keys(input).sort(),["draftId","operationId","signal"]);
    return summary;
  }});
  assert.equal(result.status,"COMMITTED_ACTIVE");assert.equal(calls,1);
  assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.operationId,uuid);
});
test("existing same or different operation never causes a second publication", async () => {
  for (const operationId of [uuid,other]) {
    const f = fixture();rememberHtmlSnapshotLocator(f.storage,scope,operationId);let calls = 0;
    await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...f,dispatch:async () => {calls++;return summary;}}),failure("PENDING_OPERATION"));
    assert.equal(calls,0);assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.operationId,operationId);
  }
});
test("missing lock, pre-abort, storage denial and corrupt slot reject before dispatch", async () => {
  const aborted = new AbortController();aborted.abort();
  const corrupt = fixture();corrupt.values.set(`courseforge:html-snapshot:v1:${uuid}:${uuid}:${uuid}`,"{");
  const denial = fixture();denial.storage.setItem = () => {throw new Error("quota");};
  for (const options of [{...fixture(),lock:null},{...fixture(),storage:null},{...fixture(),signal:aborted.signal},corrupt,denial]) {
    let calls = 0;await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...options,dispatch:async () => {calls++;return summary;}}));
    assert.equal(calls,0);
  }
  assert.equal([...corrupt.values.values()][0],"{");
});
test("concurrent cooperative tabs cannot both dispatch under the scope lock", async () => {
  const f = fixture();let release!:(value:unknown) => void;let calls = 0;
  const first = dispatchTrackedHtmlSnapshotPublication({...f,dispatch:() => {calls++;return new Promise(resolve => {release=resolve;});}});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...f,dispatch:async () => {calls++;return summary;}}),failure("NOT_DISPATCHED"));
  release(summary);await first;assert.equal(calls,1);
});
test("lost or malformed acknowledgement preserves tracking and never retries", async () => {
  for (const outcome of [() => {throw new Error("private token");},() => ({...summary,operationId:other}),
    () => {throw new HtmlSnapshotClientPublicationError("NOT_DISPATCHED");},
    () => ({...summary,automaticRetryAllowed:true}),() => ({...summary,status:"INTENT_ONLY"}),
    () => ({...summary,currentActiveRevisionId:other})]) {
    const f = fixture();let calls = 0;
    await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...f,dispatch:async () => {calls++;return outcome();}}),failure("OUTCOME_UNKNOWN"));
    assert.equal(calls,1);assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.operationId,uuid);
  }
});
test("browser adapter requests immediate exclusive owner lock and rejects contention without task execution", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,"navigator");
  let available = true;let tasks = 0;const calls:Array<{name:string;options:unknown}> = [];
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks:{request:async (name:string,options:unknown,
    callback:(lock:unknown) => Promise<unknown>) => {calls.push({name,options});return callback(available ? {} : null);}}}});
  try {
    const lock = resolveHtmlSnapshotPublicationLock();assert.ok(lock);
    assert.equal(await lock.runExclusive(scope,async () => {tasks++;return "ok";}),"ok");
    available=false;await assert.rejects(lock.runExclusive(scope,async () => {tasks++;return "unsafe";}),/PUBLICATION_BUSY/);
    assert.equal(tasks,1);assert.deepEqual(calls[0],{name:`courseforge:html-snapshot-publication:v1:${uuid}:${uuid}:${uuid}`,
      options:{mode:"exclusive",ifAvailable:true}});
    await lock.runExclusive({...scope,organizationId:other},async () => "unused").catch(() => undefined);
    assert.notEqual(calls[0]!.name,calls[2]!.name);
    Object.defineProperty(globalThis,"navigator",{configurable:true,value:{}});
    assert.equal(resolveHtmlSnapshotPublicationLock(),null);
  } finally {
    if (original) Object.defineProperty(globalThis,"navigator",original);
    else Reflect.deleteProperty(globalThis,"navigator");
  }
});
test("abort stops client waiting without claiming rollback of a non-cooperative dispatched operation", async () => {
  const f = fixture();const controller = new AbortController();let lateReject!:(error:Error) => void;let calls = 0;
  const pending = dispatchTrackedHtmlSnapshotPublication({...f,signal:controller.signal,dispatch:() => {
    calls++;return new Promise((_resolve,reject) => {lateReject=reject;});
  }});
  await new Promise(resolve => setImmediate(resolve));controller.abort();
  await assert.rejects(pending,failure("OUTCOME_UNKNOWN"));lateReject(new Error("late server failure"));
  assert.equal(calls,1);assert.equal(readHtmlSnapshotLocator(f.storage,scope)?.operationId,uuid);
  await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...f,dispatch:async () => {calls++;return summary;}}),failure("PENDING_OPERATION"));
  assert.equal(calls,1);
});
test("historical superseded confirmation is not interpreted as reactivation", async () => {
  const result = await dispatchTrackedHtmlSnapshotPublication({...fixture(),dispatch:async () => ({...summary,status:"COMMITTED_SUPERSEDED",currentActiveRevisionId:other})});
  assert.equal(result.status,"COMMITTED_SUPERSEDED");
});
test("invalid scope or generated ID does not dispatch or persist", async () => {
  for (const options of [{...fixture(),scope:{...scope,actorId:"invalid"}},{...fixture(),createOperationId:() => "invalid"}]) {
    let calls = 0;await assert.rejects(dispatchTrackedHtmlSnapshotPublication({...options,dispatch:async () => {calls++;return summary;}}));
    assert.equal(calls,0);assert.equal(options.values.size,0);
  }
});
