import assert from "node:assert/strict";
import test from "node:test";
import {createHash, generateKeyPairSync} from "node:crypto";
import {mkdtemp, readFile, writeFile, rm, rmdir,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CompositionRenderAuthorityService} from "../qa/composition-render-authority.service";
import {CompositionControlledRenderFinalizationService} from "../qa/composition-controlled-render-finalization.service";
import {CompositionControlledRenderUploadService} from "../qa/composition-controlled-render-upload.service";
import {CompositionRenderSupervisorService, type ControlledSupervisorRenderer} from "../qa/composition-render-supervisor.service";
import {signRenderSupervisorReceipt} from "../qa/composition-render-supervisor-signature";
import {RENDER_SUPERVISOR_RECEIPT_POLICY} from "../composition-render-supervisor-receipt";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {controlledRenderExecutionContractSchema, controlledRenderExecutionObservationSchema} from "../composition-render-execution-contract";
import {buildNativeConformanceCorpusCase} from "../qa/composition-native-conformance-corpus";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {hashCompositionDocument} from "../composition-document.service";
import {prepareCompositionEventBatchContracts} from "../composition-conformance-event-batch-contract";
import {buildControlledEventComparisonArtifacts} from "../qa/composition-controlled-event-comparison-artifacts";
import {CompositionRenderCheckpointStore} from "../qa/composition-render-checkpoint-store";
import {parseControlledRenderCheckpoint} from "../qa/composition-render-checkpoint";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pair = generateKeyPairSync("ed25519");

function uploader(input: Awaited<ReturnType<typeof fixture>>) {
  const state = {sessionUrl: null as string | null, stored: Buffer.alloc(0), loseChunkAck: false,
    failCheckpoint: false, externalLocation: false, wrongOffset: false, expired: false,
    sessionCalls:[] as Array<{name:string;args:any}>,
    revokeBeforeChunk: false, requests: [] as Array<{method: string; url: string; length: number}>};
  const originalRpc = input.supabase.rpc.bind(input.supabase);
  Object.assign(input.supabase, {rpc: async (name: string, args: any) => {
    if (name === "read_controlled_render_upload") {
      state.sessionCalls.push({name,args});
      return {error: null, data: {uploadUrl: state.sessionUrl, objectExists: state.stored.length === input.payload.binding.sizeBytes}};
    }
    if (name === "save_controlled_render_upload") {
      state.sessionCalls.push({name,args});
      if (state.failCheckpoint || input.context.key.revoked || args.p_expected_upload_url !== state.sessionUrl)
        return {error: null, data: false};
      state.sessionUrl = args.p_upload_url;
      if (state.revokeBeforeChunk) {input.context.key.revoked = true; state.revokeBeforeChunk = false;}
      return {error: null, data: true};
    }
    return originalRpc(name, args);
  }, storage: {from: (bucket: string) => ({
    createSignedUploadUrl: async (path: string, options: {upsert: boolean}) => {
      assert.equal(options.upsert, false);
      return {error: null, data: {path, token: "ephemeral-scoped-token"}};
    },
    createSignedUrl: async (path: string) => ({error: null, data: {
      signedUrl: `https://project.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=ephemeral-read`}}),
  })}});
  const fetchImpl = (async (raw: string | URL | Request, init: RequestInit) => {
    const url = String(raw), method = init.method ?? "GET";
    const bytes = Buffer.isBuffer(init.body) ? init.body : Buffer.alloc(0);
    state.requests.push({method, url, length: bytes.length});
    assert.equal(init.redirect, "error");
    if (method === "GET") return new Response(state.stored, {headers: {"content-type": "video/mp4"}});
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["x-signature"], "ephemeral-scoped-token");
    assert.equal("Authorization" in headers, false);
    assert.equal("x-upsert" in headers, false);
    if (method === "POST") return new Response(null, {status: 201, headers: {location: state.externalLocation
      ? "https://attacker.example/session" : "/storage/v1/upload/resumable/session_a"}});
    if (method === "HEAD") {
      if (state.expired) {state.expired = false; state.stored = Buffer.alloc(0); return new Response(null, {status: 410});}
      return new Response(null, {status: 200, headers: {"upload-offset": String(state.stored.length),
        "upload-length": String(input.payload.binding.sizeBytes)}});
    }
    assert.equal(Number(headers["Upload-Offset"]), state.stored.length);
    assert.ok(bytes.length <= 6 * 1024 ** 2);
    state.stored = Buffer.concat([state.stored, bytes]);
    if (state.loseChunkAck) {state.loseChunkAck = false; throw new Error("private token detail");}
    return new Response(null, {status: 204, headers: {"upload-offset": String(state.stored.length + (state.wrongOffset ? 1 : 0))}});
  }) as typeof fetch;
  return {state, fetchImpl, service: new CompositionControlledRenderUploadService(input.supabase,
    "https://project.supabase.co", fetchImpl, () => input.state.clockMilliseconds)};
}

function supervisor(input: Awaited<ReturnType<typeof fixture>>, render?: ControlledSupervisorRenderer, key = pair.privateKey,workerLeaseToken?:string) {
  const upload = uploader(input);
  let renderCalls = 0;
  const service = new CompositionRenderSupervisorService(input.supabase,"https://project.supabase.co",key,
    async (descriptor, signal) => {
      renderCalls++;
      assert.deepEqual(Object.keys(descriptor).sort(), ["contract","documentHash","executionId","organizationId","projectHash","revisionId"]);
      assert.equal(JSON.stringify(descriptor).includes(input.scope.leaseToken), false);
      if (workerLeaseToken) assert.equal(JSON.stringify(descriptor).includes(workerLeaseToken),false);
      assert.equal("key" in descriptor, false);
      return render ? render(descriptor,signal) : {videoPath: input.videoPath, artifacts: input.admit.artifacts};
    }, upload.fetchImpl, () => input.state.clockMilliseconds,workerLeaseToken);
  const issue = {organizationId: input.scope.organizationId, requestId: input.scope.requestId,
    issuanceId: id(7), supervisorId: input.context.supervisorId, keyId: input.context.keyId, contract: input.context.contract};
  return {service, upload, issue, renderCalls: () => renderCalls};
}

