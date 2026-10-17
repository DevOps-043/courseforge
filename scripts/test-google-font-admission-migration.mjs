import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimePath = process.env.GOOGLE_FONT_TEST_PGLITE_PATH
  || path.join(root, 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtimePath).href);
const candidateSql = await readFile(path.join(root, 'supabase/migrations/20261010210000_google_font_candidate_bundles.sql'), 'utf8');
const admissionSql = await readFile(path.join(root, 'supabase/migrations/20261010220000_google_font_native_admission.sql'), 'utf8');
const faceReadSql = await readFile(path.join(root, 'supabase/migrations/20261010230000_google_font_native_face_read.sql'), 'utf8');
const previousResourceSql = await readFile(path.join(root, 'supabase/migrations/20261006000000_html_snapshot_resource_validation.sql'), 'utf8');
const googleResourceSql = await readFile(path.join(root, 'supabase/migrations/20261011000000_google_font_html_resource_bindings.sql'), 'utf8');
const org = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002', font = '00000000-0000-4000-8000-000000000003';
const css = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700';

async function fixture() {
  const db = new PGlite();
  try {
    // Minimal relational prerequisites and fake object metadata, not real Storage.
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage; CREATE SCHEMA private;
      CREATE TABLE public.organizations(id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE public.organization_user_roles(organization_id uuid,user_id uuid,platform_role text);
      CREATE TABLE public.organization_slide_fonts(id uuid PRIMARY KEY,organization_id uuid,family text,source text,status text,css_url text);
      CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));
      INSERT INTO public.organizations VALUES('${org}',true);
      INSERT INTO public.profiles VALUES('${actor}',true);
      INSERT INTO public.organization_user_roles VALUES('${org}','${actor}','ADMIN');
      INSERT INTO public.organization_slide_fonts VALUES('${font}','${org}','Inter','google','READY','${css}');`);
    await db.exec(`ALTER TABLE public.organization_slide_fonts ADD checksum_sha256 text,ADD file_size_bytes bigint,
      ADD mime_type text,ADD storage_bucket text,ADD storage_path text;
      CREATE TABLE public.production_assets(id uuid,organization_id uuid,qa_status text,checksum text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_assets(production_asset_id uuid,organization_id uuid,draft_id uuid);
      CREATE TABLE public.organization_assembly_assets(id uuid,organization_id uuid,status text,checksum text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_branding(intro_asset_id uuid,outro_asset_id uuid,organization_id uuid,draft_id uuid);
      CREATE TABLE public.sound_effect_assets(id uuid,organization_id uuid,status text,checksum_sha256 text,file_size_bytes bigint,mime_type text,storage_bucket text,storage_path text);
      CREATE TABLE public.video_composition_draft_sound_effect_assets(sound_effect_asset_id uuid,organization_id uuid,draft_id uuid);`);
    await db.exec(previousResourceSql);
    const originalOid=(await db.query("SELECT 'private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb)'::regprocedure::oid AS oid")).rows[0].oid;
    await db.exec(candidateSql); await db.exec(admissionSql); await db.exec(faceReadSql); await db.exec(googleResourceSql);
    assert.equal((await db.query("SELECT 'private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb)'::regprocedure::oid AS oid")).rows[0].oid,originalOid);
    const files = [400,700].map(weight => ({ checksumSha256: String(weight === 400 ? 'a' : 'b').repeat(64), fileSizeBytes:48, mimeType:'font/woff2',embeddingCheck:'UNVERIFIED_COMPRESSED' }));
    const faces = files.map((file,index) => ({...file,style:'normal',weight:{minimum:index ? 700 : 400,maximum:index ? 700 : 400},unicodeRange:null}));
    const manifestText = JSON.stringify({format:'courseforge-google-font-candidate-bundle-v1',source:'google',family:'Inter',stylesheetChecksumSha256:'c'.repeat(64),files,faces});
    const hash = createHash('sha256').update(manifestText).digest('hex');
    for (const file of files) await db.query('INSERT INTO storage.objects VALUES($1,$2,$3)', ['organization-fonts',`${org}/google-candidates/${hash}/${file.checksumSha256}.woff2`,JSON.stringify({size:48,mimetype:'font/woff2'})]);
    const bundle = (await db.query('SELECT public.commit_google_font_candidate_bundle($1,$2,$3,$4,$5,$6,$7) AS receipt',[org,actor,font,'Inter',css,hash,manifestText])).rows[0].receipt;
    // Synthetic decoder evidence exercises SQL admission only; actual decoding
    // uses real TTF/WOFF2 in google-font-decoding.test.ts, never these 48-byte files.
    const proof = {format:'courseforge-decoded-google-font-bundle-v1',decoder:'fontkit-2.0.4',bundleId:bundle.bundleId,candidateSha256:hash,family:'Inter',files:files.map((file,index) => ({checksumSha256:file.checksumSha256,metadata:{family:'Inter',style:'normal',weight:index ? 700 : 400,axes:{},glyphCount:100,coverage:[[32,126]],decodedBytes:10000,embedding:'EDITABLE_TABLE_FLAGS'}}))};
    const commit = async (content=proof) => (await db.query('SELECT public.admit_decoded_google_font_bundle($1,$2,$3,$4,$5,$6) AS receipt',[org,actor,font,bundle.bundleId,hash,JSON.stringify(content)])).rows[0].receipt;
    const read = async (ids=null, pin={font,bundle:bundle.bundleId,hash}) =>
      (await db.query('SELECT public.read_ready_google_font_faces($1,$2,$3,$4,$5) AS faces',
        [org,ids,ids ? null : pin.font,ids ? null : pin.bundle,ids ? null : pin.hash])).rows[0].faces;
    return {db,proof,bundle,commit,read,hash};
  } catch(error) {await db.close();throw error;}
}

test('native admission compiles after candidates and cannot be written/executed by browser roles', async () => {
  const {db}=await fixture();
  try {
    const signature='public.admit_decoded_google_font_bundle(uuid,uuid,uuid,uuid,text,text)';
    const {rows}=await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS client,has_function_privilege('service_role',$1,'EXECUTE') AS server,
      has_table_privilege('service_role','public.organization_google_font_faces','INSERT') AS direct,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_google_font_admissions'::regclass) AS admission_rls,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_google_font_faces'::regclass) AS face_rls`,[signature]);
    assert.deepEqual(rows[0],{anon:false,client:false,server:true,direct:false,admission_rls:true,face_rls:true});
  } finally {await db.close();}
});

