import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlSnapshotRecoveryHandler } from "../http/composition-html-snapshot-recovery-handler.server";
import { htmlSnapshotRecoveryEnabled } from "../composition-html-editing-snapshot-recovery-policy";
import { htmlEditingFixtureId as uuid,htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import type { createHtmlSnapshotRecoveryService } from "../composition-html-editing-snapshot-recovery.server";

type RecoveryResult = Awaited<ReturnType<ReturnType<typeof createHtmlSnapshotRecoveryService>>>;
function fixture() {
  const calls:string[] = []; const filters:Array<[string,unknown]> = []; const rateKeys:string[] = [];
  const state = {enabled:true,actorId:uuid as string | null,tenant:{organizationId:uuid,userId:uuid,platformRole:"ADMIN"} as
    {organizationId:string;userId:string;platformRole:string | null} | null,rateAllowed:true,rateError:false,
    rateMalformed:false,draft:{composition_id:other,state:"ACTIVE"} as {composition_id:string;state:string} | null,
    draftError:false,recoveryError:false,recovered:{status:"NO_INTENT",automaticRetryAllowed:false,
      scope:"DURABLE_IDENTITY_NOT_UPLOAD_OR_COMMIT_CONFIRMATION"} as RecoveryResult,logged:0};
  const handler = createHtmlSnapshotRecoveryHandler({enabled:() => state.enabled,
    authenticate:async () => {calls.push("auth");return {actorId:state.actorId,tenant:state.tenant};},
    serviceClient:() => {
      calls.push("client");
      return {rpc:(name:string,args:Record<string,unknown>) => ({abortSignal:async () => {
        calls.push(name); rateKeys.push(args.p_rate_key as string);
        return {data:state.rateMalformed ? [{allowed:"yes"}] : [{allowed:state.rateAllowed,reset_at:"2026-10-05T23:00:00Z"}],error:state.rateError ? {} : null};
      }}),from:(table:string) => {
        calls.push(table); const query = {select:() => query,eq:(field:string,value:unknown) => {filters.push([field,value]);return query;},
          abortSignal:() => query,maybeSingle:async () => ({data:state.draft,error:state.draftError ? {} : null})};return query;
      }} as never;
    },
    recover:() => async input => {
      calls.push("recover"); assert.equal(input.actorId,uuid); assert.equal(input.organizationId,uuid);
      assert.equal(input.compositionId,other); assert.equal(input.draftId,uuid);assert.equal(input.operationId,uuid);
      if (state.recoveryError) throw new Error("private key and SQL details");return state.recovered;
    },logFailure:() => {state.logged++;}});
  const request = (headers?:HeadersInit,method="GET",query="") => new Request(`https://app.example/api/recovery${query}`,{method,headers});
  const params = {draftId:uuid,operationId:uuid};
  return {handler,state,calls,filters,rateKeys,request,params};
}

test("rollout is off unless literal true and disabled route does no authentication or DB work", async () => {
  for (const value of [undefined,"false","TRUE","1"," true "]) assert.equal(htmlSnapshotRecoveryEnabled(value),false);
  assert.equal(htmlSnapshotRecoveryEnabled("true"),true);
  const f = fixture();f.state.enabled = false;const response = await f.handler(f.request(),f.params);
  assert.equal(response.status,503);assert.deepEqual(f.calls,[]);assert.match(response.headers.get("cache-control")!,/no-store/);
});

test("authentication, active tenant/actor match and explicit reviewer role precede service client", async () => {
  for (const patch of [{actorId:null},{tenant:null},{tenant:{organizationId:uuid,userId:other,platformRole:"ADMIN"}},
    {tenant:{organizationId:uuid,userId:uuid,platformRole:"BUILDER"}}, {tenant:{organizationId:uuid,userId:uuid,platformRole:null}}]) {
    const f = fixture();Object.assign(f.state,patch);const response = await f.handler(f.request(),f.params);
    assert.ok([401,403].includes(response.status));assert.deepEqual(f.calls,["auth"]);
  }
});

test("wrong method, cross-site request, malformed IDs and query injection never authenticate", async () => {
  for (const input of [{method:"POST",status:405},{headers:{"sec-fetch-site":"cross-site"},status:403},
    {query:"?organizationId=foreign",status:400},{params:{draftId:"../foreign",operationId:uuid},status:400}]) {
    const f = fixture();const response = await f.handler(f.request(input.headers,input.method,input.query),input.params ?? f.params);
    assert.equal(response.status,input.status);assert.deepEqual(f.calls,[]);
  }
});

test("shared rate admission blocks excess/malformed/unavailable calls before draft and recovery", async () => {
  for (const patch of [{rateAllowed:false},{rateError:true},{rateMalformed:true}]) {
    const f = fixture();Object.assign(f.state,patch);const response = await f.handler(f.request(),f.params);
    assert.equal(response.status,patch.rateAllowed === false ? 429 : 503);
    assert.equal(f.calls.includes("video_composition_drafts"),false);assert.equal(f.calls.includes("recover"),false);
    assert.equal(f.rateKeys[0],`html-snapshot-recovery:${uuid}:${uuid}`);
  }
});

test("draft lookup is explicitly tenant scoped, missing or inactive draft cannot recover", async () => {
  for (const draft of [null,{composition_id:other,state:"ARCHIVED"}]) {
    const f = fixture();f.state.draft = draft;const response = await f.handler(f.request(),f.params);
    assert.equal(response.status,404);assert.deepEqual(f.filters,[["id",uuid],["organization_id",uuid]]);
    assert.equal(f.calls.includes("recover"),false);
  }
});

test("successful no-intent recovery uses host ownership and noncacheable correlated minimal response", async () => {
  const f = fixture();const response = await f.handler(f.request({"x-request-id":other}),f.params);
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control")!,/no-store/);
  assert.equal(response.headers.get("x-request-id"),other);assert.equal(response.headers.get("vary"),"Cookie, Authorization");
  const body = await response.json();assert.equal(body.data.status,"NO_INTENT");assert.equal(body.data.automaticRetryAllowed,false);
  assert.equal(body.requestId,other);assert.equal(body.data.operationId,uuid);
  assert.doesNotMatch(JSON.stringify(body),/sourceHtml|storagePath|grantedAssetIds|actorId|organizationId/);
});

test("registered result exposes only revision summary, not stored intent or archive bindings", async () => {
  const f = fixture();f.state.recovered = {status:"LOCATED",automaticRetryAllowed:false,intent:{status:"RECORDED",
    expectedActiveRevisionId:null,archiveSizeBytes:10,automaticRetryAllowed:false,scope:"DURABLE_IDENTITY_NOT_UPLOAD_OR_COMMIT_CONFIRMATION",
    identity:{operationId:uuid,organizationId:uuid,compositionId:other,draftId:uuid,documentHash:"a".repeat(64),projectHash:"b".repeat(64)}},
    registration:{status:"COMMITTED_SUPERSEDED",operationId:uuid,automaticRetryAllowed:false,
      scope:"DATABASE_REGISTRATION_NOT_STORAGE_OR_RENDER_ATTESTATION",currentActiveRevisionId:null,
      acknowledgment:{operationId:uuid,organizationId:uuid,compositionId:other,draftId:uuid,documentHash:"a".repeat(64),projectHash:"b".repeat(64),
        revisionId:other,revisionNumber:1,activeRevisionId:other,disposition:"CREATED"}}};
  const body = await (await f.handler(f.request(),f.params)).json();
  assert.equal(body.data.status,"COMMITTED_SUPERSEDED");assert.equal(body.data.currentActiveRevisionId,null);
  assert.equal(body.data.revisionId,other);assert.doesNotMatch(JSON.stringify(body),/projectHash|documentHash|archiveSizeBytes|identity|acknowledgment/);
});

test("abort and dependency failure never leak raw errors or request automatic retries", async () => {
  const f = fixture();f.state.recoveryError = true;const response = await f.handler(f.request(),f.params);
  const body = await response.json();assert.equal(response.status,503);assert.equal(body.retryable,false);
  assert.doesNotMatch(JSON.stringify(body),/private key|SQL details/);assert.equal(f.state.logged,1);
  const controller = new AbortController();controller.abort();
  const cancelled = fixture();await cancelled.handler(new Request("https://app.example/api/recovery",{signal:controller.signal}),cancelled.params);
  assert.equal(cancelled.calls.length,0);
});