test("host coordinator connects issuance, signing, admission, bounded upload and finalization", async () => {
  const input = await fixture();
  try {
    const host = supervisor(input, async descriptor => {
      descriptor.projectHash = "e".repeat(64); // Adapter cannot mutate the host's frozen authority.
      return {videoPath: input.videoPath, artifacts: input.admit.artifacts};
    });
    assert.equal((await host.service.execute(host.issue)).assetId, id(80));
    assert.equal(host.renderCalls(),1);
    assert.equal(input.state.receipt!.payload.binding.projectHash,input.context.projectHash);
    assert.deepEqual(input.calls.filter(call => ["issue_composition_render_execution","consume_composition_render_execution",
      "finalize_controlled_composition_render"].includes(call.name)).map(call => call.name),
      ["issue_composition_render_execution","consume_composition_render_execution","finalize_controlled_composition_render"]);
    assert.equal(input.state.cancelled,false);
  } finally {await input.close();}
});

test("host coordinator reconciles a lost admission ACK without rendering or consuming twice", async () => {
  const input = await fixture();
  try {
    input.state.loseAcknowledgement = true;
    const host = supervisor(input);
    await host.service.execute(host.issue);
    assert.equal(host.renderCalls(),1);
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length,1);
    assert.equal(input.state.cancelled,false);
  } finally {await input.close();}
});

test("queued host propagates only the queue lease to fenced RPCs, never to renderer", async () => {
  const input = await fixture(), token = id(97);
  try {
    const host = supervisor(input,undefined,pair.privateKey,token);
    await host.service.execute(host.issue);
    for (const name of ["issue_composition_render_execution","consume_composition_render_execution",
      "read_controlled_render_upload","save_controlled_render_upload","finalize_controlled_composition_render"]) {
      const calls = [...input.calls,...host.upload.state.sessionCalls].filter(call => call.name === name);
      assert.ok(calls.length > 0,name);
      for (const call of calls) assert.equal(call.args.p_worker_lease_token,token);
    }
    assert.equal(host.renderCalls(),1);
  } finally {await input.close();}
});

test("queued cancellation retains queue fencing without exposing either lease to child adapter", async () => {
  const input = await fixture(), token = id(97);
  try {
    const host = supervisor(input,async () => {throw new Error("operator execution failed");},pair.privateKey,token);
    await assert.rejects(host.service.execute(host.issue),/RENDER_SUPERVISOR_EXECUTION_FAILED/);
    assert.equal(input.calls.find(call => call.name === "cancel_composition_render_execution")!.args.p_worker_lease_token,token);
  } finally {await input.close();}
});

test("host coordinator rejects mismatched signing key and cancels producer failure before admission", async () => {
  for (const failure of ["key","producer","expired","binding"] as const) {
    const input = await fixture();
    try {
      const host = supervisor(input, async () => {
        if (failure === "producer") throw new Error("private renderer path/token");
        if (failure === "expired") input.state.clockMilliseconds = input.context.expiresAtMilliseconds;
        if (failure === "binding") {
          assert.ok(input.context.contract.schemaVersion === 4);
          input.admit.artifacts.input.contract = {...input.context.contract, documentHash: "f".repeat(64)};
        }
        return {videoPath: input.videoPath, artifacts: input.admit.artifacts};
      }, failure === "key" ? generateKeyPairSync("ed25519").privateKey : pair.privateKey);
      await assert.rejects(host.service.execute(host.issue), error => error instanceof Error
        && !error.message.includes("private") && /RENDER_SUPERVISOR_|CONTROLLED_RENDER_/.test(error.message));
      assert.equal(input.state.cancelled,true);
      assert.equal(input.calls.some(call => call.name === "consume_composition_render_execution"),false);
      if (failure === "key") assert.equal(host.renderCalls(),0);
    } finally {await input.close();}
  }
});

test("consumed upload failure retains evidence and resumes after TTL without calling renderer", async () => {
  const input = await fixture();
  try {
    const host = supervisor(input); host.upload.state.loseChunkAck = true;
    await assert.rejects(host.service.execute(host.issue),/UPLOAD_TRANSPORT_FAILED/);
    assert.equal(input.state.cancelled,false);
    input.state.clockMilliseconds = input.context.key.notAfterMilliseconds + 1;
    assert.equal((await host.service.resume({scope: input.recoveryScope,videoPath: input.videoPath,
      artifacts: input.admit.artifacts})).assetId,id(80));
    assert.equal(host.renderCalls(),1);
    assert.equal(input.calls.filter(call => call.name === "issue_composition_render_execution").length,1);
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length,1);
  } finally {await input.close();}
});

async function journal(input:Awaited<ReturnType<typeof fixture>>) {
  const root = await mkdtemp(join(tmpdir(),"render-checkpoint-test-"));
  const store = new CompositionRenderCheckpointStore(root,dirname(input.videoPath));
  const directory = join(root,`${input.recoveryScope.organizationId}-${input.recoveryScope.requestId}-${input.recoveryScope.executionId}`);
  return {root,store,path:join(directory,"checkpoint.json"),close:async () => {
    if ((await readdir(root)).length) {
      for (const file of await readdir(directory)) {assert.ok(["checkpoint.json","pending.json"].includes(file)); await rm(join(directory,file));}
      await rmdir(directory);
    }
    await rmdir(root);
  }};
}

