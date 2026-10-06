import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {readHtmlSnapshotNativeMedia} from "../composition-html-editing-snapshot-media.server";
import {createHtmlSnapshotFontAcquirer} from "../composition-html-editing-snapshot-fonts.server";
import {createTransitionDocument} from "./composition-transition-test-fixtures";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {createCompositionNativeOverlay} from "../composition-native-overlay.factory";
import {NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT} from "../composition-document.types";
import {createPreparedHtmlArchiveFixture} from "./composition-html-editing-snapshot-archive-fixtures";
import {createHtmlEditingSnapshotHost} from "../composition-html-editing-snapshot-host.server";
import {htmlSnapshotIntentSchema} from "../composition-html-editing-snapshot-publication.contract";
import type {z} from "zod";
import {htmlEditingFixtureId as uuid,htmlEditingFixtureOtherId as other} from "./composition-html-editing-test-fixtures";

type Call = {table:string;filters:Array<[string,string,unknown]>;limit?:number;columns?:string};
function database(rows:Record<string,unknown[]>) {
  const calls:Call[] = [];let fail=false;
  const supabase = {from:(table:string) => {
    const call:Call={table,filters:[]};calls.push(call);
    const query = {select:(columns:string) => {call.columns=columns;return query;},
      eq:(column:string,value:unknown) => {call.filters.push(["eq",column,value]);return query;},
      in:(column:string,value:unknown) => {call.filters.push(["in",column,value]);return query;},
      limit:(limit:number) => {call.limit=limit;return query;},abortSignal:async (signal:AbortSignal) => {
        signal.throwIfAborted();const result=(rows[table] ?? []).filter(raw => {
          const row=raw as Record<string,unknown>;
          return call.filters.every(([method,column,value]) => method === "eq" ? row[column] === value : (value as unknown[]).includes(row[column]));
        }).map(raw => Object.fromEntries(call.columns!.split(",").map(column => [column,(raw as Record<string,unknown>)[column]])));
        return {data:result,error:fail ? {message:"private database error"} : null};
      }};return query;
  }};
  return {calls,supabase:supabase as never,setFailure:() => {fail=true;}};
}
function mediaFixture() {
  const document = createTransitionDocument();
  const ids = document.clips.map(clip => clip.source.type === "PRODUCTION_ASSET" ? clip.source.productionAssetId : "");
  const rows:Record<string,unknown[]> = {
    video_composition_draft_assets:ids.map(id => ({organization_id:uuid,draft_id:uuid,production_asset_id:id,source_reference:"CLIP"})),
    production_assets:ids.map(id => ({id,organization_id:uuid,checksum:"a".repeat(64),file_size_bytes:8,mime_type:"video/mp4",
      storage_bucket:"production-assets",storage_path:`media/${id}.mp4`,qa_status:"APPROVED",public_url:null})),
  };
  const db=database(rows);return {...db,rows,document,ids,organizationId:uuid,draftId:uuid};
}

