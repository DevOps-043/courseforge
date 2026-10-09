import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSITION_AGENT_INTEGRATION_LIMITS, CompositionAgentIntegrationContractError,
  compositionAgentProposalBindingSchema, parseCompositionAgentBoundProposal,
  parseCompositionAgentProposalConsent, parseCompositionAgentProposalReceipt,
} from "../composition-agent-integration.contract";
import { COMPOSITION_AGENT_PROPOSAL_TTL_MS } from "../composition-agent-proposal-store.service";
import { simulateCompositionAgentPlan } from "../composition-agent-plan.service";
import { AGENT_TEST_NOW, AGENT_TEST_PROPOSAL_ID, compositionAgentFixture } from "./composition-agent-test-fixture";

function fixture() {
  const context = compositionAgentFixture();
  const input = {
    baseRevision: context.scope.revision, baseDocumentHash: context.scope.documentHash,
    summary: "Ajustará opacidad del video", steps: [{ id: "opacity", dependsOn: [], summary: "Reducirá opacidad", operations: [{ type: "clip.layout", clipId: context.clip.id, layout: { opacity: 0.7 } }] }],
  };
  const simulation = simulateCompositionAgentPlan({ ...context, input, proposalId: AGENT_TEST_PROPOSAL_ID });
  const binding = compositionAgentProposalBindingSchema.parse({
    kind: "COMPOSITION_AGENT_PROPOSAL_BINDING", schemaVersion: 1, digestFormat: "SORTED_JSON_UTF8_V1",
    proposalId: AGENT_TEST_PROPOSAL_ID, documentId: context.scope.documentId,
    organizationId: context.scope.organizationId, ownerUserId: context.scope.userId,
    baseRevision: context.scope.revision, baseDocumentHash: context.scope.documentHash,
    candidateDocumentHash: simulation.candidateDocumentHash,
    policy: { id: "composition-agent", version: 1, sha256: "a".repeat(64) },
    model: { provider: "gemini", id: "test-model" },
    envelopeSha256: "b".repeat(64), planSha256: "c".repeat(64),
    issuedAt: new Date(AGENT_TEST_NOW).toISOString(), expiresAt: new Date(AGENT_TEST_NOW + COMPOSITION_AGENT_PROPOSAL_TTL_MS).toISOString(),
  });
  const record = { binding, bindingSha256: "d".repeat(64), envelope: simulation.proposal, plan: input };
  const consent = { schemaVersion: 1, bindingSha256: record.bindingSha256, confirmed: true, reinforcedConfirmation: false };
  const receipt = {
    kind: "COMPOSITION_AGENT_APPLY_RECEIPT", schemaVersion: 1, proposalId: binding.proposalId,
    documentId: binding.documentId, organizationId: binding.organizationId, bindingSha256: record.bindingSha256,
    outcome: "APPLIED", applied: { revision: binding.baseRevision + 1, documentHash: binding.candidateDocumentHash }, undone: null,
  };
  return { record, consent, receipt, expected: { binding, bindingSha256: record.bindingSha256 } };
}
const contractCode = (code: string) => (error: unknown) => error instanceof CompositionAgentIntegrationContractError && error.code === code;

test("host DTO reuses simulated envelope V2, ordered plan and current TTL without writes/network", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Contract decoder must not call a provider"); });
  const f = fixture();
  const before = structuredClone(f.record);
  assert.equal(COMPOSITION_AGENT_INTEGRATION_LIMITS.maxTtlMs, COMPOSITION_AGENT_PROPOSAL_TTL_MS);
  assert.deepEqual(parseCompositionAgentBoundProposal(f.record), f.record);
  assert.deepEqual(f.record, before);
  assert.equal(fetch.mock.callCount(), 0);
});

test("binding rejects invalid dates, inverted/empty/overlong TTL and unknown versions", () => {
  const { record } = fixture();
  for (const binding of [
    { ...record.binding, expiresAt: "not-a-date" },
    { ...record.binding, issuedAt: "2026-02-30T00:00:00.000Z" },
    { ...record.binding, expiresAt: record.binding.issuedAt },
    { ...record.binding, expiresAt: new Date(AGENT_TEST_NOW - 1).toISOString() },
    { ...record.binding, expiresAt: new Date(AGENT_TEST_NOW + COMPOSITION_AGENT_PROPOSAL_TTL_MS + 1).toISOString() },
    { ...record.binding, schemaVersion: 2 },
    { ...record.binding, digestFormat: "unknown" },
    { ...record.binding, baseRevision: 0 },
    { ...record.binding, candidateDocumentHash: record.binding.baseDocumentHash },
  ]) assert.throws(() => parseCompositionAgentBoundProposal({ ...record, binding }));
});

test("record rejects mismatched proposal/base and failed semantic validation metadata", () => {
  const { record } = fixture();
  for (const envelope of [
    { ...record.envelope, proposalId: "00000000-0000-4000-8000-000000000088" },
    { ...record.envelope, baseDocumentHash: "e".repeat(64) },
    { ...record.envelope, validation: { passed: false, issues: [] } },
    { ...record.envelope, validation: { passed: true, issues: [{ code: "ERROR", message: "Rejected", severity: "ERROR" }] } },
  ]) assert.throws(() => parseCompositionAgentBoundProposal({ ...record, envelope }));
});

test("record cannot widen operation policy even with favorable model/risk metadata", () => {
  const { record } = fixture();
  const operation = { type: "clip.remove", clipId: record.envelope.operations[0] && "clipId" in record.envelope.operations[0] ? record.envelope.operations[0].clipId : "video" };
  const forged = { ...record, plan: null, binding: { ...record.binding, planSha256: null }, envelope: { ...record.envelope, operations: [operation] } };
  assert.throws(() => parseCompositionAgentBoundProposal(forged));
});