test("fsynced checkpoint is saved before admission and a new host resumes consumed upload after TTL", async () => {
  const input = await fixture(), local = await journal(input);
  try {
    const host = supervisor(input); host.upload.state.loseChunkAck = true;
    await assert.rejects(host.service.execute(host.issue,undefined,async checkpoint => {
      assert.equal(input.state.receipt,null);
      await local.store.save(checkpoint);
    }), /UPLOAD_TRANSPORT_FAILED/);
    const checkpoint = await new CompositionRenderCheckpointStore(local.root,dirname(input.videoPath)).read(input.recoveryScope);
    assert.equal((await readFile(local.path,"utf8")).includes(pair.privateKey.export({format:"pem",type:"pkcs8"}).toString()),false);
    input.state.clockMilliseconds = input.context.key.notAfterMilliseconds + 1;
    const restarted = new CompositionRenderSupervisorService(input.supabase,"https://project.supabase.co",pair.privateKey,
      async () => {throw new Error("renderer must not run during recovery");},host.upload.fetchImpl,() => input.state.clockMilliseconds);
    assert.equal((await restarted.resumeCheckpoint(checkpoint,input.recoveryScope)).assetId,id(80));
    assert.equal(host.renderCalls(),1);
    assert.equal(input.calls.filter(call => call.name === "issue_composition_render_execution").length,1);
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length,1);
    assert.equal(input.state.cancelled,false);
    await local.store.save(checkpoint); // identical immutable publication is idempotent
  } finally {await local.close(); await input.close();}
});

test("saved checkpoint retries uncommitted admission with the same output and no new render", async () => {
  const input = await fixture(), local = await journal(input);
  try {
    input.state.consume = false;
    const host = supervisor(input);
    await assert.rejects(host.service.execute(host.issue,undefined,checkpoint => local.store.save(checkpoint)), /RECOVERY_UNAVAILABLE/);
    assert.equal(input.state.cancelled,false);
    input.state.consume = true;
    const checkpoint = await local.store.read(input.recoveryScope);
    assert.equal((await host.service.resumeCheckpoint(checkpoint,input.recoveryScope)).assetId,id(80));
    assert.equal(host.renderCalls(),1);
    assert.equal(input.calls.filter(call => call.name === "issue_composition_render_execution").length,1);
  } finally {await local.close(); await input.close();}
});

test("checkpoint publication failure cancels unconsumed authority without starting upload", async () => {
  const input = await fixture();
  try {
    const host = supervisor(input);
    await assert.rejects(host.service.execute(host.issue,undefined,async () => {throw new Error("private local path/token");}),
      /RENDER_SUPERVISOR_CHECKPOINT_WRITE_FAILED/);
    assert.equal(input.state.cancelled,true);
    assert.equal(input.calls.some(call => call.name === "consume_composition_render_execution"),false);
    assert.deepEqual(host.upload.state.requests,[]);
  } finally {await input.close();}
});

test("checkpoint read rejects foreign scope, corrupted JSON and changed retained video", async () => {
  for (const mutation of ["scope","json","video"] as const) {
    const input = await fixture(), local = await journal(input);
    try {
      const host = supervisor(input);
      await host.service.execute(host.issue,undefined,checkpoint => local.store.save(checkpoint));
      if (mutation === "scope") {
        const checkpoint = await local.store.read(input.recoveryScope);
        const calls = input.calls.length;
        await assert.rejects(host.service.resumeCheckpoint(checkpoint,{...input.recoveryScope,organizationId:id(99)}), /CHECKPOINT_INVALID/);
        assert.equal(input.calls.length,calls);
      } else {
        if (mutation === "json") await writeFile(local.path,"{broken");
        if (mutation === "video") await writeFile(input.videoPath,"changed video");
        await assert.rejects(local.store.read(input.recoveryScope), /CHECKPOINT_READ_FAILED/);
      }
    } finally {await local.close(); await input.close();}
  }
});

test("checkpoint journal cannot overwrite a different record or accept an output outside retained directory", async () => {
  const input = await fixture(), local = await journal(input);
  try {
    const host = supervisor(input);
    await host.service.execute(host.issue,undefined,checkpoint => local.store.save(checkpoint));
    const checkpoint = await local.store.read(input.recoveryScope);
    await assert.rejects(local.store.save({...checkpoint,leaseToken:id(91)}), /CHECKPOINT_CONFLICT/);
    assert.deepEqual(await local.store.read(input.recoveryScope),checkpoint);
    const foreignStore = new CompositionRenderCheckpointStore(local.root,local.root);
    await assert.rejects(foreignStore.save(checkpoint), /VIDEO_OWNERSHIP_INVALID/);
    const mutated = structuredClone(checkpoint); mutated.artifacts.input.observation = {};
    assert.throws(() => parseControlledRenderCheckpoint(mutated,input.recoveryScope), /CHECKPOINT_INVALID/);
  } finally {await local.close(); await input.close();}
});

test("cancelled or expired uncommitted checkpoint and revoked consumed issuer never trigger a replacement render", async () => {
  for (const phase of ["cancelled","expired","revoked"] as const) {
    const input = await fixture(), local = await journal(input);
    try {
      const host = supervisor(input);
      if (phase !== "revoked") input.state.consume = false;
      try {await host.service.execute(host.issue,undefined,checkpoint => local.store.save(checkpoint));} catch {}
      const checkpoint = await local.store.read(input.recoveryScope);
      if (phase === "cancelled") input.state.cancelled = true;
      else if (phase === "expired") input.state.clockMilliseconds = input.context.expiresAtMilliseconds + 1;
      else input.context.key.revoked = true;
      const requests = host.upload.state.requests.length;
      await assert.rejects(host.service.resumeCheckpoint(checkpoint,input.recoveryScope));
      assert.equal(host.renderCalls(),1); assert.equal(host.upload.state.requests.length,requests);
    } finally {await local.close(); await input.close();}
  }
});

