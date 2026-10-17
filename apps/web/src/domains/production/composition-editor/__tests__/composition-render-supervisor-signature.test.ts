import assert from "node:assert/strict";
import test from "node:test";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {RENDER_SUPERVISOR_RECEIPT_POLICY, type RenderSupervisorBinding,
  renderSupervisorBindingSchema} from "../composition-render-supervisor-receipt";
import {signRenderSupervisorReceipt, verifyRenderSupervisorReceipt,
  type TrustedRenderSupervisorKey} from "../qa/composition-render-supervisor-signature";
import {buildSupervisedComparisonArtifacts} from "../qa/composition-supervised-comparison-artifacts";
import {buildControlledComparisonArtifacts} from "../qa/composition-controlled-comparison-artifacts";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {buildNativeConformanceCorpusCase} from "../qa/composition-native-conformance-corpus";
import {hashCompositionDocument} from "../composition-document.service";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pairs = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
const nowMilliseconds = 1_000_000;
function fixture() {
  const expectedBinding = renderSupervisorBindingSchema.parse({organizationId: id(1), requestId: id(2),
    revisionId: id(3), productionJobId: id(4), executionId: id(5), attempt: 1,
    artifactKind: "SINGLE_CONTRACT",
    challengeSha256: "a".repeat(64), documentHash: "b".repeat(64), projectHash: "c".repeat(64),
    contractSha256: "d".repeat(64), observationSha256: "e".repeat(64), comparisonReceiptSha256: "f".repeat(64),
    videoSha256: "0".repeat(64), sizeBytes: 40});
  const payload = {policy: RENDER_SUPERVISOR_RECEIPT_POLICY,
    scope: "SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE" as const,
    supervisorId: "supervisor_a", keyId: "key_a", issuedAtMilliseconds: nowMilliseconds - 1000,
    expiresAtMilliseconds: nowMilliseconds + 10_000, binding: expectedBinding};
  const key: TrustedRenderSupervisorKey = {supervisorId: payload.supervisorId, keyId: payload.keyId,
    organizationIds: [expectedBinding.organizationId], publicKey: pairs[0].publicKey,
    notBeforeMilliseconds: nowMilliseconds - 10_000, notAfterMilliseconds: nowMilliseconds + 100_000, revoked: false};
  return {payload, expectedBinding, trustedKeys: [key], nowMilliseconds,
    receipt: signRenderSupervisorReceipt(payload, pairs[0].privateKey)};
}

test("real Ed25519 receipt verifies against trusted tenant key without becoming conformity PASS", () => {
  const input = fixture();
  const result = verifyRenderSupervisorReceipt(input);
  assert.equal(result.status, "ISSUER_VERIFIED");
  assert.equal(result.scope, "SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE");
  assert.equal(result.receiptSha256, hash(input.receipt));
  assert.deepEqual(result.binding, input.expectedBinding);
  input.receipt.payload.binding.sizeBytes++;
  assert.equal(result.binding.sizeBytes, 40);
});

test("every signed binding field prevents tenant/job/output/challenge replay even with a valid new signature", () => {
  const input = fixture();
  for (const field of Object.keys(input.expectedBinding) as Array<keyof RenderSupervisorBinding>) {
    const binding = {...input.expectedBinding};
    if (field === "attempt") binding.attempt++;
    else if (field === "sizeBytes") binding.sizeBytes++;
    else if (field === "artifactKind") binding.artifactKind = "EVENT_BATCH_SET";
    else (binding[field] as string) = field.endsWith("Id") ? id(90) : "9".repeat(64);
    const receipt = signRenderSupervisorReceipt({...input.payload, binding}, pairs[0].privateKey);
    assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt}), /BINDING_MISMATCH/, field);
  }
});

test("tampered issuer, timestamps or signature and alternate public key fail closed", () => {
  const input = fixture();
  const changed = structuredClone(input.receipt); changed.payload.expiresAtMilliseconds++;
  assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt: changed}), /SIGNATURE_INVALID/);
  assert.throws(() => verifyRenderSupervisorReceipt({...input,
    trustedKeys: [{...input.trustedKeys[0], publicKey: pairs[1].publicKey}]}), /SIGNATURE_INVALID/);
  const wrongIssuer = signRenderSupervisorReceipt({...input.payload, supervisorId: "supervisor_b"}, pairs[0].privateKey);
  assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt: wrongIssuer}), /ISSUER_UNAUTHORIZED/);
  const wrongSignature = {...input.receipt, signature: "a".repeat(86)};
  assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt: wrongSignature}), /SIGNATURE_INVALID/);
});

test("trust is server-supplied: missing/duplicate/private/non-Ed25519 keys are rejected", () => {
  const input = fixture();
  const rsa = generateKeyPairSync("rsa", {modulusLength: 2048}).publicKey;
  for (const trustedKeys of [[], [...input.trustedKeys, ...input.trustedKeys],
    [{...input.trustedKeys[0], publicKey: pairs[0].privateKey}], [{...input.trustedKeys[0], publicKey: rsa}],
    [{...input.trustedKeys[0], organizationIds: [id(1), id(1)]}]])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, trustedKeys}), /TRUST_INVALID/);
  assert.throws(() => signRenderSupervisorReceipt(input.payload, pairs[0].publicKey), /SIGNING_KEY_INVALID/);
});