test('HTML guard retains its OID and uploaded/media delegate, and checks every Google face descriptor exactly', async () => {
  const {db,commit,read}=await fixture();
  try {
    await commit();
    const native=await read();
    const fonts=native.map(n=>({fontAssetId:n.id,family:n.family,checksumSha256:n.face.checksumSha256,
      fileSizeBytes:n.face.fileSizeBytes,mimeType:n.face.mimeType,
      googleFace:{...n.pin,admissionId:n.admissionId,style:n.face.style,weight:n.face.weight,unicodeRange:n.face.unicodeRange}}));
    const guard=async(bindings=fonts)=>db.query("SELECT private.html_snapshot_resource_bindings($1,$2,'[]'::jsonb,$3) AS result",[org,actor,JSON.stringify(bindings)]);
    assert.deepEqual((await guard()).rows[0].result,[]);
    for(const mismatch of ['weight','unicodeRange','hash','admission','extra']) {
      const changed=structuredClone(fonts);
      if(mismatch==='weight') changed[0].googleFace.weight.maximum=900;
      if(mismatch==='unicodeRange') changed[0].googleFace.unicodeRange='U+0400-04FF';
      if(mismatch==='hash') changed[0].googleFace.candidateSha256='d'.repeat(64);
      if(mismatch==='admission') changed[0].googleFace.admissionId=actor;
      if(mismatch==='extra') changed[0].googleFace.url='https://example.invalid';
      await assert.rejects(guard(changed),/HTML_SNAPSHOT_FONT_IDENTITY_CHANGED/);
    }
    const noPin=structuredClone(fonts);delete noPin[0].googleFace;
    await assert.rejects(guard(noPin),/HTML_SNAPSHOT_FONT_FORBIDDEN/);
    await db.exec("UPDATE public.organization_google_font_admissions SET status='REVOKED'");
    await assert.rejects(guard(),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
  } finally {await db.close();}
});

test('Google HTML extension does not weaken uploaded checks or expose private delegates to service/browser roles', async () => {
  const {db}=await fixture();
  try {
    const id='00000000-0000-4000-8000-000000000004';
    await db.query("INSERT INTO public.organization_slide_fonts(id,organization_id,family,source,status,checksum_sha256,file_size_bytes,mime_type,storage_bucket,storage_path) VALUES($1,$2,'Uploaded','uploaded','READY',$3,100,'font/ttf','organization-fonts','private/file.ttf')",[id,org,'d'.repeat(64)]);
    const fonts=[{fontAssetId:id,family:'Uploaded',checksumSha256:'d'.repeat(64),fileSizeBytes:100,mimeType:'font/ttf'}];
    const guard=async(bindings=fonts)=>db.query("SELECT private.html_snapshot_resource_bindings($1,$2,'[]'::jsonb,$3) AS result",[org,actor,JSON.stringify(bindings)]);
    assert.deepEqual((await guard()).rows[0].result,[]);
    await assert.rejects(guard([{...fonts[0],family:'Wrong'}]),/HTML_SNAPSHOT_FONT_IDENTITY_CHANGED/);
    await assert.rejects(guard([fonts[0],fonts[0]]),/HTML_SNAPSHOT_RESOURCES_INVALID/);
    await db.exec("UPDATE public.organization_slide_fonts SET status='REJECTED' WHERE source='uploaded'");
    await assert.rejects(guard(),/HTML_SNAPSHOT_FONT_IDENTITY_CHANGED/);
    for(const name of ['private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb)',
      'private.html_snapshot_uploaded_resource_bindings(uuid,uuid,jsonb,jsonb)','private.assert_google_snapshot_font_bindings(uuid,jsonb)'])
      for(const role of ['anon','authenticated','service_role'])
        assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,name])).rows[0].allowed,false);
  } finally {await db.close();}
});

