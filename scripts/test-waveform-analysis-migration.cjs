// Isolated PostgreSQL checks; uses the already provisioned temporary PGlite runtime.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { PGlite } = require('../.tmp/voice-audio-pglite/package/dist/index.cjs');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE production_jobs(id uuid PRIMARY KEY, job_type text, provider text, status text,
        organization_id uuid, material_component_id uuid, input_snapshot jsonb,
        audio_processing_lease_token uuid, audio_processing_lease_expires_at timestamptz,
        audio_processing_attempts integer DEFAULT 0, started_at timestamptz, created_at timestamptz DEFAULT now(),
        completed_at timestamptz, failed_at timestamptz, updated_at timestamptz, output_snapshot jsonb,
        provider_error jsonb, progress jsonb);
      CREATE TABLE production_assets(id uuid PRIMARY KEY, organization_id uuid, material_component_id uuid,
        checksum text, qa_status text, metadata jsonb, storage_path text);
    `);
    await db.exec(await readFile('supabase/migrations/20261013120000_complete_audio_waveform_analysis.sql', 'utf8'));
    const tenant = '00000000-0000-4000-8000-000000000001';
    const component = '00000000-0000-4000-8000-000000000002';
    const asset = '00000000-0000-4000-8000-000000000003';
    const jobId = '00000000-0000-4000-8000-000000000004';
    const checksum = 'a'.repeat(64);
    await db.query(`INSERT INTO production_assets VALUES ($1,$2,$3,$4,'APPROVED','{"retained":true}','original.mp4')`, [asset, tenant, component, checksum]);
    const seedJob = async () => {
      await db.exec('DELETE FROM production_jobs');
      await db.query(`INSERT INTO production_jobs(id,job_type,provider,status,organization_id,material_component_id,input_snapshot)
        VALUES ($1,'AUDIO_PROCESSING','ffmpeg','PENDING',$2,$3,$4::jsonb)`, [jobId, tenant, component,
        JSON.stringify({ profile: { id: 'waveform-analysis-v2', version: 2 }, source: { assetId: asset, checksum } })]);
    };
    const claim = async () => (await db.query(`SELECT * FROM claim_audio_processing_jobs_by_profile(ARRAY['waveform-analysis-v2'],1,900)`)).rows;
    await seedJob();
    assert.equal((await db.query(`SELECT * FROM claim_audio_processing_jobs_by_profile(ARRAY['voice-course-v1'],1,900)`)).rows.length, 0);
    const first = (await claim())[0]; assert.equal(first.audio_processing_attempts, 1);
    assert.equal((await claim()).length, 0);
    const manifest = { contract_version: 2, source_checksum: checksum, checksum: 'b'.repeat(64),
      storage_bucket: 'production-assets', storage_path: `organizations/${tenant}/audio-analysis/${'b'.repeat(64)}/waveform-v2.json`,
      duration_seconds: 1, sample_rate_hz: 48000, level_count: 1, channel_count: 2 };
    const complete = (token, value = manifest) => db.query('SELECT complete_audio_waveform_job($1,$2,$3::jsonb)', [jobId, token, value === null ? null : JSON.stringify(value)]);
    await assert.rejects(complete(asset), /lease/);
    await assert.rejects(complete(first.audio_processing_lease_token, { ...manifest, storage_path: 'organizations/foreign/file.json' }), /manifest/);
    await db.query('UPDATE production_assets SET checksum=$1', ['c'.repeat(64)]);
    await assert.rejects(complete(first.audio_processing_lease_token), /source changed/);
    await db.query('UPDATE production_assets SET checksum=$1', [checksum]);
    await complete(first.audio_processing_lease_token);
    const stored = (await db.query('SELECT * FROM production_assets')).rows;
    assert.equal(stored.length, 1); assert.equal(stored[0].storage_path, 'original.mp4');
    assert.equal(stored[0].metadata.retained, true); assert.equal(stored[0].metadata.waveform_analysis.status, 'READY');
    await assert.rejects(complete(first.audio_processing_lease_token), /lease/);
    await seedJob();
    const second = (await claim())[0];
    await complete(second.audio_processing_lease_token, null);
    assert.equal((await db.query('SELECT metadata FROM production_assets')).rows[0].metadata.waveform_analysis.status, 'NO_AUDIO');
    await seedJob(); const crashed = (await claim())[0];
    await db.exec("UPDATE production_jobs SET audio_processing_lease_expires_at=now()-interval '1 second'");
    const recovered = (await claim())[0];
    assert.equal(recovered.audio_processing_attempts, 2);
    assert.notEqual(recovered.audio_processing_lease_token, crashed.audio_processing_lease_token);
    await assert.rejects(complete(crashed.audio_processing_lease_token), /lease/);
    await db.exec("UPDATE production_jobs SET audio_processing_attempts=3,audio_processing_lease_expires_at=now()-interval '1 second'");
    assert.equal((await claim()).length, 0);
    assert.equal((await db.query('SELECT status FROM production_jobs')).rows[0].status, 'FAILED');
    const grants = (await db.query(`SELECT has_function_privilege('anon','complete_audio_waveform_job(uuid,uuid,jsonb)','execute') AS anon,
      has_function_privilege('authenticated','complete_audio_waveform_job(uuid,uuid,jsonb)','execute') AS authenticated,
      has_function_privilege('service_role','complete_audio_waveform_job(uuid,uuid,jsonb)','execute') AS service`)).rows[0];
    assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
    console.log('Waveform SQL: profile routing, leases, stale source, foreign path, atomic metadata-only completion, no audio, crash recovery and grants passed.');
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
