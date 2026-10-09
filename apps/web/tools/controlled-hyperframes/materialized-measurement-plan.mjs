import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import {assertPlainDirectory, readPinnedPackageFile} from "./producer-extension-files.mjs";
import {MATERIALIZED_MEASUREMENT_PLAN_POLICY as policy} from "./materialized-measurement-plan-policy.mjs";
import {materializedExecutionDigest, MATERIALIZED_MEASUREMENT_REQUEST_POLICY} from "./materialized-producer-request.mjs";
const appRequire = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {compositionEditorDocumentSchema} = appRequire(`${compiled}composition-document.types.js`);
const {hashCompositionDocument} = appRequire(`${compiled}composition-document.service.js`);
const {compositionConformanceContractSchema} = appRequire(`${compiled}composition-preview-render-conformance.js`);
const {conformanceFontManifestSchema, buildDeclaredNativeFontUsageContract, conformanceFontPath} = appRequire(`${compiled}composition-conformance-font-bindings.js`);
const {pinConformanceFile, assertConformanceFileUnchanged} = appRequire(`${compiled}qa/composition-conformance-file-integrity.js`);
const {CONFORMANCE_MATERIALIZATION_LIMITS: limits} = appRequire(`${compiled}qa/composition-conformance-materialization.js`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort());

/** Reads only the fixed host-hashed plan; no module path, callback, URL or derived HTML plan. */
export async function readMaterializedMeasurementPlan(request, signal) {
  try {
    if (request.policy !== MATERIALIZED_MEASUREMENT_REQUEST_POLICY || !(signal instanceof AbortSignal)) throw new Error();
    signal.throwIfAborted();
    await assertPlainDirectory(request.directory);
    const path = join(request.directory, policy.path);
    const bytes = await readPinnedPackageFile(path, policy.maximumBytes);
    if (bytes.length !== request.measurementPlanSizeBytes || sha(bytes) !== request.measurementPlanSha256) throw new Error();
    const raw = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (!exact(raw, ["scope", "organizationId", "revisionId", "projectHash", "documentHash", "contractSha256", "document", "contract", "fonts", "files"])
      || raw.scope !== policy.scope || ["organizationId", "revisionId", "projectHash", "documentHash"].some(key => raw[key] !== request[key])) throw new Error();
    const document = compositionEditorDocumentSchema.parse(raw.document);
    const contract = compositionConformanceContractSchema.parse(raw.contract);
    const fonts = conformanceFontManifestSchema.parse(raw.fonts);
    if (hashCompositionDocument(document) !== request.documentHash || contract.documentHash !== request.documentHash
      || sha(JSON.stringify(contract)) !== raw.contractSha256 || contract.schemaVersion !== 4
      || contract.canvas.fps !== request.fps || materializedExecutionDigest(contract.renderExecution) !== request.renderExecutionSha256
      || contract.fontUsageContract && JSON.stringify(buildDeclaredNativeFontUsageContract(document, fonts)) !== JSON.stringify(contract.fontUsageContract)) throw new Error();
    buildDeclaredNativeFontUsageContract(document, fonts);
    if (!Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > limits.entries) throw new Error();
    const files = new Map();
    for (const file of raw.files) {
      signal.throwIfAborted();
      if (!exact(file, ["path", "sha256", "sizeBytes"]) || typeof file.path !== "string" || file.path.length > 512
        || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file.path) || file.path.split("/").some(part => [".", ".."].includes(part))
        || file.path === policy.path || files.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256)
        || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > limits.mediaBytes) throw new Error();
      await assertPlainDirectory(dirname(join(request.directory, file.path)));
      if ((await lstat(join(request.directory, file.path))).nlink !== 1) throw new Error();
      const pin = await pinConformanceFile(join(request.directory, file.path), file.sizeBytes, false, signal);
      if (pin.sha256 !== file.sha256 || pin.sizeBytes !== file.sizeBytes) throw new Error();
      files.set(file.path.toLowerCase(), {file, pin});
    }
    for (const required of ["composition-document.json", "conformance-contract.json", "font-manifest.json", "conformance-reference.json", "index.html", "assets/gsap.min.js"])
      if (!files.has(required)) throw new Error();
    for (const font of fonts) {
      const entry = files.get(conformanceFontPath(font));
      if (!entry || entry.pin.sha256 !== font.checksumSha256 || entry.pin.sizeBytes !== font.fileSizeBytes) throw new Error();
    }
    const assertUnchanged = async () => {
      signal.throwIfAborted();
      if (sha(await readPinnedPackageFile(path, policy.maximumBytes)) !== request.measurementPlanSha256) throw new Error();
      for (const {file, pin} of files.values()) {
        signal.throwIfAborted();
        await assertPlainDirectory(dirname(join(request.directory, file.path)));
        if ((await lstat(join(request.directory, file.path))).nlink !== 1) throw new Error();
        await assertConformanceFileUnchanged(join(request.directory, file.path), pin, file.sizeBytes, false, signal);
      }
      signal.throwIfAborted();
    };
    await assertUnchanged();
    return {plan: structuredClone({...raw, document, contract, fonts}), assertUnchanged};
  } catch {throw new Error("CONTROLLED_RENDER_MEASUREMENT_PLAN_INVALID");}
}
