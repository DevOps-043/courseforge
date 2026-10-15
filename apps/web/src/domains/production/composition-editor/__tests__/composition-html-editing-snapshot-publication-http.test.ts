import assert from "node:assert/strict";
import test from "node:test";
import {createHtmlSnapshotPublicationHandler} from "../http/composition-html-snapshot-publication-handler.server";
import {readHtmlSnapshotExecutionConfiguration} from "../composition-html-snapshot-publication-configuration.server";
import {htmlSnapshotPublicationEnabled} from "../composition-html-snapshot-publication-http.contract";
import {htmlEditingFixtureId as uuid,htmlEditingFixtureOtherId as other} from "./composition-html-editing-test-fixtures";
import type {createHtmlSnapshotRecoveryService} from "../composition-html-editing-snapshot-recovery.server";
import {sendTrackedHtmlSnapshotPublication} from "../composition-html-snapshot-publication-http.client";
import {readHtmlSnapshotLocator} from "../composition-html-snapshot-locator.client";

const hash="a".repeat(64),projectHash="b".repeat(64);
const identity={operationId:uuid,organizationId:uuid,compositionId:other,draftId:uuid,documentHash:hash,projectHash};
const body={operationId:uuid,documentHash:hash,expectedActiveRevisionId:null,renderProfileId:"balanced"};
const ack={...identity,revisionId:uuid,revisionNumber:1,activeRevisionId:uuid,disposition:"CREATED"};
const intent={status:"RECORDED",identity,expectedActiveRevisionId:null,archiveSizeBytes:10};
function fixture() {
  const calls:string[]=[];const filters:Array<[string,string,unknown]>=[];const rateKeys:string[]=[];
  const state={enabled:true,actorId:uuid as string | null,
    tenant:{organizationId:uuid,userId:uuid,platformRole:"ADMIN"} as {organizationId:string;userId:string;platformRole:string | null} | null,
    rateAllowed:true,rateMalformed:false,rateError:false,draft:{composition_id:other,state:"ACTIVE"} as unknown,
    composition:{active_revision_id:null,status:"DRAFT"} as unknown,latest:{document_hash:hash} as unknown,
    existing:{status:"NOT_FOUND"} as unknown,publication:{...ack,scope:"REGISTERED_BY_HOST_PORT_NOT_RENDERED"} as unknown,
    publishError:false,recoveryError:false,logged:0,
    recovered:{status:"LOCATED",intent,registration:{status:"COMMITTED_ACTIVE",acknowledgment:ack,currentActiveRevisionId:uuid},automaticRetryAllowed:false} as
      Awaited<ReturnType<ReturnType<typeof createHtmlSnapshotRecoveryService>>>};
  const handler=createHtmlSnapshotPublicationHandler({enabled:() => state.enabled,
    authenticate:async () => {calls.push("auth");return {actorId:state.actorId,tenant:state.tenant};},
    serviceClient:() => {
      calls.push("client");return {rpc:(name:string,args:Record<string,unknown>) => ({abortSignal:async () => {
        calls.push(name);if (name === "read_html_editing_snapshot_intent") return {data:state.existing,error:null};
        assert.equal(name,"consume_api_rate_limit");rateKeys.push(args.p_rate_key as string);
        return {data:state.rateMalformed ? [{allowed:"yes"}] : [{allowed:state.rateAllowed,reset_at:"2026-10-06T23:00:00Z"}],error:state.rateError ? {} : null};
      }}),from:(table:string) => {
        calls.push(table);const query={select:() => query,eq:(key:string,value:unknown) => {filters.push([table,key,value]);return query;},
          order:() => query,limit:() => query,abortSignal:() => query,maybeSingle:async () => ({error:null,
            data:table === "video_composition_drafts" ? state.draft : table === "video_compositions" ? state.composition : state.latest})};return query;
      }} as never;
    },
    publish:async (_client,input) => {
      calls.push("publish");assert.equal(input.actorId,uuid);assert.equal(input.organizationId,uuid);assert.equal(input.compositionId,other);
      assert.equal(input.draftId,uuid);assert.equal(input.documentHash,hash);assert.ok(input.signal instanceof AbortSignal);
      if (state.publishError) throw new Error("private credentials");return state.publication;
    },
    recover:() => async () => {calls.push("recover");if (state.recoveryError) throw new Error("private");return state.recovered;},
    logFailure:() => {state.logged++;},
  });
  const request=(payload:unknown=body,headers:Record<string,string>={},method="POST",signal?:AbortSignal) => new Request(
    `https://app.example/api/drafts/${uuid}/html-snapshots`,{method,headers:{origin:"https://app.example","content-type":"application/json",...headers},
      ...(method === "POST" ? {body:JSON.stringify(payload)} : {}),signal});
  return {state,calls,filters,rateKeys,handler,request,params:{draftId:uuid}};
}