test("historical checkpoint recovery requires the exact committed receipt even if its artifacts still match", async () => {
  const input = await fixture(), local = await journal(input);
  try {
    const host = supervisor(input);
    await host.service.execute(host.issue,undefined,checkpoint => local.store.save(checkpoint));
    const checkpoint = await local.store.read(input.recoveryScope);
    checkpoint.supervisorReceipt.signature = "a".repeat(86);
    input.state.clockMilliseconds = input.context.expiresAtMilliseconds + 1;
    const requests = host.upload.state.requests.length;
    await assert.rejects(host.service.resumeCheckpoint(checkpoint,input.recoveryScope), /CHECKPOINT_RECEIPT_MISMATCH/);
    assert.equal(host.upload.state.requests.length,requests);
  } finally {await local.close(); await input.close();}
});

test("controlled upload transfers bounded chunks and verifies Storage before finalization", async () => {
  const input = await fixture(Buffer.alloc(6 * 1024 ** 2 + 7, 42));
  try {
    await input.service.admit(input.admit);
    const upload = uploader(input);
    const params = {scope: input.recoveryScope, videoPath: input.videoPath, artifacts: input.admit.artifacts};
    assert.equal((await upload.service.uploadAndFinalize(params)).assetId, id(80));
    assert.deepEqual(upload.state.requests.filter(request => request.method === "PATCH").map(request => request.length), [6 * 1024 ** 2, 7]);
    const previousRequests = upload.state.requests.length;
    await upload.service.uploadAndFinalize(params);
    assert.deepEqual(upload.state.requests.slice(previousRequests).map(request => request.method), ["GET"]);
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length, 1);
  } finally {await input.close();}
});

test("controlled upload resumes from server HEAD after lost PATCH ACK without replaying accepted bytes", async () => {
  const input = await fixture(Buffer.alloc(6 * 1024 ** 2 + 13, 43));
  try {
    await input.service.admit(input.admit);
    const upload = uploader(input); upload.state.loseChunkAck = true;
    const params = {scope: input.recoveryScope, videoPath: input.videoPath, artifacts: input.admit.artifacts};
    await assert.rejects(upload.service.uploadAndFinalize(params), /UPLOAD_TRANSPORT_FAILED/);
    assert.equal(input.calls.some(call => call.name === "finalize_controlled_composition_render"), false);
    assert.equal(upload.state.stored.length, 6 * 1024 ** 2);
    await upload.service.uploadAndFinalize(params);
    assert.deepEqual(upload.state.requests.map(request => request.method), ["POST","PATCH","HEAD","PATCH","GET"]);
    assert.equal(upload.state.requests[3].length, 13);
  } finally {await input.close();}
});

test("expired controlled upload session is CAS-replaced without enabling overwrite", async () => {
  const input = await fixture();
  try {
    await input.service.admit(input.admit);
    const upload = uploader(input);
    upload.state.sessionUrl = "https://project.supabase.co/storage/v1/upload/resumable/session_expired";
    upload.state.stored = Buffer.from("own"); upload.state.expired = true;
    await upload.service.uploadAndFinalize({scope: input.recoveryScope, videoPath: input.videoPath, artifacts: input.admit.artifacts});
    assert.deepEqual(upload.state.requests.map(request => request.method), ["HEAD","POST","PATCH","GET"]);
    assert.equal(upload.state.sessionUrl, "https://project.supabase.co/storage/v1/upload/resumable/session_a");
    assert.equal(upload.state.stored.toString(), "owned output");
  } finally {await input.close();}
});

test("controlled upload cancellation before work does not read session, request tokens or transfer bytes", async () => {
  const input = await fixture();
  try {
    await input.service.admit(input.admit);
    const upload = uploader(input), controller = new AbortController(); controller.abort();
    await assert.rejects(upload.service.uploadAndFinalize({scope: input.recoveryScope,
      videoPath: input.videoPath, artifacts: input.admit.artifacts, signal: controller.signal}));
    assert.equal(upload.state.requests.length, 0);
    assert.equal(input.state.historyReads, 0);
  } finally {await input.close();}
});

test("upload refuses foreign location, checkpoint rejection, revocation and mismatched offsets", async () => {
  for (const failure of ["externalLocation","failCheckpoint","revokeBeforeChunk","wrongOffset"] as const) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit);
      const upload = uploader(input); upload.state[failure] = true;
      await assert.rejects(upload.service.uploadAndFinalize({scope: input.recoveryScope,
        videoPath: input.videoPath, artifacts: input.admit.artifacts}), /CONTROLLED_RENDER_UPLOAD_/);
      assert.equal(input.calls.some(call => call.name === "finalize_controlled_composition_render"), false);
      if (failure !== "wrongOffset") assert.equal(upload.state.requests.some(request => request.method === "PATCH"), false);
      assert.equal(upload.state.requests.some(request => request.url.startsWith("https://attacker.example")), false);
    } finally {await input.close();}
  }
});

function finalizer(input: Awaited<ReturnType<typeof fixture>>, options: {
  body?: string; signedUrl?: string; afterRead?: () => void; responseStatus?: number; headers?: Record<string, string>;
} = {}) {
  Object.assign(input.supabase, {storage: {from: (bucket: string) => {
    assert.equal(bucket, "production-videos");
    return {createSignedUrl: async (path: string) => ({error: null, data: {signedUrl:
      options.signedUrl ?? `https://project.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=ephemeral`}})};
  }}});
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    assert.equal(init.redirect, "error");
    options.afterRead?.();
    return new Response(options.body ?? "owned output", {status: options.responseStatus ?? 200,
      headers: {"content-type": "video/mp4", ...options.headers}});
  }) as typeof fetch;
  return new CompositionControlledRenderFinalizationService(input.supabase, "https://project.supabase.co",
    fetchImpl, () => input.state.clockMilliseconds);
}