test('server admission atomically freezes every variant and replay keeps their UUIDs without rewriting the candidate', async () => {
  const {db,commit,bundle}=await fixture();
  try {
    await db.exec('SET ROLE service_role');const first=await commit(),again=await commit();await db.exec('RESET ROLE');
    assert.equal(first.created,true);assert.equal(again.created,false);assert.deepEqual(first.faceIds,again.faceIds);
    assert.equal(first.faceIds.length,2);assert.equal(first.bundleId,bundle.bundleId);
    const {rows}=await db.query('SELECT face FROM public.organization_google_font_faces ORDER BY face');
    assert.deepEqual(rows.map(row=>row.face.weight.minimum).sort(),[400,700]);
    assert.equal((await db.query('SELECT status FROM public.organization_google_font_bundles')).rows[0].status,'PREPARED');
    assert.equal((await db.query('SELECT source FROM public.organization_slide_fonts')).rows[0].source,'google');
  } finally {await db.close();}
});

test('changed weight, absent proof, forbidden actor and missing object metadata cannot admit partial variants', async () => {
  const {db,commit,proof}=await fixture();
  try {
    const wrong=structuredClone(proof);wrong.files[1].metadata.weight=400;
    await assert.rejects(commit(wrong),/GOOGLE_FONT_ADMISSION_INVALID/);
    await assert.rejects(commit({...proof,files:proof.files.slice(0,1)}),/GOOGLE_FONT_ADMISSION_INVALID/);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='BUILDER'");
    await assert.rejects(commit(),/GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN/);
    await db.exec("UPDATE public.organization_user_roles SET platform_role='ADMIN';DELETE FROM storage.objects");
    await assert.rejects(commit(),/GOOGLE_FONT_BUNDLE_STORAGE_UNAVAILABLE/);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.organization_google_font_faces')).rows[0].count,0);
  } finally {await db.close();}
});

