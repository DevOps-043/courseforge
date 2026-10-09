import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";

const observations = new AsyncLocalStorage();
const reject = code => { throw new Error(`CONTROLLED_PRODUCER_OBSERVER_${code}`); };
function rejectObservation(context, code) {
  context.failure ??= new Error(`CONTROLLED_PRODUCER_OBSERVER_${code}`);
  throw context.failure;
}

function activeObservation() {
  const context = observations.getStore();
  if (context?.failure) throw context.failure;
  if (context?.closed) rejectObservation(context, "CLOSED");
  context?.signal.throwIfAborted();
  return context;
}

async function invoke(context, callback, payload) {
  try {
    await context.observer[callback](payload);
    activeObservation();
  } catch {
    context.failure ??= new Error("CONTROLLED_PRODUCER_OBSERVER_CALLBACK_FAILED");
    throw context.failure;
  }
}

/** Host callbacks are trusted code, not a sandbox or client-supplied scripts. */
export async function runObservedProducer(execute, job, signal, observer) {
  const config = job?.config;
  const profile = config?.producerConfig;
  if (!(signal instanceof AbortSignal) || typeof execute !== "function"
    || !observer || !["onSession", "onBeforeFrame", "onAfterFrame"].every(key => typeof observer[key] === "function"))
    reject("INPUT_INVALID");
  if ((observer.onEncode !== undefined || observer.onAfterAssemble !== undefined)
    && (typeof observer.onEncode !== "function" || typeof observer.onAfterAssemble !== "function")) reject("STAGE_CALLBACKS_INVALID");
  signal.throwIfAborted();
  if (config.workers !== 1 || config.useGpu !== false || config.hdrMode !== "force-sdr"
    || profile?.concurrency !== 1 || profile.enableBrowserPool !== false
    || profile.disableGpu !== true || profile.browserGpuMode !== "software"
    || profile.forceScreenshot !== true || profile.useDrawElement !== false
    || profile.enableDrawElementWorkerEncode !== false || profile.staticFrameDedup !== false)
    reject("PROFILE_INVALID");
  if (observer.onEncode && profile.enableStreamingEncode !== false) reject("PROFILE_INVALID");
  // Capture functions cannot leak observer state between concurrent jobs.
  const context = {signal, job, observer: Object.freeze({onSession: observer.onSession,
    onBeforeFrame: observer.onBeforeFrame, onAfterFrame: observer.onAfterFrame,
    onEncode: observer.onEncode, onAfterAssemble: observer.onAfterAssemble}), failure: undefined,
    encoding: undefined, assembling: false, assembled: false,
    sessions: new WeakSet(), pending: new Map(), frames: 0, closed: false};
  return observations.run(context, async () => {
    try {
      const result = await execute();
      activeObservation();
      if (context.pending.size !== 0) reject("FRAME_INCOMPLETE");
      if (context.frames === 0) reject("NO_FRAMES");
      if (context.observer.onEncode && (!context.encoding?.completed || !context.assembled)) rejectObservation(context, "STAGES_INCOMPLETE");
      return result;
    } catch (error) {
      if (context.failure) throw context.failure;
      signal.throwIfAborted();
      throw error;
    } finally {
      context.closed = true;
    }
  });
}

/** Trusted host encoder port only. Original capture/media/audio/assembly remain SDK-owned. */
export async function encodeObservedProducerStage(input) {
  const context = activeObservation();
  if (!context?.observer.onEncode) return undefined;
  const config = context.job.config;
  // createRenderJob normalizes fps to the SDK's rational representation.
  const fps = config.fps?.den === 1 ? config.fps.num : undefined;
  const frameCount = Math.ceil(context.job.duration * fps);
  if (input?.job !== context.job || input.abortSignal !== context.signal || context.encoding
    || context.pending.size || input.isPngSequence !== false || input.isGif !== false || input.needsAlpha !== false
    || config.format !== "mp4" || ![24, 25, 30, 60].includes(fps)
    || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount !== context.frames
    || ![input.width, input.height].every(value => Number.isSafeInteger(value) && value > 0)
    || typeof input.hasAudio !== "boolean" || typeof input.videoOnlyPath !== "string" || !input.videoOnlyPath
    || typeof input.outputPath !== "string" || !input.outputPath || input.outputPath === input.videoOnlyPath)
    rejectObservation(context, "ENCODE_INPUT_INVALID");
  const payload = Object.freeze({width: input.width, height: input.height, fps,
    frameCount, videoOnlyPath: input.videoOnlyPath, outputPath: input.outputPath,
    hasAudio: input.hasAudio, signal: context.signal});
  context.encoding = {payload, completed: false};
  try {
    const result = await context.observer.onEncode(payload);
    activeObservation();
    if (!result || !Number.isFinite(result.encodeMs) || result.encodeMs < 0
      || Object.keys(result).some(key => key !== "encodeMs")) rejectObservation(context, "ENCODE_RESULT_INVALID");
    context.encoding.completed = true;
    return Object.freeze({encodeMs: result.encodeMs});
  } catch {rejectObservation(context, "ENCODE_FAILED");}
}