test("native media acquisition uses bounded tenant/draft links before resource records", async () => {
  const f=mediaFixture();const result=await readHtmlSnapshotNativeMedia(f);
  assert.equal(result.assets.length,2);assert.equal(result.deckPublicUrls.size,0);
  assert.ok(f.calls.every(call => call.filters.some(([,column,value]) => column === "organization_id" && value === uuid) && call.limit));
  assert.ok(f.calls[0]!.filters.some(([,column,value]) => column === "draft_id" && value === uuid));
  assert.doesNotMatch(JSON.stringify(result.assets),/public_url|qa_status|organization_id/);
});
test("missing/duplicate links, revoked status and changed byte identity fail closed", async () => {
  for (const mutate of [
    (f:ReturnType<typeof mediaFixture>) => {f.rows.video_composition_draft_assets=[];},
    (f:ReturnType<typeof mediaFixture>) => {f.rows.video_composition_draft_assets!.push(f.rows.video_composition_draft_assets![0]);},
    (f:ReturnType<typeof mediaFixture>) => {Object.assign(f.rows.production_assets![0] as object,{qa_status:"REJECTED"});},
    (f:ReturnType<typeof mediaFixture>) => {Object.assign(f.rows.production_assets![0] as object,{checksum:"invalid"});},
    (f:ReturnType<typeof mediaFixture>) => {Object.assign(f.rows.production_assets![0] as object,{storage_path:"../escape"});},
    (f:ReturnType<typeof mediaFixture>) => {Object.assign(f.rows.production_assets![0] as object,{organization_id:other});},
  ]) {const f=mediaFixture();mutate(f);await assert.rejects(readHtmlSnapshotNativeMedia(f),/UNAVAILABLE_OR_FORBIDDEN/);}
});
test("branding and SFX require their own draft links and current APPROVED/READY state", async () => {
  const f=mediaFixture();f.document.clips[0]!.source={type:"ASSEMBLY_BRAND_ASSET",assemblyBrandAssetId:uuid,placement:"INTRO",hasAudio:true};
  f.document.clips[1]!.source={type:"SOUND_EFFECT_ASSET",soundEffectAssetId:other};
  f.document.clips[1]!.kind="AUDIO";
  const common={organization_id:uuid,checksum:"a".repeat(64),file_size_bytes:8,mime_type:"video/mp4",storage_bucket:"production-assets",storage_path:"brand/a.mp4"};
  f.rows.video_composition_draft_branding=[{organization_id:uuid,draft_id:uuid,intro_asset_id:uuid,outro_asset_id:null}];
  f.rows.organization_assembly_assets=[{...common,id:uuid,status:"APPROVED"}];
  f.rows.video_composition_draft_sound_effect_assets=[{organization_id:uuid,draft_id:uuid,sound_effect_asset_id:other}];
  f.rows.sound_effect_assets=[{...common,id:other,checksum_sha256:common.checksum,mime_type:"audio/mpeg",status:"READY"}];
  const result=await readHtmlSnapshotNativeMedia(f);assert.equal(result.assets.length,2);
  Object.assign(f.rows.organization_assembly_assets[0] as object,{status:"ARCHIVED"});
  await assert.rejects(readHtmlSnapshotNativeMedia(f));
});
test("deck dependencies are mapped only from bounded draft-owned records and ambiguous URL aliases reject", async () => {
  const f=mediaFixture();f.document.clips[0]!.source={type:"DECK_SLIDE",slideIndex:0,classes:"slide",html:'<img src="https://assets.example/a.png">'};
  f.document.clips[0]!.kind="DECK_SLIDE";
  Object.assign(f.rows.video_composition_draft_assets![0] as object,{source_reference:"DECK_DEPENDENCY"});
  Object.assign(f.rows.production_assets![0] as object,{mime_type:"image/png",public_url:"https://assets.example/a.png"});
  const result=await readHtmlSnapshotNativeMedia(f);assert.equal(result.deckPublicUrls.get(f.ids[0]!),"https://assets.example/a.png");
  Object.assign(f.rows.production_assets![1] as object,{public_url:"https://assets.example/a.png"});
  await assert.rejects(readHtmlSnapshotNativeMedia(f));
});
test("pre-abort does no media lookup and database failures expose no raw error", async () => {
  const f=mediaFixture();const controller=new AbortController();controller.abort();
  await assert.rejects(readHtmlSnapshotNativeMedia({...f,signal:controller.signal}));assert.equal(f.calls.length,0);
  f.setFailure();await assert.rejects(readHtmlSnapshotNativeMedia(f),/UNAVAILABLE_OR_FORBIDDEN/);
});