test("publication flag defaults off and disabled handler does no authentication or database work", async () => {
  for (const value of [undefined,false,true,"TRUE","false","1",""]) assert.equal(htmlSnapshotPublicationEnabled(value),false);
  assert.equal(htmlSnapshotPublicationEnabled("true"),true);
  const f=fixture();f.state.enabled=false;assert.equal((await f.handler(f.request(),f.params)).status,503);assert.deepEqual(f.calls,[]);
});
test("method, exact origin, MIME and URL IDs are checked before authentication", async () => {
  const cases:Array<{headers?:Record<string,string>;method?:string;params?:unknown;status:number}>=[
    {method:"GET",status:405},{headers:{origin:"https://evil.example"},status:403},
    {headers:{origin:"null"},status:403},{headers:{"sec-fetch-site":"cross-site"},status:403},
    {headers:{"content-type":"text/plain"},status:415},{params:{draftId:"../foreign"},status:400},
  ];
  for (const input of cases) {
    const f=fixture();const result=await f.handler(f.request(body,input.headers,input.method),input.params ?? f.params);
    assert.equal(result.status,input.status);assert.deepEqual(f.calls,[]);
  }
});
test("session, tenant actor and explicit reviewer role precede service credentials", async () => {
  for (const patch of [{actorId:null},{tenant:null},{tenant:{organizationId:uuid,userId:other,platformRole:"ADMIN"}},
    {tenant:{organizationId:uuid,userId:uuid,platformRole:"BUILDER"}},{tenant:{organizationId:uuid,userId:uuid,platformRole:null}}]) {
    const f=fixture();Object.assign(f.state,patch);const result=await f.handler(f.request(),f.params);
    assert.ok([401,403].includes(result.status));assert.deepEqual(f.calls,["auth"]);
  }
});
test("shared quotas fail closed before resource lookup/publication and keys ignore operation ID", async () => {
  for (const patch of [{rateAllowed:false},{rateMalformed:true},{rateError:true}]) {
    const f=fixture();Object.assign(f.state,patch);const result=await f.handler(f.request(),f.params);
    assert.equal(result.status,patch.rateAllowed === false ? 429 : 503);assert.equal(f.calls.includes("publish"),false);
  }
  const f=fixture();await f.handler(f.request({...body,operationId:other}),f.params);
  assert.deepEqual(f.rateKeys,[`html-snapshot-publication:org:${uuid}`,`html-snapshot-publication:actor:${uuid}:${uuid}`]);
});
test("oversized and extra authority fields are rejected before draft lookup", async () => {
  for (const payload of [{...body,organizationId:other},{...body,otherAssets:[]},{...body,renderExecution:{}},{...body,huge:"x".repeat(4096)}]) {
    const f=fixture();assert.ok([400,413].includes((await f.handler(f.request(payload),f.params)).status));
    assert.equal(f.calls.includes("video_composition_drafts"),false);assert.equal(f.calls.includes("publish"),false);
  }
});
test("stream body budget cancels immediately without trusting content-length", async () => {
  const f=fixture();let cancelled=false;
  const request=new Request("https://app.example/api/drafts/html-snapshots",{method:"POST",headers:{origin:"https://app.example","content-type":"application/json"},
    body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}}),duplex:"half"} as RequestInit);
  assert.equal((await f.handler(request,f.params)).status,413);assert.equal(cancelled,true);assert.equal(f.calls.includes("publish"),false);
});
test("inactive/foreign state, stale document and active CAS conflict never publish", async () => {
  for (const patch of [{draft:null},{draft:{composition_id:other,state:"ARCHIVED"}},{composition:null},
    {composition:{active_revision_id:other,status:"DRAFT"}},{latest:{document_hash:projectHash}}]) {
    const f=fixture();Object.assign(f.state,patch);assert.ok([404,409].includes((await f.handler(f.request(),f.params)).status));
    assert.equal(f.calls.includes("publish"),false);
  }
  const f=fixture();await f.handler(f.request(),f.params);
  assert.ok(f.filters.filter(([,key]) => key === "organization_id").every(([, ,value]) => value === uuid));
});
test("recorded operation cannot rebuild/reupload/reactivate through another POST", async () => {
  const f=fixture();f.state.existing=intent;
  assert.equal((await f.handler(f.request(),f.params)).status,409);assert.equal(f.calls.includes("publish"),false);assert.equal(f.calls.includes("recover"),false);
});
test("post-commit response observes current registration and exposes only correlated public summary", async () => {
  const f=fixture();const response=await f.handler(f.request(),f.params);assert.equal(response.status,201);
  const envelope=await response.json();assert.equal(envelope.data.status,"COMMITTED_ACTIVE");
  assert.equal(envelope.requestId,envelope.correlationId);assert.equal(envelope.data.automaticRetryAllowed,false);
  assert.doesNotMatch(JSON.stringify(envelope),/projectHash|documentHash|storage|credentials|archiveSizeBytes/);
  assert.match(response.headers.get("cache-control")!,/no-store/);assert.equal(f.calls.filter(call => call === "publish").length,1);
  assert.ok(f.calls.indexOf("publish")<f.calls.indexOf("recover"));
  if (f.state.recovered.status !== "LOCATED" || f.state.recovered.registration.status === "NOT_FOUND") throw new Error();
  f.state.recovered.registration={...f.state.recovered.registration,status:"COMMITTED_SUPERSEDED",currentActiveRevisionId:other};
  assert.equal((await (await f.handler(f.request(),f.params)).json()).data.status,"COMMITTED_SUPERSEDED");
});
test("invalid/lost ACK or failed post-commit observation stays uncertain without retry or raw errors", async () => {
  for (const patch of [{publishError:true},{publication:{...ack,scope:"REGISTERED_BY_HOST_PORT_NOT_RENDERED",organizationId:other}},
    {recoveryError:true}]) {
    const f=fixture();Object.assign(f.state,patch);const response=await f.handler(f.request(),f.params);
    assert.equal(response.status,503);const envelope=await response.json();assert.equal(envelope.retryable,false);
    assert.doesNotMatch(JSON.stringify(envelope),/private credentials/);assert.equal(f.calls.filter(call => call === "publish").length,1);
  }
});
test("pre-abort never authenticates or writes and operator configuration has no permissive fallback", async () => {
  const f=fixture();const controller=new AbortController();controller.abort();
  assert.equal((await f.handler(f.request(body,{},"POST",controller.signal),f.params)).status,503);assert.deepEqual(f.calls,[]);
  for (const invalid of [undefined,"{}","{","x".repeat(16385),JSON.stringify({source:"request"})])
    assert.throws(() => readHtmlSnapshotExecutionConfiguration(invalid),/CONFIGURATION_UNAVAILABLE/);
});
test("configured expected execution pins parse without being presented as execution evidence", () => {
  const execution={policy:"CONTROLLED_FILES_AND_BROWSER_SESSION_V1",backend:"CONTROLLED",sdkVersion:"0.7.106",
    expectedBrowser:{protocolVersion:"1.3",product:"Chrome/test",revision:"test",userAgent:"test",jsVersion:"test"},
    files:Object.fromEntries(["node","producer","engine","runtime","browser","encoder","decoder"].map(role => [role,{sha256:hash,sizeBytes:10}]))};
  assert.deepEqual(readHtmlSnapshotExecutionConfiguration(JSON.stringify(execution)),execution);
});
function tracking() {
  const values=new Map<string,string>();
  return {scope:{actorId:uuid,organizationId:uuid,draftId:uuid},createOperationId:() => uuid,
    storage:{getItem:(key:string) => values.get(key) ?? null,setItem:(key:string,value:string) => {values.set(key,value);},removeItem:(key:string) => {values.delete(key);}},
    lock:{runExclusive:async <T>(_scope:unknown,task:()=>Promise<T>) => task()},
    documentHash:hash,expectedActiveRevisionId:null,renderProfileId:"balanced" as const};
}
test("tracked HTTP client persists locator before controller admission and sends only strict publication fields", async () => {
  const f=fixture();const client=tracking();let calls=0;
  const fetchImpl:typeof fetch=async (url,options) => {
    calls++;assert.equal(readHtmlSnapshotLocator(client.storage,client.scope)?.operationId,uuid);
    assert.equal(String(url),`/api/production/hyperframes/drafts/${uuid}/html-snapshots`);
    assert.equal(options!.redirect,"error");assert.equal(options!.credentials,"same-origin");assert.equal(options!.cache,"no-store");
    assert.deepEqual(JSON.parse(options!.body as string),body);
    // In-process transport simulation, not a browser/real HTTP session.
    return f.handler(new Request(new URL(String(url),"https://app.example"),{...options,
      headers:{...options!.headers,origin:"https://app.example"}}),f.params);
  };
  const result=await sendTrackedHtmlSnapshotPublication({...client,fetchImpl});assert.equal(result.status,"COMMITTED_ACTIVE");
  assert.equal(calls,1);assert.equal(f.calls.filter(call => call === "publish").length,1);
  await assert.rejects(sendTrackedHtmlSnapshotPublication({...client,fetchImpl}));assert.equal(calls,1);
});
test("client preserves operation ID after server failure and never retries or exposes response internals", async () => {
  const client=tracking();let calls=0;
  await assert.rejects(sendTrackedHtmlSnapshotPublication({...client,fetchImpl:async () => {
    calls++;return new Response("private database secret",{status:503});
  }}),/No se pudo confirmar/);
  assert.equal(calls,1);assert.equal(readHtmlSnapshotLocator(client.storage,client.scope)?.operationId,uuid);
  await assert.rejects(sendTrackedHtmlSnapshotPublication({...client,fetchImpl:async () => {calls++;throw new Error();}}));assert.equal(calls,1);
});