test("controlled finalization verifies stored bytes, refreshes authority and commits only bound lineage", async () => {
  const input = await fixture();
  try {
    await input.service.admit(input.admit);
    const service = finalizer(input);
    const result = await service.finalize({scope: input.recoveryScope, videoPath: input.videoPath, artifacts: input.admit.artifacts});
    assert.equal(result.assetId, id(80));
    assert.equal(result.conformanceApproved, false);
    assert.equal(input.state.historyReads, 4);
    const commit = input.calls.find(call => call.name === "finalize_controlled_composition_render")!;
    assert.equal(commit.args.p_video_sha256, input.payload.binding.videoSha256);
    assert.equal(commit.args.p_receipt_sha256, digest(input.supervisorReceipt));
    assert.equal(commit.args.p_production_job_id, input.context.productionJobId);
    assert.ok(commit.args.p_public_url.endsWith(`/${result.checksum}.mp4`));
    assert.equal(commit.args.p_public_url.includes("token="), false);
    await service.finalize({scope: input.recoveryScope, videoPath: input.videoPath, artifacts: input.admit.artifacts});
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length, 1);
  } finally {await input.close();}
});

test("controlled finalization rejects changed, truncated, excessive and partial Storage bytes before writes", async () => {
  const scenarios: NonNullable<Parameters<typeof finalizer>[1]>[] = [
    {body: "owned outpuX"}, {body: "short"}, {body: "excessive stored output"}, {responseStatus: 206},
    {headers: {"content-length": "1"}}, {headers: {"content-range": "bytes 0-11/12"}}, {headers: {"content-type": "text/html"}}];
  for (const options of scenarios) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit);
      await assert.rejects(finalizer(input, options).finalize({scope: input.recoveryScope,
        videoPath: input.videoPath, artifacts: input.admit.artifacts}), /CONTROLLED_RENDER_STORAGE_/);
      assert.equal(input.calls.some(call => call.name === "finalize_controlled_composition_render"), false);
    } finally {await input.close();}
  }
});

test("controlled finalization honours cancellation before work and after Storage without committing", async () => {
  for (const early of [true, false]) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit);
      const controller = new AbortController();
      if (early) controller.abort();
      const service = finalizer(input, {afterRead: () => controller.abort()});
      await assert.rejects(service.finalize({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts, signal: controller.signal}));
      assert.equal(input.calls.some(call => call.name === "finalize_controlled_composition_render"), false);
      if (early) assert.equal(input.state.historyReads, 0);
    } finally {await input.close();}
  }
});

test("controlled finalization refuses external signed URLs and revocation during Storage read", async () => {
  for (const attack of ["external", "path", "revoke"] as const) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit);
      const service = finalizer(input, attack === "revoke" ? {afterRead: () => {input.context.key.revoked = true;}}
        : {signedUrl: attack === "external" ? "https://attacker.example/output?token=secret"
          : "https://project.supabase.co/storage/v1/object/sign/production-videos/other.mp4?token=secret"});
      await assert.rejects(service.finalize({scope: input.recoveryScope,
        videoPath: input.videoPath, artifacts: input.admit.artifacts}), /STORAGE_URL_INVALID|ISSUER_UNAUTHORIZED/);
      assert.equal(input.calls.some(call => call.name === "finalize_controlled_composition_render"), false);
    } finally {await input.close();}
  }
});

