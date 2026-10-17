import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,readdir,rm,rmdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import JSZip from "jszip";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {hashCompositionDocument} from "../composition-document.service";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {buildConformanceReferenceSource} from "../composition-conformance-reference.service";
import {readCompositionAnimationRuntime} from "../composition-preview-compiler.service";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {materializeControlledRenderRevision} from "../qa/composition-controlled-render-materialization";
import {createMaterializedControlledRenderer} from "../qa/composition-materialized-supervisor-renderer";
import {assertControlledDeckSourcesLocal, applyControlledBrowserResourcePolicy, CONTROLLED_BROWSER_RESOURCE_POLICY} from "../qa/composition-controlled-source-policy";
import {digestControlledDependencyManifest, CONTROLLED_DEPENDENCY_INVENTORY_POLICY,
  type ControlledDependencyManifest} from "../qa/composition-controlled-dependency-inventory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const media = Buffer.from("pinned media bytes, not a real video");

function policyDocument() {
  return createInitialCompositionDocument({animatedDeck:null,assets:[{productionAssetId:id(1),durationSeconds:10,
    storageBucket:"production-assets",storagePath:"media/source.mp4",checksum:sha256(media),fileSizeBytes:media.length,mimeType:"video/mp4",
    hasAudio:false,publicUrl:null,timelineRole:"BROLL"}],plan:{accentColor:"#38BDF8",durationSeconds:10,title:"Deck",subtitle:"Local"}});
}

async function fixture(externalFontStylesheet = false, executionIdentity?: {sha256: string; sizeBytes: number}) {
  const parent = await mkdtemp(join(tmpdir(),"controlled-materialization-"));
  const asset = {productionAssetId:id(1),checksum:sha256(media),fileSizeBytes:media.length,
    mimeType:"video/mp4",storageBucket:"production-assets",storagePath:"production-assets/media/source.mp4"};
  const document = createInitialCompositionDocument({animatedDeck:null,assets:[{...asset,durationSeconds:10,
    hasAudio:false,publicUrl:null,timelineRole:"BROLL"}],plan:{accentColor:"#38BDF8",durationSeconds:10,title:"Frozen",subtitle:"Local"}});
  if (externalFontStylesheet) document.deckStyles = {css:"",fontUrls:["https://fonts.googleapis.com/css?family=Inter"]};
  const browser = {protocolVersion:"1.3",product:"Chrome/test",revision:"test",userAgent:"test",jsVersion:"test"};
  const execution = controlledRenderExecutionContractSchema.parse({policy:"CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend:"CONTROLLED",sdkVersion:"0.7.106",expectedBrowser:browser,
    files:Object.fromEntries(["node","producer","engine","runtime","browser","encoder","decoder"]
      .map(role => [role,executionIdentity ?? {sha256:"a".repeat(64),sizeBytes:10}]))});
  const documentHash = hashCompositionDocument(document);
  const contract = buildSnapshotConformanceContract({document,documentHash,assets:[{id:id(1),checksum:asset.checksum}],
    contractVersion:4,renderExecution:execution,renderProfile:{format:"mp4",fps:25,quality:"high",resolution:"1080p"}});
  const source = await buildConformanceReferenceSource({document,contract,assets:[asset],fontManifest:[],fontAssets:new Map()});
  const archive = new JSZip();
  for (const [path,bytes] of [["conformance-preview.html",source.previewHtml],["composition-document.json",source.documentJson],
    ["conformance-contract.json",source.contractJson],["conformance-reference.json",JSON.stringify(source.metadata)],
    ["font-manifest.json","[]"]]) archive.file(path,bytes);
  const archiveBytes = await archive.generateAsync({type:"nodebuffer"}), projectHash = sha256(archiveBytes);
  const projectPath = `composition-snapshots/${id(2)}/${id(3)}/${projectHash}.zip`;
  const row = {id:id(4),organization_id:id(2),composition_id:id(3),project_hash:projectHash,
    project_archive_size_bytes:archiveBytes.length,project_storage_bucket:"production-assets",project_storage_path:projectPath,
    manifest:{conformance_reference_version:1}};
  const supabase = {from: () => {const query = {select:() => query,eq:() => query,
    maybeSingle:async () => ({data:row,error:null})}; return query;},storage:{from:(bucket:string) => ({
      createSignedUrl:async (path:string) => ({error:null,data:{signedUrl:
        `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=ephemeral`}}),
    })}};
  const input = {supabase:supabase as never,supabaseUrl:"https://example.supabase.co",organizationId:id(2),revisionId:id(4),
    outputParentDirectory:parent,expected:{documentHash,projectHash,contract},
    animationRuntimeSha256:sha256(await readCompositionAnimationRuntime()),
    fetchImpl:(async (raw: string | URL | Request, options: RequestInit) => {
      assert.equal(options.redirect,"error");
      const zip = String(raw).includes(".zip?");
      return new Response(new Uint8Array(zip ? archiveBytes : media).buffer,{headers:{"content-type":zip ? "application/zip" : "video/mp4"}});
    }) as typeof fetch};
  return {input,row,parent,close:async () => {assert.deepEqual(await readdir(parent),[]); await rmdir(parent);}};
}

