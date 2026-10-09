import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export const ORIGINAL_SESSION_OBSERVER_POLICY = "ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1";
export const ORIGINAL_SESSION_FRAME_LIMIT = 36000;
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {readCaptureBrowserIdentity, browserVersionSchema} = appRequire("./dist/composition-worker/domains/production/composition-editor/qa/composition-browser-identity.js");
const fail = code => {throw new Error(`CONTROLLED_RENDER_ORIGINAL_SESSION_${code}`);};

/** Fixed host observer, not custom code from configuration. Browser version is self-reported.
 * Frame digest is not font/color/pixel parity, OS attestation or supervisor evidence. */
export function createOriginalSessionObserver({expectedBrowser, signal}) {
  if (!(signal instanceof AbortSignal)) fail("SIGNAL_REQUIRED");
  expectedBrowser = browserVersionSchema.parse(expectedBrowser);
  const versions = new WeakMap();
  const digest = createHash("sha256");
  let originalSession, pending, before, after, frameCount = 0, finalized = false, failure;
  const active = () => {
    if (failure) throw failure;
    signal.throwIfAborted();
    if (finalized) fail("FINALIZED");
  };
  const guarded = callback => async payload => {
    try {active(); await callback(payload); active();}
    catch {failure ??= new Error("CONTROLLED_RENDER_ORIGINAL_SESSION_CAPTURE_FAILED"); throw failure;}
  };
  const checkVersion = async cdp => {
    const identity = await readCaptureBrowserIdentity(cdp);
    if (JSON.stringify(identity.version) !== JSON.stringify(expectedBrowser)) fail("BROWSER_MISMATCH");
    return identity.version;
  };
  const observer = Object.freeze({
    onSession: guarded(async ({session, cdp}) => {
      const version = await checkVersion(cdp);
      versions.set(session, {cdp, version});
    }),
    onBeforeFrame: guarded(async ({session, frameIndex, time, quantizedTime}) => {
      const identity = versions.get(session);
      if (!identity || pending || frameCount >= ORIGINAL_SESSION_FRAME_LIMIT || frameIndex !== frameCount
        || ![time, quantizedTime].every(value => Number.isFinite(value) && value >= 0)) fail("FRAME_SEQUENCE_INVALID");
      originalSession ??= session;
      if (originalSession !== session) fail("CAPTURE_SESSION_CHANGED");
      before ??= identity.version;
      pending = {session, frameIndex, time, quantizedTime};
    }),
    onAfterFrame: guarded(async ({session, frameIndex, time, quantizedTime, buffer, sha256}) => {
      if (!pending || pending.session !== session || pending.frameIndex !== frameIndex
        || pending.time !== time || pending.quantizedTime !== quantizedTime || !Buffer.isBuffer(buffer) || buffer.length === 0
        || createHash("sha256").update(buffer).digest("hex") !== sha256) fail("FRAME_BINDING_INVALID");
      // Read while the SDK's original CDP is still alive, before its cleanup disposes it.
      after = await checkVersion(versions.get(session).cdp);
      digest.update(`${JSON.stringify({frameIndex, time, quantizedTime, sha256})}\n`);
      frameCount++;
      pending = undefined;
    }),
  });
  return {observer, finalize() {
    active();
    if (pending || frameCount === 0 || !before || !after) fail("INCOMPLETE");
    finalized = true;
    return {policy: ORIGINAL_SESSION_OBSERVER_POLICY,
      scope: "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE",
      browserBefore: before, browserAfter: after, frameCount, frameDigestSha256: digest.digest("hex")};
  }};
}