async function fixture(bytes = Buffer.from("owned output")) {
  const directory = await mkdtemp(join(tmpdir(), "render-authority-test-")), videoPath = join(directory, "owned.mp4");
  // A filesystem hash fixture, not an actual video/render or codec validation.
  await writeFile(videoPath, bytes, {flag: "wx"});
  const videoSha256 = createHash("sha256").update(bytes).digest("hex"), now = 100_000;
  const {document} = buildNativeConformanceCorpusCase("geometry-rotation", 25);
  const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
  const renderExecution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "a".repeat(64), sizeBytes: 10}]))});
  const documentHash = hashCompositionDocument(document);
  const contract = buildSnapshotConformanceContract({document, documentHash, assets: [], contractVersion: 4,
    renderExecution, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const observation = controlledRenderExecutionObservationSchema.parse({policy: renderExecution.policy, documentHash,
    videoSha256, files: renderExecution.files, browserBefore: browser, browserAfter: browser});
  const artifactsInput = {contract, observation, documentHash, videoSha256};
  const local = buildControlledComparisonArtifacts(artifactsInput);
  const context = {organizationId: id(1), requestId: id(2), revisionId: id(3), productionJobId: id(4),
    executionId: id(5), attempt: 1, leaseToken: id(6), challengeSha256: "b".repeat(64),
    documentHash, projectHash: "c".repeat(64), contractSha256: digest(contract),
    artifactKind: "SINGLE_CONTRACT" as "SINGLE_CONTRACT" | "EVENT_BATCH_SET",
    supervisorId: "supervisor_a", keyId: "key_a", issuedAtMilliseconds: now - 1000,
    expiresAtMilliseconds: now + 10_000, contract,
    key: {publicKeySpkiBase64: pair.publicKey.export({format: "der", type: "spki"}).toString("base64"),
      notBeforeMilliseconds: now - 10_000, notAfterMilliseconds: now + 100_000, revoked: false}};
  const binding = {organizationId: context.organizationId, requestId: context.requestId, revisionId: context.revisionId,
    productionJobId: context.productionJobId, executionId: context.executionId, attempt: context.attempt,
    challengeSha256: context.challengeSha256, artifactKind: context.artifactKind, documentHash, projectHash: context.projectHash,
    contractSha256: context.contractSha256, observationSha256: digest(observation), comparisonReceiptSha256: digest(local.receipt),
    videoSha256, sizeBytes: bytes.length};
  const payload = {policy: RENDER_SUPERVISOR_RECEIPT_POLICY,
    scope: "SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE" as const,
    supervisorId: context.supervisorId, keyId: context.keyId, issuedAtMilliseconds: now - 100,
    expiresAtMilliseconds: now + 1000, binding};
  const supervisorReceipt = signRenderSupervisorReceipt(payload, pair.privateKey);
  const calls: Array<{name: string; args: any}> = [];
  const state = {cancelled: false, consume: true, fail: false, mutateAfterCommit: false, receiptHash: "",
    receipt: null as ReturnType<typeof signRenderSupervisorReceipt> | null, consumedAtMilliseconds: now,
    clockMilliseconds: now, loseAcknowledgement: false, ledgerState: "CONSUMED", historyReads: 0,
    revokeOnSecondHistoryRead: false, mutateFileOnSecondHistoryRead: false, failSecondHistoryRead: false};
  const supabase = {rpc: async (name: string, args: any) => {
    calls.push({name, args});
    if (state.fail) return {data: null, error: {message: "private provider detail"}};
    if (name === "issue_composition_render_execution") return {data: structuredClone(context), error: null};
    if (name === "read_composition_render_execution") return {data: state.cancelled ? null : structuredClone(context), error: null};
    if (name === "read_consumed_composition_render_execution") {
      state.historyReads++;
      if (state.failSecondHistoryRead && state.historyReads === 2)
        return {data: null, error: {message: "private DB detail"}};
      if (!state.receipt) return {data: null, error: null};
      if (state.revokeOnSecondHistoryRead && state.historyReads === 2) context.key.revoked = true;
      if (state.mutateFileOnSecondHistoryRead && state.historyReads === 2) await writeFile(videoPath, "changed history output");
      return {data: {state: state.ledgerState, context: structuredClone(context), receipt: structuredClone(state.receipt),
        receiptSha256: state.receiptHash, consumedAtMilliseconds: state.consumedAtMilliseconds}, error: null};
    }
    if (name === "cancel_composition_render_execution") {state.cancelled = true; return {data: true, error: null};}
    if (name === "consume_composition_render_execution") {
      if (!state.consume || state.receiptHash && state.receiptHash !== args.p_receipt_sha256) return {data: false, error: null};
      state.receiptHash = args.p_receipt_sha256;
      state.receipt = structuredClone(args.p_receipt); state.consumedAtMilliseconds = state.clockMilliseconds;
      if (state.mutateAfterCommit) await writeFile(videoPath, "changed output");
      if (state.loseAcknowledgement) return {data: null, error: {message: "lost acknowledgement"}};
      return {data: true, error: null};
    }
    if (name === "finalize_controlled_composition_render") return {data: id(80), error: null};
    throw new Error("unexpected RPC");
  }} as unknown as SupabaseClient<any, any, any>;
  const service = new CompositionRenderAuthorityService(supabase, () => state.clockMilliseconds);
  const scope = {organizationId: context.organizationId, requestId: context.requestId,
    executionId: context.executionId, leaseToken: context.leaseToken};
  return {context, calls, state, service, supabase, scope, payload, supervisorReceipt, videoPath,
    admit: {scope, supervisorReceipt, videoPath, artifacts: {kind: "SINGLE_CONTRACT" as const, input: artifactsInput}},
    recoveryScope: {organizationId: context.organizationId, requestId: context.requestId, executionId: context.executionId,
      revisionId: context.revisionId, productionJobId: context.productionJobId},
    close: async () => {await rm(videoPath, {force: true}); await rmdir(directory);}};
}

test("authority issues against the supplied frozen contract and rejects foreign context", async () => {
  const input = await fixture();
  try {
    const params = {organizationId: input.scope.organizationId, requestId: input.scope.requestId,
      issuanceId: id(7), supervisorId: input.context.supervisorId, keyId: input.context.keyId, contract: input.context.contract};
    assert.equal((await input.service.issue(params)).executionId, input.scope.executionId);
    assert.equal(input.calls[0].args.p_contract_sha256, input.context.contractSha256);
    input.context.organizationId = id(90);
    await assert.rejects(input.service.issue(params), /CONTEXT_MISMATCH/);
  } finally {await input.close();}
});

test("admission derives output and trusted binding independently, commits exact signed receipt idempotently", async () => {
  const input = await fixture();
  try {
    const result = await input.service.admit(input.admit);
    assert.equal(result.provenance.status, "ISSUER_VERIFIED");
    assert.ok("execution" in result);
    assert.equal(result.execution.reason, "RENDER_EXECUTION_ATTESTATION_PENDING");
    assert.equal(input.state.receiptHash, digest(input.supervisorReceipt));
    const commit = input.calls.find(call => call.name === "consume_composition_render_execution")!;
    assert.deepEqual(commit.args.p_receipt, input.supervisorReceipt);
    assert.equal(JSON.stringify(commit.args.p_receipt).includes(input.scope.leaseToken), false);
    await input.service.admit(input.admit);
    assert.equal(input.state.receiptHash, result.provenance.receiptSha256);
  } finally {await input.close();}
});

test("tenant, reservation, revision hash and expired contexts never consume a receipt", async () => {
  for (const mutation of ["tenant", "lease", "hash", "expired"] as const) {
    const input = await fixture();
    try {
      if (mutation === "tenant") input.context.organizationId = id(90);
      if (mutation === "lease") input.context.leaseToken = id(90);
      if (mutation === "hash") input.context.contractSha256 = "a".repeat(64);
      if (mutation === "expired") input.context.expiresAtMilliseconds = 100_000;
      await assert.rejects(input.service.admit(input.admit), /CONTEXT_INVALID|CONTEXT_MISMATCH/);
      assert.equal(input.calls.some(call => call.name === "consume_composition_render_execution"), false);
    } finally {await input.close();}
  }
});

test("authority admits the independently reconstructed full event set, not only the root partition", async () => {
  const input = await fixture(), localJournal = await journal(input);
  try {
    const {document} = buildNativeConformanceCorpusCase("captions-multi-batch", 25);
    assert.ok(input.context.contract.schemaVersion === 4);
    const root = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document),
      assets: [], contractVersion: 4, eventCheckpoints: true,
      renderExecution: {...input.context.contract.renderExecution!, seekRepeatabilityPolicy: "EXACT_RGBA_FORWARD_REVERSE_V1"},
      renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
    const prepared = prepareCompositionEventBatchContracts({document, parentContract: root});
    // Synthetic structured seek witnesses: no SDK frames or renderer run are implied by this test.
    const batches = Array.from({length: prepared.batchCount}, (_, index) => {
      const contract = prepared.select(index).contract;
      return {contract, seekRepeatability: {policy: "EXACT_RGBA_FORWARD_REVERSE_V1",
        scope: "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION", status: "PASS",
        documentHash: root.documentHash, contractSha256: digest(contract), checkpointCount: contract.checkpoints.length,
        byteCounts: {forward: 1, reverse: 1}, samples: contract.checkpoints.map(point => ({frameIndex: point.frameIndex,
          timeSeconds: point.timeSeconds, rgbaSha256: "a".repeat(64)}))}};
    });
    assert.ok(batches.length > 1);
    input.context.artifactKind = "EVENT_BATCH_SET"; input.context.contract = root;
    input.context.documentHash = root.documentHash; input.context.contractSha256 = digest(root);
    const observation = controlledRenderExecutionObservationSchema.parse({...input.admit.artifacts.input.observation,
      documentHash: root.documentHash});
    const artifactInput = {document, parentContract: root, observation, videoSha256: input.payload.binding.videoSha256, batches};
    const local = buildControlledEventComparisonArtifacts(artifactInput);
    const binding = {...input.payload.binding, artifactKind: "EVENT_BATCH_SET", documentHash: root.documentHash,
      contractSha256: digest(root), observationSha256: digest(observation),
      comparisonReceiptSha256: digest({coverage: local.coverage, receipts: local.artifacts.map(artifact => artifact.receipt)})};
    const supervisorReceipt = signRenderSupervisorReceipt({...input.payload, binding}, pair.privateKey);
    await localJournal.store.save({version:1,scope:input.recoveryScope,leaseToken:input.scope.leaseToken,
      videoPath:input.videoPath,supervisorReceipt,artifacts:{kind:"EVENT_BATCH_SET",input:artifactInput}});
    const checkpoint = await localJournal.store.read(input.recoveryScope);
    assert.equal(checkpoint.artifacts.kind,"EVENT_BATCH_SET");
    if (checkpoint.artifacts.kind === "EVENT_BATCH_SET") {
      assert.equal(checkpoint.artifacts.input.batches.length,batches.length);
      const incomplete = structuredClone(checkpoint);
      if (incomplete.artifacts.kind === "EVENT_BATCH_SET") incomplete.artifacts.input.batches.pop();
      assert.throws(() => parseControlledRenderCheckpoint(incomplete,input.recoveryScope), /CHECKPOINT_INVALID/);
    }
    const result = await input.service.admit({...input.admit, supervisorReceipt,
      artifacts: {kind: "EVENT_BATCH_SET", input: artifactInput}});
    assert.ok("coverage" in result);
    assert.equal(result.coverage.batchCount, batches.length);
    assert.equal(result.provenance.status, "ISSUER_VERIFIED");
    assert.equal(input.state.receiptHash, digest(supervisorReceipt));
    input.state.clockMilliseconds = 500_000;
    const recovered = await input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
      artifacts: {kind: "EVENT_BATCH_SET", input: artifactInput}});
    assert.ok("coverage" in recovered);
    assert.equal(recovered.coverage.batchCount, batches.length);
    assert.equal(recovered.recovery.consumedAtMilliseconds, 100_000);
  } finally {await localJournal.close(); await input.close();}
});