test('native metadata is immutable; a revoked admission cannot be reopened or replayed', async () => {
  const {db,commit}=await fixture();
  try {
    await commit();
    await assert.rejects(db.exec("UPDATE public.organization_google_font_faces SET family='Other'"),/GOOGLE_FONT_ADMISSION_IMMUTABLE/);
    await assert.rejects(db.exec("UPDATE public.organization_google_font_admissions SET created_at=now()+interval '1 day'"),/GOOGLE_FONT_ADMISSION_IMMUTABLE/);
    await db.exec("UPDATE public.organization_google_font_admissions SET status='REVOKED'");
    await assert.rejects(commit(),/GOOGLE_FONT_BUNDLE_REVOKED/);
    await assert.rejects(db.exec("UPDATE public.organization_google_font_admissions SET status='READY'"),/GOOGLE_FONT_ADMISSION_IMMUTABLE/);
  } finally {await db.close();}
});

test('exact native selection reads every pinned variant and never substitutes the original registry UUID', async () => {
  const {db,commit,read,bundle,hash}=await fixture();
  try {
    const receipt=await commit();
    await db.exec('SET ROLE service_role'); const all=await read(), subset=await read([receipt.faceIds[0]]); await db.exec('RESET ROLE');
    assert.equal(all.length,2);assert.deepEqual(all.map(face=>face.id),receipt.faceIds);
    assert.equal(subset.length,1);assert.equal(subset[0].id,receipt.faceIds[0]);
    for(const face of all) {
      assert.equal(face.organizationId,org);assert.equal(face.admissionId,receipt.admissionId);
      assert.deepEqual(face.pin,{fontId:font,bundleId:bundle.bundleId,candidateSha256:hash});
      assert.equal(face.family,'Inter');assert.notEqual(face.id,font);
    }
    await assert.rejects(read([font]),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
    await assert.rejects(read([receipt.faceIds[0],receipt.faceIds[0]]),/GOOGLE_FONT_NATIVE_SELECTION_INVALID/);
    await assert.rejects(read([]),/GOOGLE_FONT_NATIVE_SELECTION_INVALID/);
    await assert.rejects(read(null,{font,bundle:bundle.bundleId,hash:'d'.repeat(64)}),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
    const signature='public.read_ready_google_font_faces(uuid,uuid[],uuid,uuid,text)';
    assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed",[signature])).rows[0].allowed,false);
  } finally {await db.close();}
});

for(const revoked of ['admission','candidate','registration','organization','stylesheet','storage'])
  test(`native selection rejects ${revoked} changes rather than returning a partial or stale font`, async () => {
    const {db,commit,read}=await fixture();
    try {
      const receipt=await commit();
      const changes={admission:"UPDATE public.organization_google_font_admissions SET status='REVOKED'",
        candidate:"UPDATE public.organization_google_font_bundles SET status='REVOKED'",
        registration:"UPDATE public.organization_slide_fonts SET status='REJECTED'",
        organization:"UPDATE public.organizations SET is_active=false",
        stylesheet:"UPDATE public.organization_slide_fonts SET css_url='https://fonts.googleapis.com/css2?family=Other'",
        storage:"DELETE FROM storage.objects WHERE name LIKE '%/aaaaaaaa%.woff2'"};
      await db.exec(changes[revoked]);
      await assert.rejects(read(),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
      await assert.rejects(read(receipt.faceIds),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
    } finally {await db.close();}
  });

test('native face read enforces tenant and mutually exclusive selection arguments at SQL boundary', async () => {
  const {db,commit,bundle,hash}=await fixture();
  try {
    const receipt=await commit();
    const query=(orgId,ids,fontId,bundleId,sha)=>db.query('SELECT public.read_ready_google_font_faces($1,$2,$3,$4,$5)',[orgId,ids,fontId,bundleId,sha]);
    await assert.rejects(query(actor,receipt.faceIds,null,null,null),/GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
    await assert.rejects(query(org,receipt.faceIds,font,bundle.bundleId,hash),/GOOGLE_FONT_NATIVE_SELECTION_INVALID/);
    await assert.rejects(query(org,null,null,null,null),/GOOGLE_FONT_NATIVE_SELECTION_INVALID/);
    await assert.rejects(query(org,[null],null,null,null),/GOOGLE_FONT_NATIVE_SELECTION_INVALID/);
  } finally {await db.close();}
});
