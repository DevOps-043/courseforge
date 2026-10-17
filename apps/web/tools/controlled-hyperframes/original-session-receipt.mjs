import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {ORIGINAL_SESSION_OBSERVER_POLICY, ORIGINAL_SESSION_FRAME_LIMIT} from "./original-session-observer.mjs";
import {materializedExecutionDigest, materializedProducerRequestDigest} from "./materialized-producer-request.mjs";
export const ORIGINAL_SESSION_RECEIPT_FILE = "original-session.json";
export const ORIGINAL_SESSION_RECEIPT_MAXIMUM_BYTES = 8192;
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {browserVersionSchema} = appRequire("./dist/composition-worker/domains/production/composition-editor/qa/composition-browser-identity.js");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort());
const fail = () => {throw new Error("CONTROLLED_RENDER_ORIGINAL_SESSION_RECEIPT_INVALID");};

/** Independent structural/binding check only. Cannot recompute the frame digest from video. */
export function validateOriginalSessionReceipt(raw, {request, videoPin, execution, frameCount}) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > ORIGINAL_SESSION_FRAME_LIMIT
    || materializedExecutionDigest(execution) !== request.renderExecutionSha256
    || !exact(raw, ["version", "scope", "requestSha256", "executionId", "documentHash", "projectHash", "video", "observations"])
    || raw.version !== 1 || raw.scope !== "CANDIDATE_ORIGINAL_SESSION_NOT_SUPERVISOR_ARTIFACT"
    || raw.requestSha256 !== materializedProducerRequestDigest(request)
    || ["executionId", "documentHash", "projectHash"].some(key => raw[key] !== request[key])
    || !exact(raw.video, ["sha256", "sizeBytes"]) || raw.video.sha256 !== videoPin.sha256 || raw.video.sizeBytes !== videoPin.sizeBytes
    || !exact(raw.observations, ["policy", "scope", "browserBefore", "browserAfter", "frameCount", "frameDigestSha256"])
    || raw.observations.policy !== ORIGINAL_SESSION_OBSERVER_POLICY
    || raw.observations.scope !== "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE"
    || raw.observations.frameCount !== frameCount || typeof raw.observations.frameDigestSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(raw.observations.frameDigestSha256)) fail();
  const expected = browserVersionSchema.safeParse(execution.expectedBrowser);
  if (!expected.success) fail();
  for (const key of ["browserBefore", "browserAfter"]) {
    const actual = browserVersionSchema.safeParse(raw.observations[key]);
    if (!actual.success || JSON.stringify(actual.data) !== JSON.stringify(expected.data)) fail();
  }
  return structuredClone(raw);
}