test("assigned key, revocation and authority lifetime dominate otherwise-valid signed receipts", async () => {
  for (const mutation of ["issuer", "revoked", "interval", "key"] as const) {
    const input = await fixture();
    try {
      if (mutation === "issuer") input.context.keyId = "another_key";
      if (mutation === "revoked") input.context.key.revoked = true;
      if (mutation === "interval") input.context.expiresAtMilliseconds = input.payload.expiresAtMilliseconds - 1;
      if (mutation === "key") input.context.key.publicKeySpkiBase64 = "AAAA";
      await assert.rejects(input.service.admit(input.admit), /ISSUER_MISMATCH|ISSUER_UNAUTHORIZED|INTERVAL_INVALID|TRUST_INVALID/);
      assert.equal(input.calls.some(call => call.name === "consume_composition_render_execution"), false);
    } finally {await input.close();}
  }
});

test("actual file changes cannot be disguised by the receipt's video hash or declared size", async () => {
  const input = await fixture();
  try {
    await writeFile(input.videoPath, "foreign output");
    await assert.rejects(input.service.admit(input.admit), /COMPARISON_BINDING_MISMATCH/);
    assert.equal(input.state.receiptHash, "");
  } finally {await input.close();}
});

test("lost CAS or cancelled authority cannot deliver an admitted result", async () => {
  const input = await fixture();
  try {
    input.state.consume = false;
    await assert.rejects(input.service.admit(input.admit), /CONSUMPTION_REJECTED/);
    assert.equal(await input.service.cancel(input.scope), true);
    await assert.rejects(input.service.admit(input.admit), /CONTEXT_UNAVAILABLE/);
    assert.equal(input.state.receiptHash, "");
  } finally {await input.close();}
});

test("mutation after commit is surfaced without pretending the mutable file is still verified", async () => {
  const input = await fixture();
  try {
    input.state.mutateAfterCommit = true;
    await assert.rejects(input.service.admit(input.admit), /CONFORMANCE_FILE/);
    // The ledger binds the original hash. A post-commit failure does not erase its durable history.
    assert.notEqual(input.state.receiptHash, "");
  } finally {await input.close();}
});

