import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {CompositionControlledRenderQueueService} from "../qa/composition-controlled-render-queue.service";
import {processControlledRenderJob} from "../qa/composition-controlled-render-job-worker";
import {controlledRenderQueueClaimSchema,classifyControlledRenderWorkerFailure,controlledWorkerLeaseArguments} from "../qa/composition-controlled-render-worker-contract";
import {buildNativeConformanceCorpusCase} from "../qa/composition-native-conformance-corpus";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {hashCompositionDocument} from "../composition-document.service";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import type {CompositionRenderSupervisorService} from "../qa/composition-render-supervisor.service";

const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

function fixture() {
  const {document} = buildNativeConformanceCorpusCase("geometry-rotation",25);
  const browser = {protocolVersion:"1.3",product:"Chrome/test",revision:"test",userAgent:"test",jsVersion:"test"};
  const renderExecution = controlledRenderExecutionContractSchema.parse({policy:"CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend:"CONTROLLED",sdkVersion:"0.7.106",expectedBrowser:browser,
    files:Object.fromEntries(["node","producer","engine","runtime","browser","encoder","decoder"].map(role => [role,{sha256:"a".repeat(64),sizeBytes:10}]))});
  const contract = buildSnapshotConformanceContract({document,documentHash:hashCompositionDocument(document),assets:[],contractVersion:4,
    renderExecution,renderProfile:{format:"mp4",fps:25,quality:"high",resolution:"1080p"}});
  const claim = controlledRenderQueueClaimSchema.parse({organizationId:id(1),requestId:id(2),revisionId:id(3),productionJobId:id(4),
    workerId:"host_a",leaseToken:id(5),issuanceId:id(6),attempt:1,supervisorId:"supervisor_a",keyId:"key_a",
    action:"EXECUTE",executionId:null,contract});
  const calls:Array<{name:string;args:Record<string,unknown>}> = [];
  const state = {claim:claim as unknown,renew:true,renewCalls:0,finish:true,finishError:false,renewError:false};
  const supabase = {rpc:(name:string,args:Record<string,unknown>) => ({abortSignal:async (signal:AbortSignal) => {
    signal.throwIfAborted(); calls.push({name,args});
    if (name === "claim_controlled_render_worker_job") return {data:state.claim,error:null};
    if (name === "renew_controlled_render_worker_job") {state.renewCalls++; if (state.renewError) throw new Error("private DB token"); return {data:state.renew,error:null};}
    if (name === "finish_controlled_render_worker_job") return {data:state.finish,error:state.finishError ? {message:"private DB token"} : null};
    throw new Error("unexpected RPC");
  }})};
  const queue = new CompositionControlledRenderQueueService(supabase as never);
  let renders = 0,resumes = 0,saves = 0,reads = 0;
  const host = {supervisor:{execute:async (...args:Parameters<CompositionRenderSupervisorService["execute"]>) => {
    renders++; assert.equal(args[0].issuanceId,claim.issuanceId);
    assert.equal(args[2] instanceof Function,true); await args[2]!({} as never);
    return {assetId:id(80)};
  },resumeCheckpoint:async () => {resumes++; return {assetId:id(80)};}},
    checkpoints:{save:async () => {saves++;},read:async (scope:Record<string,string>) => {
      reads++; assert.equal(scope.executionId,id(7)); assert.equal(scope.organizationId,claim.organizationId); return {persisted:true};
    }}};
  return {claim,state,calls,queue,host,counts:() => ({renders,resumes,saves,reads})};
}

test("queue idle and invalid worker identity never invoke host", async () => {
  const f = fixture(); f.state.claim = null;
  assert.equal((await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => {throw new Error("must not start");}})).status,"IDLE");
  const calls = f.calls.length;
  await assert.rejects(f.queue.claim("../unsafe"),/WORKER_ID_INVALID/); assert.equal(f.calls.length,calls);
});

test("new claim owns lease, uses durable checkpoint callback and finishes exact tenant/request/token", async () => {
  const f = fixture();
  const result = await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:claim => {
    assert.deepEqual(claim,f.claim); return f.host;
  }});
  assert.equal(result.status,"SUCCEEDED"); assert.deepEqual(f.counts(),{renders:1,resumes:0,saves:1,reads:0});
  const finish = f.calls.find(call => call.name === "finish_controlled_render_worker_job")!;
  assert.deepEqual(finish.args,{p_organization_id:f.claim.organizationId,p_request_id:f.claim.requestId,p_worker_id:"host_a",
    p_worker_lease_token:f.claim.leaseToken,p_asset_id:id(80),p_error_code:null,p_retryable:false,p_recovery_required:false});
});

