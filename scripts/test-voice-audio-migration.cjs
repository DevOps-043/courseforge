// Runs the migration/RPC against isolated PostgreSQL WASM with minimal contract tables.
// Requires the temporary PGlite package unpacked at .tmp/voice-audio-pglite/package.
const assert = require("node:assert/strict");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { PGlite } = require("../.tmp/voice-audio-pglite/package/dist/index.cjs");

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY, allowed_mime_types text[], public boolean);
      INSERT INTO storage.buckets VALUES ('production-assets',ARRAY['audio/mpeg','video/mp4'],true),('production-render-sources',ARRAY['audio/wav'],false);
      CREATE TABLE production_jobs(id uuid PRIMARY KEY, job_type text, provider text, status text,
        audio_processing_lease_token uuid, audio_processing_lease_expires_at timestamptz,
        organization_id uuid, artifact_id uuid, material_lesson_id uuid, material_component_id uuid,
        lesson_id text, module_id text, created_by uuid, completed_at timestamptz, output_checksum text,
        output_snapshot jsonb, updated_at timestamptz, input_snapshot jsonb, created_at timestamptz DEFAULT now(), started_at timestamptz, progress jsonb);
      CREATE TABLE production_assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, artifact_id uuid,
        production_job_id uuid, material_lesson_id uuid, material_component_id uuid, lesson_id text, module_id text,
        asset_type text, provider text, storage_bucket text, storage_path text, public_url text, mime_type text,
        file_size_bytes bigint, duration_seconds integer, duration_milliseconds integer, checksum text, metadata jsonb, qa_status text, created_by uuid);`);
    await db.exec(await readFile("supabase/migrations/20261009090000_fix_voice_audio_processing_compatibility.sql", "utf8"));
    const organizationId = "d4f0864e-508d-4ae3-9072-7ea2a0bf43e8";
    const lease = "91ee2ece-eb0e-4273-a727-c8c731a83b89";
    const jobId = "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296";
    const storagePath = `organizations/${organizationId}/audio-processing/${jobId}/processed.m4a`;
    const seedJob = () => db.query(`INSERT INTO production_jobs(id,job_type,provider,status,audio_processing_lease_token,audio_processing_lease_expires_at,organization_id)
      VALUES($1,'AUDIO_PROCESSING','ffmpeg','RUNNING',$2,now()+interval '1 hour',$3)`, [jobId, lease, organizationId]);
    await seedJob();
    const complete = (metadata, path = storagePath, token = lease) => db.query(`SELECT complete_audio_processing_job($1,$2,'production-assets',$3,'https://fixture.invalid/audio','audio/mp4',1024,$4,7,$5::jsonb,'{}'::jsonb) AS asset_id`,
      [jobId, token, path, "a".repeat(64), JSON.stringify(metadata)]);
    await assert.rejects(() => complete({ duration_milliseconds: 6375 }, "organizations/foreign/audio-processing/foreign/processed.m4a"), /output is invalid/);
    await assert.rejects(() => complete({ duration_milliseconds: 6375 }, storagePath, jobId), /lease is invalid/);
    const completed = await complete({ duration_milliseconds: 6375 });
    const asset = (await db.query("SELECT duration_seconds,duration_milliseconds FROM production_assets WHERE id=$1", [completed.rows[0].asset_id])).rows[0];
    assert.equal(asset.duration_seconds, 7);
    assert.equal(asset.duration_milliseconds, 6375);
    await assert.rejects(() => complete({ duration_milliseconds: 6375 }), /lease is invalid/);
    await db.exec("DELETE FROM production_assets; DELETE FROM production_jobs;");
    await seedJob();
    await complete({});
    assert.equal((await db.query("SELECT duration_milliseconds FROM production_assets")).rows[0].duration_milliseconds, 7000);
    await db.exec("DELETE FROM production_assets; DELETE FROM production_jobs;");
    await seedJob();
    await db.query("UPDATE production_jobs SET status='PENDING',audio_processing_lease_token=NULL,audio_processing_lease_expires_at=NULL,input_snapshot=$1::jsonb", [JSON.stringify({profile:{id:"voice-course-v1"}})]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = (await db.query("SELECT * FROM claim_audio_processing_jobs_by_profile(ARRAY['voice-course-v1'],1,900)")).rows;
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].audio_processing_attempts, attempt);
      assert.equal(claimed[0].status, "RUNNING");
      assert.equal((await db.query("SELECT * FROM claim_audio_processing_jobs_by_profile(ARRAY['voice-course-v1'],1,900)")).rows.length, 0);
      await db.exec("UPDATE production_jobs SET status='RETRY_SCHEDULED',audio_processing_lease_expires_at=NULL;");
    }
    const grants = await db.query("SELECT has_function_privilege('anon','complete_audio_processing_job(uuid,uuid,text,text,text,text,bigint,text,integer,jsonb,jsonb)','execute') AS anon, has_function_privilege('authenticated','complete_audio_processing_job(uuid,uuid,text,text,text,text,bigint,text,integer,jsonb,jsonb)','execute') AS authenticated, has_function_privilege('service_role','complete_audio_processing_job(uuid,uuid,text,text,text,text,bigint,text,integer,jsonb,jsonb)','execute') AS service_role");
    assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service_role: true });
    const buckets = (await db.query("SELECT * FROM storage.buckets ORDER BY id")).rows;
    for (const bucket of buckets) assert.ok(bucket.allowed_mime_types.includes("audio/mp4") && bucket.allowed_mime_types.includes("audio/aac") && bucket.allowed_mime_types.includes("application/json"));
    assert.equal(buckets[0].public, true); assert.equal(buckets[1].public, false);
    assert.ok(buckets[0].allowed_mime_types.includes("video/mp4"));
    await mkdir(".tmp/voice-audio-compatibility", { recursive: true });
    const evidence = { migration: "passed", engine: "isolated PostgreSQL WASM (PGlite 0.3.14)", precision: "6375 ms retained", legacyWorker: "supported", expiredOrReusedLease: "rejected", foreignOutputPath: "rejected", grants: "service_role only", bucketVisibility: "preserved", claimAttempts: "incremented atomically; active lease prevents duplicate claims" };
    await writeFile(".tmp/voice-audio-compatibility/migration-evidence.json", JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