function fontFixture() {
  const document=createInitialCompositionDocument({animatedDeck:null,assets:[],sourceInsertionMode:"MANUAL",
    plan:{accentColor:"#38BDF8",durationSeconds:8,title:"Fonts",subtitle:"Pinned"}});
  const {clip,track}=createCompositionNativeOverlay({document,id:"native",kind:"TEXT",playheadSeconds:0});
  if (track) document.tracks.push(track);document.clips.push(clip);document.format=NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  if (clip.source.type !== "NATIVE_TEXT") throw new Error();
  clip.source.style.fontAssetId=uuid;clip.source.style.fontFamily="Pinned Font";
  const bytes=Buffer.from("synthetic font bytes, not decoded");
  const font={id:uuid,organization_id:uuid,family:"Pinned Font",source:"uploaded",status:"READY",checksum_sha256:createHash("sha256").update(bytes).digest("hex"),
    file_size_bytes:bytes.length,mime_type:"font/woff2",storage_bucket:"organization-fonts",storage_path:"tenant/font.woff2"};
  const db=database({organization_slide_fonts:[font]});const calls:Array<{url:string;options:RequestInit}>=[];
  const config={supabase:db.supabase,supabaseUrl:"https://project.supabase.co",serviceRoleKey:"server-test-key",fetchImpl:async (url:unknown,options?:RequestInit) => {
    calls.push({url:String(url),options:options!});return new Response(bytes,{headers:{"content-type":"font/woff2"}});
  }};
  return {...db,config,document,bytes,font,networkCalls:calls,organizationId:uuid};
}
test("font acquisition checks tenant READY identity then exact bounded bytes without signed URLs", async () => {
  const f=fontFixture();const fonts=await createHtmlSnapshotFontAcquirer(f.config)(f);
  assert.equal(fonts.length,1);assert.deepEqual(Buffer.from(fonts[0]!.bytes),f.bytes);assert.equal(f.networkCalls.length,1);
  assert.equal(f.networkCalls[0]!.url,"https://project.supabase.co/storage/v1/object/authenticated/organization-fonts/tenant/font.woff2");
  assert.equal(f.networkCalls[0]!.options.redirect,"error");assert.equal(f.networkCalls[0]!.options.credentials,"omit");
  assert.equal(f.calls[0]!.limit,2);assert.doesNotMatch(JSON.stringify(fonts[0]!.binding),/server-test-key|storage_path|https/);
});
test("unready/foreign font, family drift, unsafe path or wrong bucket prevents download", async () => {
  for (const change of [{status:"ARCHIVED"},{organization_id:other},{family:"Other Font"},{storage_path:"../font.woff2"},
    {storage_path:"a/%2e%2e/font.woff2"},{storage_bucket:"production-assets"},{source:"external"}]) {
    const f=fontFixture();Object.assign(f.font,change);await assert.rejects(createHtmlSnapshotFontAcquirer(f.config)(f));
    assert.equal(f.networkCalls.length,0);
  }
});
test("wrong font hash/size/MIME, range, encoding and lost response reject without retry", async () => {
  for (const response of [() => new Response("wrong",{headers:{"content-type":"font/woff2"}}),
    () => new Response(Buffer.alloc(freshBytes().length),{headers:{"content-type":"font/woff2"}}),
    () => new Response(freshBytes(),{headers:{"content-type":"application/octet-stream"}}),
    () => new Response(freshBytes(),{headers:{"content-type":"font/woff2","content-range":"bytes 0-7/8"}}),
    () => new Response(freshBytes(),{headers:{"content-type":"font/woff2","content-encoding":"gzip"}}),
    () => {throw new Error("private secret");}]) {
    const f=fontFixture();let calls=0;
    await assert.rejects(createHtmlSnapshotFontAcquirer({...f.config,fetchImpl:async () => {calls++;return response();}})(f),/UNAVAILABLE_OR_FORBIDDEN/);
    assert.equal(calls,1);
  }
  function freshBytes(){return Buffer.from("synthetic font bytes, not decoded");}
});
test("oversized font stream cancels immediately and pre-abort never downloads", async () => {
  const f=fontFixture();let cancelled=false;
  await assert.rejects(createHtmlSnapshotFontAcquirer({...f.config,fetchImpl:async () => new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(f.bytes.length+1));},cancel(){cancelled=true;}}),{headers:{"content-type":"font/woff2"}})})(f));
  assert.equal(cancelled,true);const controller=new AbortController();controller.abort();
  await assert.rejects(createHtmlSnapshotFontAcquirer(f.config)({...f,signal:controller.signal}));assert.equal(f.networkCalls.length,0);
});
test("insecure host configuration is rejected before accessing network", () => {
  const f=fontFixture();for (const supabaseUrl of ["invalid","http://project.supabase.co","https://project.supabase.co/other","https://user:password@project.supabase.co"])
    assert.throws(() => createHtmlSnapshotFontAcquirer({...f.config,supabaseUrl}));
});
test("authorized host derives native resources before intent/upload/commit and ignores caller resource manifests", async () => {
  const f=await createPreparedHtmlArchiveFixture();const events:string[]=[];
  const base=f.input.supabase as unknown as {rpc():unknown};
  const nativeRows=f.input.otherAssets.map(asset => ({id:asset.productionAssetId,organization_id:uuid,checksum:asset.checksum,
    file_size_bytes:asset.fileSizeBytes,mime_type:asset.mimeType,storage_bucket:asset.storageBucket,storage_path:asset.storagePath,
    qa_status:"APPROVED",public_url:null}));
  const db=database({production_assets:[{...f.image,public_url:null},...nativeRows],
    video_composition_draft_assets:[f.image,...nativeRows].map(asset => ({organization_id:uuid,draft_id:uuid,production_asset_id:asset.id,source_reference:"CLIP"}))});
  let recorded:z.infer<typeof htmlSnapshotIntentSchema> | undefined;let uploaded:Uint8Array | undefined;
  const supabase={from:(db.supabase as unknown as {from(table:string):unknown}).from,rpc:(name:string,args:Record<string,unknown>) => {
    if (name === "read_html_editing_compilation") {events.push("read");return base.rpc();}
    return {abortSignal:async () => {
      events.push(name);
      if (name === "record_html_editing_snapshot_intent") {recorded=htmlSnapshotIntentSchema.parse(args.p_intent);return {data:recorded,error:null};}
      assert.equal(name,"commit_html_editing_snapshot");
      return {data:{...recorded!.identity,revisionId:other,revisionNumber:1,activeRevisionId:other,disposition:"CREATED"},error:null};
    }};
  }};
  const host=createHtmlEditingSnapshotHost({supabase:supabase as never,supabaseUrl:"https://project.supabase.co",serviceRoleKey:"test-only-key",
    fetchImpl:async (_url,options) => {
      events.push(options!.method!);
      if (options!.method === "POST") {assert.ok(recorded);uploaded=new Uint8Array(options!.body as Uint8Array);return new Response(null,{status:201});}
      return new Response(uploaded! as BodyInit,{headers:{"content-type":"application/zip"}});
    }});
  // Extra JS fields cannot replace independently acquired resources.
  const result=await host.publishAuthorized({...f.input,otherAssets:[],compositionId:uuid,operationId:uuid,expectedActiveRevisionId:null} as
    Parameters<typeof host.publishAuthorized>[0]);
  assert.equal(result.revisionId,other);
  assert.ok(db.calls.some(call => call.table === "production_assets" && call.columns?.includes("public_url")));
  assert.ok(events.indexOf("read") < events.indexOf("record_html_editing_snapshot_intent"));
  assert.equal(events.filter(event => event === "POST").length,1);
  // Revoked native resource fails acquisition before any new intent/write.
  nativeRows[0]!.qa_status="REJECTED";events.length=0;
  await assert.rejects(host.publishAuthorized({...f.input,compositionId:uuid,operationId:uuid,expectedActiveRevisionId:null}));
  assert.deepEqual(events,["read"]);
});