test("existing execution reads independent scope and resumes without renderer or issuance", async () => {
  const f = fixture(); f.state.claim = {...f.claim,action:"RESUME",executionId:id(7),attempt:2};
  assert.equal((await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host})).status,"SUCCEEDED");
  assert.deepEqual(f.counts(),{renders:0,resumes:1,saves:0,reads:1});
});

test("missing recovery journal requests intervention rather than a replacement render", async () => {
  const f = fixture(); f.state.claim = {...f.claim,action:"RESUME",executionId:id(7)};
  f.host.checkpoints.read = async () => {throw new Error("RENDER_SUPERVISOR_CHECKPOINT_READ_FAILED");};
  assert.equal((await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host})).status,"RECOVERY_REQUIRED");
  assert.equal(f.counts().renders,0); assert.equal(f.counts().resumes,0);
  assert.equal(f.calls.at(-1)!.args.p_recovery_required,true);
});

test("lost or ambiguous initial ownership never starts execution or writes finish", async () => {
  for (const failure of ["lost","unavailable"] as const) {
    const f = fixture(); f.state.renew = false; f.state.renewError = failure === "unavailable";
    const result = await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => {throw new Error("must not start");}});
    assert.equal(result.status,"LEASE_LOST"); assert.equal(f.calls.some(call => call.name.includes("finish")),false);
  }
});

test("heartbeat loss aborts cooperative execution and a late result cannot finish", async () => {
  const f = fixture();
  f.host.supervisor.execute = async (_issue,signal) => {
    f.state.renew = false;
    while (!signal!.aborted) await delay(5);
    return {assetId:id(80)}; // late result is not ownership
  };
  const result = await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host,
    heartbeatMilliseconds:10,renewalTimeoutMilliseconds:20});
  assert.equal(result.status,"LEASE_LOST"); assert.equal(f.calls.some(call => call.name.includes("finish")),false);
});

test("finish ACK failure is surfaced without rewriting durable success as execution failure", async () => {
  const f = fixture(); f.state.finishError = true;
  await assert.rejects(processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host}),/FINISH_UNCONFIRMED/);
  assert.equal(f.calls.filter(call => call.name.includes("finish")).length,1);
});

test("finish CAS rejection cannot report success or retry the render in the same turn", async () => {
  const f = fixture(); f.state.finish = false;
  assert.equal((await processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host})).status,"LEASE_LOST");
  assert.equal(f.counts().renders,1); assert.equal(f.calls.filter(call => call.name.includes("finish")).length,1);
});

test("foreign claim, conflicting action and pre-cancelled run never begin work", async () => {
  for (const mutation of [{workerId:"foreign"},{action:"RESUME",executionId:null}]) {
    const f = fixture(); f.state.claim = {...f.claim,...mutation};
    await assert.rejects(processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => {throw new Error("must not start");}}),/CLAIM_/);
  }
  const f = fixture(), shutdown = new AbortController(); shutdown.abort();
  await assert.rejects(processControlledRenderJob({queue:f.queue,workerId:"host_a",createHost:() => f.host,signal:shutdown.signal}));
  assert.deepEqual(f.calls,[]);
});

test("lease parameters and error classification stay explicit and do not expose exception details", () => {
  assert.deepEqual(controlledWorkerLeaseArguments(),{});
  assert.deepEqual(controlledWorkerLeaseArguments(id(9)),{p_worker_lease_token:id(9)});
  assert.throws(() => controlledWorkerLeaseArguments("token/path"),/LEASE_INVALID/);
  assert.deepEqual(classifyControlledRenderWorkerFailure(new Error("private path/token")),
    {code:"CONTROLLED_RENDER_WORKER_FAILED",retryable:false,recoveryRequired:false});
  assert.equal(classifyControlledRenderWorkerFailure(new Error("CONTROLLED_RENDER_UPLOAD_TRANSPORT_FAILED")).retryable,true);
});