test("revocation and tenant authorization override a cryptographically valid signature", () => {
  const input = fixture();
  for (const key of [{...input.trustedKeys[0], revoked: true}, {...input.trustedKeys[0], organizationIds: [id(90)]},
    {...input.trustedKeys[0], keyId: "retired_key"}])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, trustedKeys: [key]}), /ISSUER_UNAUTHORIZED/);
  const rotated = {...input.trustedKeys[0], keyId: "key_b", publicKey: pairs[1].publicKey};
  const receipt = signRenderSupervisorReceipt({...input.payload, keyId: "key_b"}, pairs[1].privateKey);
  assert.equal(verifyRenderSupervisorReceipt({...input, receipt, trustedKeys: [...input.trustedKeys, rotated]}).keyId, "key_b");
});

test("expiry, future issue, key activation and validity boundaries are enforced", () => {
  const input = fixture();
  for (const now of [input.payload.expiresAtMilliseconds, input.payload.issuedAtMilliseconds - 30_001])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, nowMilliseconds: now}), /EXPIRED_INVALID/);
  for (const key of [{...input.trustedKeys[0], notBeforeMilliseconds: input.payload.issuedAtMilliseconds + 1},
    {...input.trustedKeys[0], notAfterMilliseconds: input.payload.expiresAtMilliseconds - 1}])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, trustedKeys: [key]}), /EXPIRED_INVALID/);
  for (const expiresAtMilliseconds of [input.payload.issuedAtMilliseconds, input.payload.issuedAtMilliseconds + 600_001])
    assert.throws(() => signRenderSupervisorReceipt({...input.payload, expiresAtMilliseconds}, pairs[0].privateKey), /RECEIPT_INVALID/);
  for (const now of [NaN, Infinity, -1, 1.1])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, nowMilliseconds: now}), /RECEIPT_INVALID/);
});

test("receipt-supplied keys, extensions, unknown policies and malformed signatures cannot grant authority", () => {
  const input = fixture();
  for (const receipt of [null, {...input.receipt, publicKey: "attacker"},
    {...input.receipt, payload: {...input.payload, keyUrl: "https://attacker.invalid"}},
    {...input.receipt, payload: {...input.payload, policy: "PASS"}}, {...input.receipt, signature: ""},
    {...input.receipt, signature: input.receipt.signature + "=="}])
    assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt}), /RECEIPT_INVALID/);
});

test("base64url alias of the same signature bytes is rejected as noncanonical", () => {
  const input = fixture();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const canonical = input.receipt.signature;
  const last = alphabet.indexOf(canonical.at(-1)!);
  const alias = canonical.slice(0, -1) + alphabet[last + 1];
  assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(canonical, "base64url"));
  assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt: {...input.receipt, signature: alias}}), /SIGNATURE_INVALID/);
});

test("signature bytes are domain-separated from an unrelated signature on the same JSON", () => {
  const input = fixture();
  const signature = sign(null, Buffer.from(JSON.stringify(input.receipt.payload)), pairs[0].privateKey).toString("base64url");
  assert.throws(() => verifyRenderSupervisorReceipt({...input, receipt: {...input.receipt, signature}}), /SIGNATURE_INVALID/);
});

function comparisonFixture() {
  const input = fixture();
  const {document} = buildNativeConformanceCorpusCase("geometry-rotation", 25);
  const browser = {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", expectedBrowser: browser,
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "a".repeat(64), sizeBytes: 10}]))});
  const documentHash = hashCompositionDocument(document);
  const contract = buildSnapshotConformanceContract({document, documentHash, assets: [], contractVersion: 4,
    renderExecution: execution, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const observation = {policy: execution.policy, documentHash, videoSha256: input.expectedBinding.videoSha256,
    files: execution.files, browserBefore: browser, browserAfter: browser};
  const artifacts = buildControlledComparisonArtifacts({contract, observation, documentHash,
    videoSha256: observation.videoSha256});
  const expectedBinding = {...input.expectedBinding, documentHash, contractSha256: hash(artifacts.contract),
    observationSha256: hash(artifacts.receipt.renderExecution), comparisonReceiptSha256: hash(artifacts.receipt)};
  const receipt = signRenderSupervisorReceipt({...input.payload, binding: expectedBinding}, pairs[0].privateKey);
  return {...input, contract, observation, documentHash, videoSha256: observation.videoSha256,
    expectedBinding, supervisorReceipt: receipt};
}

test("authenticated intake consumes exact contract/observation/receipt without removing pending attestation", () => {
  const input = comparisonFixture();
  const result = buildSupervisedComparisonArtifacts(input);
  assert.equal(result.provenance.status, "ISSUER_VERIFIED");
  assert.equal(result.execution.reason, "RENDER_EXECUTION_ATTESTATION_PENDING");
  assert.equal(result.execution.scope, "FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION");
  assert.equal(result.execution.status, "MATCH");
});

test("authenticated intake rejects changed obligations and observation despite a still-valid issuer receipt", () => {
  const input = comparisonFixture();
  const contract = structuredClone(input.contract); contract.thresholds.maxTemporalDriftFrames++;
  assert.throws(() => buildSupervisedComparisonArtifacts({...input, contract}), /COMPARISON_BINDING_MISMATCH/);
  const observation = structuredClone(input.observation); observation.files.encoder.sizeBytes++;
  assert.throws(() => buildSupervisedComparisonArtifacts({...input, observation}), /COMPARISON_BINDING_MISMATCH/);
  const expectedBinding = {...input.expectedBinding, comparisonReceiptSha256: "a".repeat(64)};
  assert.throws(() => buildSupervisedComparisonArtifacts({...input, expectedBinding}), /COMPARISON_RECEIPT_MISMATCH/);
  assert.throws(() => buildSupervisedComparisonArtifacts({...input, supervisorReceipt: undefined}), /RECEIPT_INVALID/);
});
