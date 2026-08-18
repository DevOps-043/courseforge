import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import { CompositionAgentPolicyError } from "../composition-agent-policy.service";
import { buildCompositionAgentProposal } from "../composition-agent-proposal.service";
import { CompositionAgentValidationError } from "../composition-agent-validation.service";

const BASE_DOCUMENT_HASH = "a".repeat(64);
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000099";

test("builds a versioned proposal with a safe diff and exact inverse operations", () => {
  const document = createDocument();
  const clip = document.clips[0]!;
  const operations: CompositionEditorPatchOperation[] = [
    { clipId: clip.id, layout: { x: 240, y: 120 }, type: "clip.layout" },
  ];

  const proposal = buildProposal(document, operations);
  const simulated = applyCompositionEditorPatches(document, operations, "AGENT");
  const restored = applyCompositionEditorPatches(simulated, proposal.inverseOperations, "USER");

  assert.equal(proposal.schemaVersion, 2);
  assert.equal(proposal.baseDocumentHash, BASE_DOCUMENT_HASH);
  assert.equal(proposal.validation.passed, true);
  assert.equal(proposal.risk.level, "LOW");
  assert.equal(proposal.risk.requiresConfirmation, true);
  assert.deepEqual(restored, document);
  assert.ok(proposal.diff.some((change) => change.path.endsWith("/layout/x")));
  assert.doesNotMatch(JSON.stringify(proposal.diff), /productionAssetId|storagePath|source/);
});

test("rejects destructive manual operations even though the general patch schema accepts them", () => {
  const document = createDocument();
  const clip = document.clips[0]!;

  assert.throws(
    () => buildProposal(document, [{ clipId: clip.id, type: "clip.remove" }]),
    (error: unknown) => error instanceof CompositionAgentPolicyError
      && error.code === "AGENT_OPERATION_FORBIDDEN",
  );
  assert.throws(
    () => buildProposal(document, [{ document, type: "document.restore" }]),
    (error: unknown) => error instanceof CompositionAgentPolicyError
      && error.code === "AGENT_OPERATION_FORBIDDEN",
  );
});

test("rejects a newly introduced overlap on the same track", () => {
  const document = createDocument({ assetCount: 2 });
  const secondClip = document.clips[1]!;
  assert.ok(secondClip.startSeconds > 0);

  assert.throws(
    () => buildProposal(document, [{
      clipId: secondClip.id,
      startSeconds: 1,
      type: "clip.move",
    }]),
    (error: unknown) => error instanceof CompositionAgentValidationError
      && error.issues.some((issue) => issue.code === "AGENT_TIMELINE_OVERLAP_INTRODUCED"),
  );
});

test("allows an explicit unlock followed by an edit and reverses both changes", () => {
  const document = createDocument();
  const clip = document.clips[0]!;
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId)!;
  track.locked = true;
  const operations: CompositionEditorPatchOperation[] = [
    { settings: { locked: false }, trackId: track.id, type: "track.update" },
    { clipId: clip.id, layout: { width: clip.layout.width - 100 }, type: "clip.layout" },
  ];

  const proposal = buildProposal(document, operations);
  const simulated = applyCompositionEditorPatches(document, operations, "AGENT");
  const restored = applyCompositionEditorPatches(simulated, proposal.inverseOperations, "USER");

  assert.equal(proposal.risk.level, "MEDIUM");
  assert.deepEqual(restored, document);
});

test("marks content-hiding proposals as high risk with reinforced confirmation", () => {
  const document = createDocument();
  const clip = document.clips[0]!;
  const proposal = buildProposal(document, [{
    clipId: clip.id,
    hidden: true,
    type: "clip.visibility",
  }]);

  assert.equal(proposal.risk.level, "HIGH");
  assert.equal(proposal.risk.requiresReinforcedConfirmation, true);
});

test("rejects no-op proposals instead of asking the user to approve an empty change", () => {
  const document = createDocument();
  const clip = document.clips[0]!;

  assert.throws(
    () => buildProposal(document, [{
      clipId: clip.id,
      layout: { x: clip.layout.x },
      type: "clip.layout",
    }]),
    (error: unknown) => error instanceof CompositionAgentValidationError
      && error.issues.some((issue) => issue.code === "AGENT_PROPOSAL_NO_EFFECT"),
  );
});

function buildProposal(
  document: ReturnType<typeof createDocument>,
  operations: CompositionEditorPatchOperation[],
) {
  return buildCompositionAgentProposal({
    baseDocumentHash: BASE_DOCUMENT_HASH,
    document,
    patch: {
      operations,
      source: "AGENT",
      summary: "Aplicará una edición segura y reversible.",
    },
    proposalId: PROPOSAL_ID,
  });
}

function createDocument(params: { assetCount?: number } = {}) {
  const assetCount = params.assetCount || 1;
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: Array.from({ length: assetCount }, (_, index) => ({
      checksum: String(index + 1).repeat(64),
      durationSeconds: 4,
      fileSizeBytes: 1_024,
      label: `B-roll ${index + 1}`,
      mimeType: "video/mp4",
      productionAssetId: `00000000-0000-4000-8000-0000000000${index + 11}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `production-assets/broll-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: {
      accentColor: "#00D4B3",
      durationSeconds: 10,
      subtitle: "Propuesta segura",
      title: "Agente editor",
    },
  });
}