test("authorized render materialization compiles separate render entry with pinned local assets/runtime", async () => {
  const f = await fixture();
  try {
    const workspace = await materializeControlledRenderRevision(f.input);
    try {
      assert.equal(workspace.receipt.scope,"AUTHORIZED_SOURCE_RECOMPILED_NOT_ORIGINAL_RENDER_HTML");
      assert.equal(workspace.receipt.projectHash,f.input.expected.projectHash);
      const render = await readFile(workspace.entryPath,"utf8"), preview = await readFile(join(workspace.directory,"conformance-preview.html"),"utf8");
      assert.notEqual(render,preview);
      assert.ok(render.includes(`conformance-media/${id(1)}`));
      assert.ok(!render.includes("ephemeral"));
      assert.ok(render.indexOf(CONTROLLED_BROWSER_RESOURCE_POLICY) < render.indexOf("<style>"));
      assert.deepEqual(await readFile(join(workspace.directory,`conformance-media/${id(1)}`)),media);
      await workspace.assertUnchanged();
      await writeFile(workspace.entryPath,"changed input");
      await assert.rejects(workspace.assertUnchanged(),/CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    } finally {await workspace.cleanup();}
  } finally {await f.close();}
});

test("measurement plan preserves authorized native source and isolates executor mutations", async () => {
  const f = await fixture();
  try {
    const workspace = await materializeControlledRenderRevision(f.input);
    try {
      const plan = await workspace.readMeasurementPlan();
      assert.equal(plan.scope, "AUTHORIZED_MATERIALIZED_SOURCE_NOT_CAPTURE_EVIDENCE");
      assert.equal(plan.organizationId, f.input.organizationId);
      assert.equal(plan.revisionId, f.input.revisionId);
      assert.equal(plan.documentHash, hashCompositionDocument(plan.document));
      assert.deepEqual(plan.contract, f.input.expected.contract);
      assert.equal(plan.contractSha256, sha256(JSON.stringify(plan.contract)));
      assert.deepEqual(plan.fonts, []);
      assert.deepEqual(plan.files, workspace.receipt.files);
      const original = structuredClone(plan);
      plan.document.clips.length = 0;
      plan.fonts.length = 0;
      plan.files[0].sha256 = "f".repeat(64);
      plan.contract.thresholds.maxMeanAbsoluteError = 2;
      assert.deepEqual(await workspace.readMeasurementPlan(), original);
      await writeFile(join(workspace.directory, "font-manifest.json"), "[{}]");
      await assert.rejects(workspace.readMeasurementPlan(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    } finally {await workspace.cleanup();}
  } finally {await f.close();}
});

test("operational process reads host-pinned plan and rejects source or plan drift", async () => {
  const tools = join(process.cwd(), "apps/web/tools/controlled-hyperframes");
  // This test build lowers import() to require(); use a filesystem path, not a file URL.
  const {readMaterializedMeasurementPlan} = await import(join(tools, "materialized-measurement-plan.mjs"));
  const {MATERIALIZED_MEASUREMENT_REQUEST_POLICY, materializedExecutionDigest} = await import(join(tools, "materialized-producer-request.mjs"));
  const f = await fixture();
  try {
    const workspace = await materializeControlledRenderRevision(f.input);
    try {
      assert.equal(f.input.expected.contract.schemaVersion, 4);
      if (f.input.expected.contract.schemaVersion !== 4) throw new Error("fixture requires v4");
      const request = {policy: MATERIALIZED_MEASUREMENT_REQUEST_POLICY, directory: workspace.directory,
        organizationId: f.input.organizationId, revisionId: f.input.revisionId, ...f.input.expected,
        fps: f.input.expected.contract.canvas.fps,
        renderExecutionSha256: materializedExecutionDigest(f.input.expected.contract.renderExecution),
        measurementPlanSha256: workspace.measurementPlanReference.sha256,
        measurementPlanSizeBytes: workspace.measurementPlanReference.sizeBytes};
      const signal = new AbortController().signal;
      const read = await readMaterializedMeasurementPlan(request, signal);
      assert.deepEqual(read.plan, await workspace.readMeasurementPlan());
      read.plan.files[0].sha256 = "f".repeat(64);
      await read.assertUnchanged();
      await assert.rejects(readMaterializedMeasurementPlan({...request, revisionId: id(99)}, signal), /MEASUREMENT_PLAN_INVALID/);
      await assert.rejects(readMaterializedMeasurementPlan({...request, measurementPlanSha256: "f".repeat(64)}, signal), /MEASUREMENT_PLAN_INVALID/);
      await writeFile(workspace.entryPath, "changed render entry");
      await assert.rejects(read.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
      await assert.rejects(readMaterializedMeasurementPlan(request, signal), /MEASUREMENT_PLAN_INVALID/);
    } finally {await workspace.cleanup();}
  } finally {await f.close();}
});

test("host revalidates measurement plan bytes, not only its in-memory snapshot", async () => {
  const f = await fixture();
  try {
    const workspace = await materializeControlledRenderRevision(f.input);
    try {
      await writeFile(join(workspace.directory, "controlled-measurement-plan.json"), "{}");
      await assert.rejects(workspace.readMeasurementPlan(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
      await assert.rejects(workspace.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    } finally {await workspace.cleanup();}
  } finally {await f.close();}
});

test("controlled deck admission allows only exact materialized resources and local SVG fragments", () => {
  const document = policyDocument();
  const clip = document.clips[0];
  const deck = {...document,clips:[{...clip,source:{type:"DECK_SLIDE" as const,html:'<svg><use href="#shape" /></svg><img src="https://assets.example/image" style="background: url(\'conformance-media/image\')" />',classes:"slide",slideIndex:0}}]};
  assertControlledDeckSourcesLocal({document:deck,remoteToLocal:new Map([["https://assets.example/image","conformance-media/image"]]),
    localFiles:new Set(["conformance-media/image"])});
});

test("controlled deck admission rejects remote, encoded, active and transitive dependencies", () => {
  const document = policyDocument();
  for (const html of ['<img src="https://remote.example/a">','<img src="//remote.example/a">',
    '<img src="conformance-media/../secret">','<img src="conformance-media/%69mage">',
    '<img src="conformance-media/image" onerror="fetch(\'https://remote.example\')">',
    '<script>fetch("https://remote.example")</script>','<iframe srcdoc="hidden"></iframe>',
    '<div data-composition-src="https://remote.example/subcomposition"></div>',
    '<img srcset="https://remote.example/a 1x">','<style>@import "https://remote.example/style";</style>',
    '<p style="background: u\\72l(https://remote.example/a)">Remote</p>',
    '<style>p {background: image-set("https://remote.example/a" 1x)}</style>',
    '<svg><use href="https://remote.example/a#shape" /></svg>']) {
    const deck = {...document,clips:[{...document.clips[0],source:{type:"DECK_SLIDE" as const,html,classes:"slide",slideIndex:0}}]};
    assert.throws(() => assertControlledDeckSourcesLocal({document:deck,remoteToLocal:new Map(),localFiles:new Set(["conformance-media/image"])}),
      /CONTROLLED_RENDER_DECK_/);
  }
  assert.throws(() => assertControlledDeckSourcesLocal({document:{...document,deckStyles:{css:"",fontUrls:["https://fonts.googleapis.com/css?family=Inter"],sourceWidth:1920,sourceHeight:1080}},
    remoteToLocal:new Map(),localFiles:new Set()}), /STYLESHEET_NOT_MATERIALIZED/);
});

test("controlled browser policy is inserted ahead of resources and rejects unknown document shape", () => {
  const html = '<!doctype html>\n<html lang="es"><head><style>p{color:red}</style></head><body></body></html>';
  const protectedHtml = applyControlledBrowserResourcePolicy(html);
  assert.ok(protectedHtml.includes(`content="${CONTROLLED_BROWSER_RESOURCE_POLICY}"`));
  assert.ok(protectedHtml.indexOf("Content-Security-Policy") < protectedHtml.indexOf("<style>"));
  assert.throws(() => applyControlledBrowserResourcePolicy("<img src=remote>"), /DOCUMENT_SHAPE_INVALID/);
});

test("authorized materialization rejects frozen remote font stylesheets and cleans inputs", async () => {
  const f = await fixture(true);
  try {
    await assert.rejects(materializeControlledRenderRevision(f.input), /CONTROLLED_RENDER_DECK_STYLESHEET_NOT_MATERIALIZED/);
  } finally {await f.close();}
});

test("project, document, contract and runtime mismatch clean workspace without executing a renderer", async () => {
  for (const field of ["project","document","contract","runtime"] as const) {
    const f = await fixture();
    try {
      const input = {...f.input,expected:{...f.input.expected}};
      if (field === "project") input.expected.projectHash = "f".repeat(64);
      if (field === "document") input.expected.documentHash = "f".repeat(64);
      if (field === "runtime") input.animationRuntimeSha256 = "f".repeat(64);
      if (field === "contract") input.expected.contract = {...input.expected.contract,thresholds:{...input.expected.contract.thresholds,maxMeanAbsoluteError:2}};
      await assert.rejects(materializeControlledRenderRevision(input),/CONTROLLED_RENDER_(MATERIALIZATION|RUNTIME)_/);
    } finally {await f.close();}
  }
});

test("materialized supervisor adapter rejects output inside input workspace and cleans only owned inputs", async () => {
  const f = await fixture();
  try {
    let called = false;
    const renderer = createMaterializedControlledRenderer({storage:f.input,execute:async (descriptor,workspace) => {
      called = true; assert.equal(descriptor.projectHash,f.input.expected.projectHash);
      return {videoPath:join(workspace.directory,"output.mp4"),artifacts:{kind:"SINGLE_CONTRACT",input:{
        contract:descriptor.contract,documentHash:descriptor.documentHash,videoSha256:"d".repeat(64),observation:{}}}};
    }});
    await assert.rejects(renderer({...f.input.expected,organizationId:f.input.organizationId,revisionId:f.input.revisionId,executionId:id(5)}),
      /CONTROLLED_RENDER_OUTPUT_OWNERSHIP_INVALID/);
    assert.equal(called,true);
  } finally {await f.close();}
});

test("materialized supervisor adapter rechecks source after renderer before handing output to host", async () => {
  const f = await fixture();
  try {
    const renderer = createMaterializedControlledRenderer({storage:f.input,execute:async (descriptor,workspace) => {
      await writeFile(workspace.entryPath,"renderer mutation");
      return {videoPath:join(tmpdir(),"external-output.mp4"),artifacts:{kind:"SINGLE_CONTRACT",input:{
        contract:descriptor.contract,documentHash:descriptor.documentHash,videoSha256:"d".repeat(64),observation:{}}}};
    }});
    await assert.rejects(renderer({...f.input.expected,organizationId:f.input.organizationId,revisionId:f.input.revisionId,executionId:id(5)}),
      /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await f.close();}
});

test("executor receives the complete native measurement plan and a live file verifier", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const renderer = createMaterializedControlledRenderer({storage: f.input, execute: async (descriptor, workspace, _signal, controls) => {
      calls++;
      assert.ok(workspace.measurementPlan);
      assert.ok(controls);
      assert.deepEqual(structuredClone(workspace), workspace);
      assert.equal(workspace.measurementPlan.documentHash, descriptor.documentHash);
      assert.deepEqual(workspace.measurementPlan.contract, descriptor.contract);
      assert.equal(workspace.measurementPlan.documentHash, hashCompositionDocument(workspace.measurementPlan.document));
      assert.deepEqual(workspace.measurementPlan.files, workspace.receipt.files);
      await controls.verifyMeasurementFiles();
      // A received snapshot cannot alter materialization's authority or pins.
      workspace.measurementPlan.files[0].sha256 = "f".repeat(64);
      workspace.measurementPlan.document.clips.length = 0;
      await controls.verifyMeasurementFiles();
      await writeFile(join(workspace.directory, "composition-document.json"), "{}");
      await controls.verifyMeasurementFiles();
      throw new Error("must not reach after input mutation");
    }});
    await assert.rejects(renderer({...f.input.expected, organizationId: f.input.organizationId,
      revisionId: f.input.revisionId, executionId: id(5)}), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    assert.equal(calls, 1);
  } finally {await f.close();}
});

async function dependencyFixture() {
  const contents = "pinned tools";
  const f = await fixture(false, {sha256: sha256(contents), sizeBytes: Buffer.byteLength(contents)});
  const root = join(f.parent, "dependency-tools");
  await mkdir(root);
  const path = join(root, "tool.bin");
  await writeFile(path, contents);
  const reference = {rootId: "tools", path: "tool.bin"};
  const manifest: ControlledDependencyManifest = {policy: CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id, roots: ["tools"],
    files: [{...reference, sha256: sha256(contents), sizeBytes: Buffer.byteLength(contents)}], roles: {
      node: reference, producer: reference, engine: reference, runtime: reference,
      browser: reference, encoder: reference, decoder: reference}};
  const dependencyInventory = {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest), roots: {tools: root}};
  return {...f, path, dependencyInventory, close: async () => {await rm(path, {force: true}); await rmdir(root); await f.close();}};
}

test("dependency admission fails before materialization or execution, without fallback", async () => {
  const f = await dependencyFixture();
  try {
    let fetchCalls = 0, executeCalls = 0;
    const renderer = createMaterializedControlledRenderer({storage: {...f.input, fetchImpl: async () => {
      fetchCalls++; throw new Error("unexpected network");}},
    dependencyInventory: {...f.dependencyInventory, expectedManifestSha256: "f".repeat(64)},
    execute: async () => {executeCalls++; throw new Error("unexpected execution");}});
    await assert.rejects(renderer({...f.input.expected, organizationId: f.input.organizationId,
      revisionId: f.input.revisionId, executionId: id(5)}), /DEPENDENCY_MANIFEST_MISMATCH/);
    assert.equal(fetchCalls, 0); assert.equal(executeCalls, 0);
  } finally {await f.close();}
});

test("dependency mutation during materialization prevents executor invocation and cleans inputs", async () => {
  const f = await dependencyFixture();
  try {
    let executeCalls = 0;
    const renderer = createMaterializedControlledRenderer({storage: {...f.input, fetchImpl: (async (request, options) => {
      await writeFile(f.path, "changed before executor");
      return f.input.fetchImpl(request, options);
    }) as typeof fetch}, dependencyInventory: f.dependencyInventory,
    execute: async () => {executeCalls++; throw new Error("unexpected execution");}});
    await assert.rejects(renderer({...f.input.expected, organizationId: f.input.organizationId,
      revisionId: f.input.revisionId, executionId: id(5)}), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
    assert.equal(executeCalls, 0);
  } finally {await f.close();}
});

test("dependency mutation during execution rejects output before supervisor receives it", async () => {
  const f = await dependencyFixture();
  try {
    const renderer = createMaterializedControlledRenderer({storage: f.input, dependencyInventory: f.dependencyInventory,
      execute: async descriptor => {
        await writeFile(f.path, "changed during executor");
        return {videoPath: join(tmpdir(), "external-output.mp4"), artifacts: {kind: "SINGLE_CONTRACT", input: {
          contract: descriptor.contract, documentHash: descriptor.documentHash, videoSha256: "d".repeat(64), observation: {}}}};
      }});
    await assert.rejects(renderer({...f.input.expected, organizationId: f.input.organizationId,
      revisionId: f.input.revisionId, executionId: id(5)}), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await f.close();}
});

test("uncertain process termination preserves only owned workspace for investigation, never publishes output", async () => {
  const f = await fixture();
  let retainedDirectory: string | undefined;
  try {
    const renderer = createMaterializedControlledRenderer({storage: f.input, execute: async (_descriptor, workspace) => {
      retainedDirectory = workspace.directory;
      throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
    }});
    await assert.rejects(renderer({...f.input.expected, organizationId: f.input.organizationId,
      revisionId: f.input.revisionId, executionId: id(5)}), /EXECUTOR_TERMINATION_UNCONFIRMED/);
    assert.ok(retainedDirectory);
    assert.equal(dirname(retainedDirectory), f.parent);
    assert.ok((await readFile(join(retainedDirectory, "index.html"), "utf8")).includes("<!doctype html>"));
    assert.equal((await readdir(f.parent)).length, 1);
  } finally {
    // Test fixture only; production does not automatically erase quarantined inputs.
    if (retainedDirectory) {
      assert.equal(dirname(retainedDirectory), f.parent);
      await rm(retainedDirectory, {recursive: true, force: true});
    }
    await f.close();
  }
});
