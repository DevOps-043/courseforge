import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const compiled = "../apps/web/dist/composition-worker/domains/production/composition-editor/qa/";

/** Called only after the explicit worker flag. The operator JSON is data, never executable code. */
export async function createConformanceWorkerExecutor({environment, supabase, supabaseUrl, integrity}) {
  const mode = environment.HYPERFRAMES_CONFORMANCE_EXECUTION_MODE ?? "legacy";
  const configPath = environment.HYPERFRAMES_CONFORMANCE_WINDOWS_CONFIG_PATH;
  const configSha256 = environment.HYPERFRAMES_CONFORMANCE_WINDOWS_CONFIG_SHA256;
  const options = {supabase, supabaseUrl,
    allowLongAudio: environment.HYPERFRAMES_CONFORMANCE_LONG_AUDIO_ENABLED === "true",
    capturePlaybackAudio: environment.HYPERFRAMES_CONFORMANCE_PLAYBACK_AUDIO_ENABLED === "true"};
  if (mode === "windows-reserved-v1") {
    if (process.platform !== "win32") throw new Error("CONFORMANCE_JOB_WINDOWS_PLATFORM_UNSUPPORTED");
    if (!configPath || !configSha256) throw new Error("CONFORMANCE_JOB_HOST_CONFIGURATION_REQUIRED_INVALID");
    const {loadWindowsConformanceHostConfiguration} = require(`${compiled}composition-windows-conformance-host-configuration.js`);
    const {createReservedConformanceWorkerHost} = require(`${compiled}composition-reserved-conformance-worker-host.js`);
    const {createWindowsReservedConformancePortResolver} = require(`${compiled}composition-windows-reserved-conformance-ports.js`);
    const {CompositionControlledExecutionFenceStore} = require(`${compiled}composition-controlled-execution-fence.js`);
    const {configuration, ffmpegPath} = await loadWindowsConformanceHostConfiguration({path: configPath, sha256: configSha256});
    const {measurementFence, enableSilentDurableReports, ...nativeConfiguration} = configuration;
    const resolveProcessPorts = createWindowsReservedConformancePortResolver({...nativeConfiguration,
      measurementFence: new CompositionControlledExecutionFenceStore(measurementFence.directory, measurementFence.hostId)});
    return createReservedConformanceWorkerHost({...options, ffmpegPath, enableSilentDurableReports, integrity, resolveProcessPorts});
  }
  if (mode !== "legacy" || configPath || configSha256) throw new Error("CONFORMANCE_JOB_EXECUTION_MODE_INVALID");
  const {executeConformanceJob} = require(`${compiled}composition-conformance-job-execution.js`);
  const {RenderInternals} = require("@remotion/renderer");
  const ffmpegPath = RenderInternals.getExecutablePath({binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg"});
  return (claim, signal) => executeConformanceJob({...options, ffmpegPath, claim, signal}, integrity);
}
