import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {createControlledProcessEnvironment} from "./composition-controlled-process-environment";

export type PcmDecoderProcess = { stdout: Readable; stderr: Readable;
  once: (event: string, listener: (...arguments_: any[]) => void) => unknown;
  kill: (signal?: NodeJS.Signals) => boolean };
const launchDecoder = (binary: string, arguments_: string[]): PcmDecoderProcess => spawn(binary, arguments_, {
  stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
  env: createControlledProcessEnvironment(),
});

/** Trusted binary, argv only; drains stderr without persisting it, enforces bytes and a whole-process deadline. */
export async function consumeDecodedPcm(params: { binary: string; arguments: string[]; maximumBytes: number;
  timeoutMilliseconds: number; consume: (bytes: Uint8Array) => void | Promise<void>; signal?: AbortSignal }, launch = launchDecoder) {
  assertConformanceJobActive(params.signal);
  if (!Number.isSafeInteger(params.maximumBytes) || params.maximumBytes <= 0
    || !Number.isFinite(params.timeoutMilliseconds) || params.timeoutMilliseconds <= 0) throw new Error("AUDIO_TIMING_DECODE_INPUT_INVALID");
  const child = launch(params.binary, params.arguments);
  let settle!: (result: { code: number | null; error?: boolean }) => void;
  const completion = new Promise<{ code: number | null; error?: boolean }>((resolve) => {
    settle = resolve;
    child.once("error", () => { child.stdout.destroy(new Error("AUDIO_TIMING_DECODE_FAILED")); resolve({ code: null, error: true }); });
    child.once("close", (code: number | null) => resolve({ code }));
  });
  child.stderr.resume();
  const cancel = () => {
    child.kill("SIGKILL"); child.stdout.destroy(new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED"));
    settle({code: null, error: true});
  };
  params.signal?.addEventListener("abort", cancel, {once: true});
  if (params.signal?.aborted) cancel();
  child.stderr.on("error", () => {
    child.stdout.destroy(new Error("AUDIO_TIMING_DECODE_FAILED")); settle({ code: null, error: true }); child.kill("SIGKILL");
  });
  let timedOut = false, receivedBytes = 0;
  const timer = setTimeout(() => {
    timedOut = true; child.kill("SIGKILL"); child.stdout.destroy(new Error("AUDIO_TIMING_DECODE_TIMEOUT"));
    settle({ code: null, error: true });
  }, params.timeoutMilliseconds);
  try {
    for await (const chunk of child.stdout) {
      assertConformanceJobActive(params.signal);
      const bytes = chunk as Buffer;
      receivedBytes += bytes.length;
      if (receivedBytes > params.maximumBytes) throw new Error("AUDIO_TIMING_PCM_INVALID");
      await params.consume(bytes);
      assertConformanceJobActive(params.signal);
    }
    const result = await completion;
    assertConformanceJobActive(params.signal);
    if (timedOut) throw new Error("AUDIO_TIMING_DECODE_TIMEOUT");
    if (result.error || result.code !== 0 || !receivedBytes) throw new Error("AUDIO_TIMING_DECODE_FAILED");
  } catch (error) {
    child.kill("SIGKILL");
    assertConformanceJobActive(params.signal);
    if (timedOut) throw new Error("AUDIO_TIMING_DECODE_TIMEOUT");
    throw error;
  }
  finally {clearTimeout(timer); params.signal?.removeEventListener("abort", cancel);}
}
