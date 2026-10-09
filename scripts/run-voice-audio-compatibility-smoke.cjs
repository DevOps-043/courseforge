// Local decoder/worker integration fixture. Supabase is faked; no remote data is changed.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { join, resolve } = require("node:path");
const { buildAudioProcessingJobInput } = require("../apps/web/.tmp/audio-processing-tests/domains/production/audio-processing/audio-processing-job.service.js");
const { processClaimedAudioJob } = require("../apps/api/.tmp/audio-processing-tests/features/audio-processing/audio-worker.js");
const { probeAudioSource } = require("../apps/api/.tmp/audio-processing-tests/features/audio-processing/audio-source-probe.js");
const run = promisify(execFile);
const fixtureDirectory = resolve(".tmp/voice-audio-compatibility");
const organizationId = "d4f0864e-508d-4ae3-9072-7ea2a0bf43e8";
const componentId = "4fbcd2af-f3ea-42cd-95fe-f822d201273d";
const sourceId = "f81d4fae-7dec-4a08-bd4b-5d2b2b6d0c44";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  await mkdir(fixtureDirectory, { recursive: true });
  const results = [];
  const formats = [
    { extension: "mp3", mime: "audio/mpeg", codec: "libmp3lame" },
    { extension: "wav", mime: "audio/wav", codec: "pcm_s16le" },
    { extension: "m4a", mime: "audio/mp4", codec: "aac" },
    { extension: "aac", mime: "audio/aac", codec: "aac" },
  ];
  for (const [index, format] of formats.entries()) {
    const sourcePath = join(fixtureDirectory, `source.${format.extension}`);
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6.375", "-c:a", format.codec, "-y", sourcePath], { timeout: 60_000, windowsHide: true });
    const bytes = await readFile(sourcePath);
    const objectPath = `heygen/source.${format.extension}`;
    const input = buildAudioProcessingJobInput({
      id: sourceId, asset_type: index === 0 ? "VOICE_AUDIO" : "SOURCE_MEDIA", metadata: { timeline_role: "VOICE" },
      checksum: sha256(bytes), file_size_bytes: bytes.length, material_component_id: componentId,
      organization_id: organizationId, mime_type: format.mime, qa_status: "READY_FOR_QA",
      storage_bucket: "production-assets", storage_path: `production-assets/${objectPath}`,
    });
    let completion;
    let outputBytes;
    let requestedPath;
    const uploads = new Map();
    const supabase = {
      storage: { from: (bucket) => ({
        download: async (path) => { requestedPath = path; assert.equal(bucket, "production-assets"); assert.equal(path, objectPath); return { data: new Blob([bytes]), error: null }; },
        upload: async (path, contents) => { uploads.set(path, contents); if (path.endsWith("processed.m4a")) outputBytes = contents; return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://fixture.invalid/${path}` } }),
      }) },
      rpc: async (name, parameters) => {
        assert.equal(name, "complete_audio_processing_job", `unexpected failure: ${parameters.p_error_message}`);
        completion = parameters;
        return { data: sourceId, error: null };
      },
    };
    const jobId = `18335cbe-52e0-4ef7-94e2-6a4e2cd4f29${index}`;
    await processClaimedAudioJob({
      // Exercise defensive legacy normalization in addition to canonical new jobs.
      job: { id: jobId, artifact_id: componentId, organization_id: organizationId,
        audio_processing_lease_token: "91ee2ece-eb0e-4273-a727-c8c731a83b89",
        input_snapshot: { ...input, source: { ...input.source, storagePath: `production-assets/${objectPath}` } } },
      supabase, supportedProfiles: ["voice-course-v1"],
    });
    assert.equal(requestedPath, objectPath);
    assert.ok(completion.p_metadata.audio_analysis.passed);
    assert.equal(completion.p_checksum, sha256(outputBytes));
    assert.ok(Number.isInteger(completion.p_duration_seconds), "legacy RPC retains integer seconds");
    assert.ok(Math.abs(completion.p_metadata.duration_milliseconds - 6375) < 100, "subsecond duration must be preserved");
    assert.ok(uploads.has(completion.p_metadata.waveform.storage_path));
    const outputPath = join(fixtureDirectory, `processed-from-${format.extension}.m4a`);
    await writeFile(outputPath, outputBytes);
    const duration = await probeAudioSource(outputPath);
    results.push({ format: format.extension, sourceClassification: index === 0 ? "VOICE_AUDIO" : "SOURCE_MEDIA",
      status: "passed", durationSeconds: duration, durationMilliseconds: completion.p_metadata.duration_milliseconds,
      integratedLufs: completion.p_metadata.audio_analysis.integrated_lufs, truePeakDbtp: completion.p_metadata.audio_analysis.true_peak_dbtp });
  }
  const corruptPath = join(fixtureDirectory, "corrupt.mp3");
  await writeFile(corruptPath, "<html>not audio</html>");
  await assert.rejects(() => probeAudioSource(corruptPath), /AUDIO_SOURCE_PROBE_FAILED/);
  const evidence = { fixture: "synthetic tone, no user data", ffmpegVersion: (await run("ffmpeg", ["-version"], { windowsHide: true })).stdout.split(/\r?\n/)[0],
    storage: "fake Supabase; real FFmpeg/ffprobe", results, corruptSource: "rejected" };
  await writeFile(join(fixtureDirectory, "evidence.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
