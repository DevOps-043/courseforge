// Real FFmpeg integration with synthetic local media and fake Storage/RPCs.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');
const { processClaimedAudioJob } = require('../apps/api/.tmp/audio-processing-tests/features/audio-processing/audio-worker.js');
const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const directory = resolve('.tmp/waveform-worker-smoke'); await mkdir(directory, { recursive: true });
  const tenant = '00000000-0000-4000-8000-000000000001';
  const component = '00000000-0000-4000-8000-000000000002';
  const asset = '00000000-0000-4000-8000-000000000003';
  const wav = Buffer.alloc(44 + 48000 * 4);
  wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(2,22); wav.writeUInt32LE(48000,24); wav.writeUInt32LE(48000*4,28);
  wav.writeUInt16LE(4,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  for(let frame=0;frame<48000;frame++){const sample=Math.round(32767*Math.sin(2*Math.PI*1000*frame/48000));wav.writeInt16LE(sample,44+frame*4);wav.writeInt16LE(-sample,46+frame*4);}
  const stereoPath = join(directory, 'stereo.wav'); await writeFile(stereoPath, wav);
  const rawPath = join(directory, 'black.rgb'); await writeFile(rawPath, Buffer.alloc(32*32*3*10));
  const videoInput = ['-f','rawvideo','-pixel_format','rgb24','-video_size','32x32','-framerate','10','-i',rawPath];
  const cases = [
    { name: 'stereo.wav', mime: 'audio/wav', args: null },
    { name: 'music.mp3', mime: 'audio/mpeg', args: ['-i',stereoPath,'-c:a','libmp3lame'] },
    { name: 'avatar.mp4', mime: 'video/mp4', args: [...videoInput,'-i',stereoPath,'-c:v','libx264','-c:a','aac','-shortest'] },
    { name: 'silent-video.mp4', mime: 'video/mp4', args: [...videoInput,'-c:v','libx264'], noAudio: true },
  ];
  for (const fixture of cases) {
    const path = join(directory, fixture.name);
    if(fixture.args) await run('ffmpeg', ['-hide_banner','-nostdin','-v','error',...fixture.args,'-y',path], { timeout: 30000, windowsHide: true });
    const bytes = await readFile(path); const checksum = hash(bytes); const uploads = new Map(); let completion;
    const source = { checksum, storage_bucket: 'production-assets', storage_path: fixture.name, mime_type: fixture.mime, qa_status: 'APPROVED' };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: source, error: null }) };
    const supabase = { from: () => query, storage: { from: () => ({
      download: async () => ({ data: new Blob([bytes]), error: null }),
      upload: async (path, bytes) => { uploads.set(path, Buffer.from(bytes)); return { error: null }; },
    }) }, rpc: async (name, args) => {
      if (name === 'fail_audio_processing_job') return { error: null };
      assert.equal(name, 'complete_audio_waveform_job'); completion = args; return { error: null };
    } };
    await processClaimedAudioJob({ job: { id: '00000000-0000-4000-8000-000000000004', organization_id: tenant, material_component_id: component,
      audio_processing_lease_token: '00000000-0000-4000-8000-000000000005', audio_processing_attempts: 1,
      input_snapshot: { profile: { id: 'waveform-analysis-v2', version: 2 }, source: { assetId: asset, checksum, storageBucket: 'production-assets', storagePath: fixture.name } } },
      supportedProfiles: ['waveform-analysis-v2'], supabase });
    assert.equal(hash(await readFile(path)), checksum);
    if (fixture.noAudio) { assert.equal(completion.p_manifest, null); assert.equal(uploads.size, 0); }
    else {
      assert.equal(uploads.size, 1); const manifest = completion.p_manifest;
      assert.equal(manifest.source_checksum, checksum);
      const derivativeBytes = uploads.get(manifest.storage_path); assert.equal(hash(derivativeBytes), manifest.checksum);
      const derivative = JSON.parse(derivativeBytes); assert.equal(derivative.contract_version, 2);
      if (fixture.name === 'stereo.wav') {
        assert.equal(derivative.sample_rate_hz, 48000); assert.equal(derivative.channels.length, 2);
        for (const channel of derivative.channels) assert.ok(Math.max(...channel.levels[0].max) > 0.99);
      }
    }
    console.log(`${fixture.name}: original unchanged, ${fixture.noAudio ? 'NO_AUDIO' : 'native-rate waveform'} passed`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