test("authority errors do not expose provider detail and invalid scope performs no RPC", async () => {
  const input = await fixture();
  try {
    await assert.rejects(input.service.cancel({...input.scope, leaseToken: "invalid"}), /^Error: RENDER_AUTHORITY_INPUT_INVALID$/);
    assert.equal(input.calls.length, 0);
    input.state.fail = true;
    await assert.rejects(input.service.admit(input.admit), /^Error: RENDER_AUTHORITY_CONTEXT_UNAVAILABLE$/);
    await assert.rejects(input.service.cancel(input.scope), /^Error: RENDER_AUTHORITY_CANCEL_FAILED$/);
  } finally {await input.close();}
});

test("lost consumption ACK recovers after receipt/challenge/key expiry without another admission write", async () => {
  const input = await fixture();
  try {
    input.state.loseAcknowledgement = true;
    await assert.rejects(input.service.admit(input.admit), /CONSUMPTION_REJECTED/);
    assert.notEqual(input.state.receiptHash, "");
    input.state.clockMilliseconds = 500_000;
    await assert.rejects(input.service.admit(input.admit), /CONTEXT_INVALID/);
    const writesBefore = input.calls.filter(call => call.name === "consume_composition_render_execution").length;
    const result = await input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
      artifacts: input.admit.artifacts});
    assert.equal(result.provenance.status, "ISSUER_VERIFIED");
    assert.equal(result.recovery.policy, "CONSUMED_LEDGER_RECOVERY_NOT_NEW_ADMISSION_V1");
    assert.equal(result.recovery.consumedAtMilliseconds, 100_000);
    assert.equal(result.recovery.checkedAtMilliseconds, 500_000);
    assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length, writesBefore);
    assert.equal(input.calls.some(call => call.name === "issue_composition_render_execution"), false);
    assert.ok("execution" in result);
    assert.equal(result.execution.reason, "RENDER_EXECUTION_ATTESTATION_PENDING");
  } finally {await input.close();}
});

test("recovery cannot manufacture a consumed ledger from missing/running/cancelled records", async () => {
  for (const state of ["missing", "RUNNING", "CANCELLED"] as const) {
    const input = await fixture();
    try {
      if (state !== "missing") {await input.service.admit(input.admit); input.state.ledgerState = state;}
      input.state.clockMilliseconds = 500_000;
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts}), /RECOVERY_UNAVAILABLE|CONSUMED_RECORD_INVALID/);
    } finally {await input.close();}
  }
});

test("historical recovery retains independent tenant/revision/job and canonical receipt integrity", async () => {
  for (const mutation of ["tenant", "revision", "job", "hash", "signature"] as const) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit); input.state.clockMilliseconds = 500_000;
      if (mutation === "tenant") input.context.organizationId = id(90);
      if (mutation === "revision") input.context.revisionId = id(90);
      if (mutation === "job") input.context.productionJobId = id(90);
      if (mutation === "hash") input.state.receiptHash = "e".repeat(64);
      if (mutation === "signature") {
        input.state.receipt!.signature = "a".repeat(86); input.state.receiptHash = digest(input.state.receipt);
      }
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts}), /CONTEXT_MISMATCH|CONSUMED_RECORD_INVALID|SIGNATURE_INVALID/);
    } finally {await input.close();}
  }
});

test("current revocation before or during recovery blocks an otherwise valid historical signature", async () => {
  for (const duringRead of [false, true]) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit); input.state.clockMilliseconds = 500_000;
      if (duringRead) input.state.revokeOnSecondHistoryRead = true; else input.context.key.revoked = true;
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts}), /ISSUER_UNAUTHORIZED|RECOVERY_CHANGED/);
    } finally {await input.close();}
  }
});

test("only durable in-window consumption time can verify history, caller time does not bypass it", async () => {
  for (const timestamp of [98_999, 110_000, 500_001 + 30_000]) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit); input.state.clockMilliseconds = 500_000;
      input.state.consumedAtMilliseconds = timestamp;
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts, consumedAtMilliseconds: 100_000} as any), /CONSUMED_RECORD_INVALID/);
    } finally {await input.close();}
  }
});

test("history still rejects altered local output and comparison obligations", async () => {
  for (const mutation of ["file", "observation"] as const) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit); input.state.clockMilliseconds = 500_000;
      if (mutation === "file") await writeFile(input.videoPath, "foreign output");
      else input.admit.artifacts.input.observation.files.encoder.sizeBytes++;
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts}), /COMPARISON_BINDING_MISMATCH|EXECUTION_MISMATCH/);
    } finally {await input.close();}
  }
});

test("failed final ledger read or late file mutation cannot deliver a recovered result", async () => {
  for (const failure of ["read", "file"] as const) {
    const input = await fixture();
    try {
      await input.service.admit(input.admit); input.state.clockMilliseconds = 500_000;
      if (failure === "read") input.state.failSecondHistoryRead = true;
      else input.state.mutateFileOnSecondHistoryRead = true;
      await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
        artifacts: input.admit.artifacts}), /RECOVERY_UNAVAILABLE|CONFORMANCE_FILE/);
      assert.equal(input.calls.filter(call => call.name === "consume_composition_render_execution").length, 1);
    } finally {await input.close();}
  }
});

test("a future consumed timestamp cannot be justified by caller time or local clock rollback", async () => {
  const input = await fixture();
  try {
    await input.service.admit(input.admit); input.state.clockMilliseconds = 50_000;
    await assert.rejects(input.service.recover({scope: input.recoveryScope, videoPath: input.videoPath,
      artifacts: input.admit.artifacts}), /CONSUMED_RECORD_INVALID/);
  } finally {await input.close();}
});