/** Runs only after the original SDK mux/faststart succeeded, before SDK work-file disposal. */
export async function observeProducerAssembly(input) {
  const context = activeObservation();
  if (!context?.observer.onAfterAssemble) return;
  const encoding = context.encoding;
  if (!encoding?.completed || context.assembling || context.assembled || input?.job !== context.job || input.abortSignal !== context.signal
    || input.videoOnlyPath !== encoding.payload.videoOnlyPath || input.outputPath !== encoding.payload.outputPath
    || input.hasAudio !== encoding.payload.hasAudio) rejectObservation(context, "ASSEMBLY_INPUT_INVALID");
  context.assembling = true;
  await invoke(context, "onAfterAssemble", encoding.payload);
  context.assembled = true;
}

function assertSession(context, session) {
  if (context.closed || !context.sessions.has(session) || session.captureMode !== "screenshot"
    || session.staticFrames != null) rejectObservation(context, "SESSION_INVALID");
}

/** Called on the SDK's page before its first navigation, using its cached CDP session. */
export async function observeProducerSession(session, acquireCdp) {
  const context = activeObservation();
  if (!context) return;
  if (context.closed || !session?.page || typeof acquireCdp !== "function" || session.captureMode !== "screenshot") rejectObservation(context, "SESSION_INVALID");
  if (context.sessions.has(session)) return;
  let cdp;
  try { cdp = await acquireCdp(); }
  catch { rejectObservation(context, "SESSION_INVALID"); }
  activeObservation();
  if (!cdp) rejectObservation(context, "SESSION_INVALID");
  await invoke(context, "onSession", Object.freeze({session, cdp}));
  context.sessions.add(session);
}

/** Also guards the SDK's early-return dedup branch, before any frame preparation. */
export function guardProducerFrame(session) {
  const context = activeObservation();
  if (context) assertSession(context, session);
}

export async function observeProducerBeforeFrame(session, frameIndex, time, quantizedTime) {
  const context = activeObservation();
  if (!context) return;
  assertSession(context, session);
  if (context.pending.has(session) || !Number.isSafeInteger(frameIndex) || frameIndex < 0
    || ![time, quantizedTime].every(value => Number.isFinite(value) && value >= 0))
    rejectObservation(context, "FRAME_SEQUENCE_INVALID");
  context.pending.set(session, {frameIndex, time, quantizedTime});
  await invoke(context, "onBeforeFrame", Object.freeze({session, frameIndex, time, quantizedTime}));
}

export async function observeProducerAfterFrame(session, frameIndex, time, quantizedTime, buffer, prepareOriginalFrame) {
  const context = activeObservation();
  if (!context) return;
  assertSession(context, session);
  const pending = context.pending.get(session);
  if (!pending || pending.frameIndex !== frameIndex || pending.time !== time || pending.quantizedTime !== quantizedTime)
    rejectObservation(context, "FRAME_SEQUENCE_INVALID");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) rejectObservation(context, "FRAME_INVALID");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  let leased = true, preparing = false, prepared = false;
  const prepareFrame = typeof prepareOriginalFrame === "function" ? async (index, seconds, capture = false) => {
    if (context.closed) rejectObservation(context, "CLOSED");
    if (activeObservation() !== context) rejectObservation(context, "PREPARE_CONTEXT_INVALID");
    if (!leased || preparing || !Number.isSafeInteger(index) || index < 0 || index > frameIndex
      || !Number.isFinite(seconds) || seconds < 0 || seconds > time)
      rejectObservation(context, "PREPARE_REQUEST_INVALID");
    preparing = true;
    try {
      const result = await prepareOriginalFrame(index, seconds, capture);
      prepared = true;
      activeObservation();
      if (!leased || !Number.isFinite(result?.quantizedTime) || result.quantizedTime < 0 || result.quantizedTime > quantizedTime)
        rejectObservation(context, "PREPARE_RESULT_INVALID");
      if (capture && (!Buffer.isBuffer(result.buffer) || !result.buffer.length)) rejectObservation(context, "CAPTURE_INVALID");
      return Object.freeze({quantizedTime: result.quantizedTime, ...(capture ? {buffer: Buffer.from(result.buffer)} : {})});
    } catch {rejectObservation(context, "PREPARE_FAILED");}
    finally {preparing = false;}
  } : undefined;
  const captureFrame = prepareFrame ? (index, seconds) => prepareFrame(index, seconds, true) : undefined;
  try {
    await invoke(context, "onAfterFrame", Object.freeze({session, frameIndex, time, quantizedTime,
      sha256, buffer: Buffer.from(buffer), ...(prepareFrame ? {prepareFrame, captureFrame} : {})}));
    if (preparing) rejectObservation(context, "PREPARE_INCOMPLETE");
    if (prepared) {
      const restored = await prepareOriginalFrame(frameIndex, time);
      activeObservation();
      if (restored?.quantizedTime !== quantizedTime) rejectObservation(context, "RESTORE_MISMATCH");
    }
  } catch (error) {
    context.failure ??= new Error("CONTROLLED_PRODUCER_OBSERVER_PREPARE_FAILED");
    throw context.failure;
  } finally {leased = false;}
  context.frames += 1;
  context.pending.delete(session);
}