test("record rejects absent plan digest, mismatched revision and reordered/different operations", () => {
  const { record } = fixture();
  for (const modified of [
    { ...record, plan: null },
    { ...record, binding: { ...record.binding, planSha256: null } },
    { ...record, plan: { ...record.plan, baseRevision: record.binding.baseRevision + 1 } },
    { ...record, plan: { ...record.plan, steps: [{ ...record.plan.steps[0], operations: [{ type: "clip.layout", clipId: "different", layout: { opacity: 0.7 } }] }] } },
  ]) assert.throws(() => parseCompositionAgentBoundProposal(modified));
  assert.equal(parseCompositionAgentBoundProposal({ ...record, plan: null, binding: { ...record.binding, planSha256: null } }).plan, null);
});

test("consent requires explicit confirmation, matching binding and independent reinforced risk", () => {
  const f = fixture();
  const expected = { bindingSha256: f.record.bindingSha256, requiresReinforcedConfirmation: false };
  assert.deepEqual(parseCompositionAgentProposalConsent(f.consent, expected), f.consent);
  for (const input of [{ ...f.consent, confirmed: false }, { bindingSha256: f.record.bindingSha256 }, { ...f.consent, actorUserId: f.record.binding.ownerUserId }, { ...f.consent, model: "test-model" }]) {
    assert.throws(() => parseCompositionAgentProposalConsent(input, expected));
  }
  assert.throws(() => parseCompositionAgentProposalConsent({ ...f.consent, bindingSha256: "e".repeat(64) }, expected), contractCode("AGENT_CONSENT_BINDING_MISMATCH"));
  assert.throws(() => parseCompositionAgentProposalConsent(f.consent, { ...expected, requiresReinforcedConfirmation: true }), contractCode("AGENT_CONSENT_REINFORCEMENT_REQUIRED"));
  assert.equal(parseCompositionAgentProposalConsent({ ...f.consent, reinforcedConfirmation: true }, { ...expected, requiresReinforcedConfirmation: true }).confirmed, true);
  assert.throws(() => parseCompositionAgentProposalConsent(f.consent, { bindingSha256: expected.bindingSha256 } as never));
});

test("receipt binds original apply revision/hash, proposal and document/tenant identity", () => {
  const f = fixture();
  assert.deepEqual(parseCompositionAgentProposalReceipt(f.receipt, f.expected), f.receipt);
  for (const receipt of [
    { ...f.receipt, proposalId: "00000000-0000-4000-8000-000000000088" },
    { ...f.receipt, documentId: "00000000-0000-4000-8000-000000000088" },
    { ...f.receipt, organizationId: "00000000-0000-4000-8000-000000000088" },
    { ...f.receipt, bindingSha256: "e".repeat(64) },
    { ...f.receipt, applied: { ...f.receipt.applied, revision: f.receipt.applied.revision + 1 } },
    { ...f.receipt, applied: { ...f.receipt.applied, documentHash: f.record.binding.baseDocumentHash } },
  ]) assert.throws(() => parseCompositionAgentProposalReceipt(receipt, f.expected), contractCode("AGENT_RECEIPT_BINDING_MISMATCH"));
});

test("replay DTO retains original apply receipt and an exact, later undo reference", () => {
  const f = fixture();
  const replay = { ...f.receipt, outcome: "ALREADY_APPLIED" };
  assert.deepEqual(parseCompositionAgentProposalReceipt(replay, f.expected).applied, f.receipt.applied);
  const undone = { ...f.receipt, outcome: "ALREADY_UNDONE", undone: { revision: f.receipt.applied.revision + 1, documentHash: f.record.binding.baseDocumentHash } };
  assert.deepEqual(parseCompositionAgentProposalReceipt(undone, f.expected).applied, f.receipt.applied);
  for (const receipt of [
    { ...undone, undone: null },
    { ...f.receipt, undone: undone.undone },
    { ...undone, undone: { ...undone.undone, revision: f.receipt.applied.revision } },
    { ...undone, undone: { ...undone.undone, documentHash: "e".repeat(64) } },
  ]) assert.throws(() => parseCompositionAgentProposalReceipt(receipt, f.expected));
});

test("DTO decoder rejects unknown fields, non-JSON diff values and oversized payloads", () => {
  const f = fixture();
  assert.throws(() => parseCompositionAgentBoundProposal({ ...f.record, authorization: { canApply: true } }));
  for (const after of [NaN, undefined, () => "ignored", BigInt(1)]) {
    const envelope = { ...f.record.envelope, diff: [{ ...f.record.envelope.diff[0], after }] };
    assert.throws(() => parseCompositionAgentBoundProposal({ ...f.record, envelope }));
  }
  assert.throws(() => parseCompositionAgentBoundProposal({ ...f.record, extra: "x".repeat(COMPOSITION_AGENT_INTEGRATION_LIMITS.maxPayloadBytes) }), contractCode("AGENT_INTEGRATION_PAYLOAD_LIMIT"));
});

test("shape-valid digests/owners are deliberately not authenticated by these local contracts", () => {
  const f = fixture();
  const record = { ...f.record, bindingSha256: "e".repeat(64), binding: { ...f.record.binding, ownerUserId: "00000000-0000-4000-8000-000000000088", envelopeSha256: "f".repeat(64) } };
  assert.equal(parseCompositionAgentBoundProposal(record).binding.ownerUserId, record.binding.ownerUserId);
  // Digest computation, ownership/delegation, freshness and atomic consume remain host/DB obligations.
});
