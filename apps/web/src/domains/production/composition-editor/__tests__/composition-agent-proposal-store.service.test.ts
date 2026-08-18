import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionAgentProposal } from "../composition-agent-proposal.service";
import {
  CompositionAgentProposalStoreError,
  persistCompositionAgentProposal,
  prepareCompositionAgentProposalApplication,
  prepareCompositionAgentProposalUndo,
} from "../composition-agent-proposal-store.service";

function fixture() {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "e".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000055", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/proposal-store.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#00D4B3", durationSeconds: 8, subtitle: "Store", title: "Agente" },
  });
  const baseDocumentHash = hashCompositionDocument(document);
  const clip = document.clips.find((candidate) => candidate.kind === "VIDEO")!;
  const envelope = buildCompositionAgentProposal({
    baseDocumentHash,
    document,
    patch: {
      operations: [{ clipId: clip.id, layout: { opacity: 0.7 }, type: "clip.layout" }],
      source: "AGENT",
      summary: "Reducirá la opacidad del video.",
    },
    proposalId: "00000000-0000-4000-8000-000000000099",
  });
  return { baseDocumentHash, document, envelope };
}

test("prepares one persisted proposal and restores its exact base document", () => {
  const { baseDocumentHash, document, envelope } = fixture();
  const applied = prepareCompositionAgentProposalApplication({ baseDocumentHash, document, envelope });
  const undone = prepareCompositionAgentProposalUndo({ appliedDocument: applied.document, envelope });

  assert.notEqual(hashCompositionDocument(applied.document), baseDocumentHash);
  assert.equal(undone.documentHash, baseDocumentHash);
  assert.deepEqual(undone.document, document);
});

test("fails closed when a persisted inverse no longer returns to the base hash", () => {
  const { baseDocumentHash, document, envelope } = fixture();
  const applied = prepareCompositionAgentProposalApplication({ baseDocumentHash, document, envelope });
  const tampered = {
    ...envelope,
    inverseOperations: [{ ...envelope.inverseOperations[0], layout: { opacity: 0.9 } }],
  } as typeof envelope;

  assert.throws(
    () => prepareCompositionAgentProposalUndo({ appliedDocument: applied.document, envelope: tampered }),
    (error) => error instanceof CompositionAgentProposalStoreError && error.code === "PROPOSAL_UNDO_CONFLICT",
  );
});

test("persists bounded recovery metadata with the final model only", async () => {
  const { envelope } = fixture();
  let inserted: Record<string, unknown> | null = null;
  const supabase = {
    from(table: string) {
      assert.equal(table, "video_composition_agent_proposals");
      return {
        async insert(value: Record<string, unknown>) {
          inserted = value;
          return { error: null };
        },
      };
    },
  };

  await persistCompositionAgentProposal({
    draftId: "00000000-0000-4000-8000-000000000011",
    envelope,
    model: "gemini-3.5-flash",
    organizationId: "00000000-0000-4000-8000-000000000012",
    recovery: { attemptCount: 3, repaired: false, usedFallback: true },
    supabase: supabase as never,
    userId: "00000000-0000-4000-8000-000000000013",
  });

  const persisted = inserted as Record<string, unknown> | null;
  assert.ok(persisted);
  assert.equal(persisted.model, "gemini-3.5-flash");
  assert.equal(persisted.recovery_attempt_count, 3);
  assert.equal(persisted.recovery_repaired, false);
  assert.equal(persisted.recovery_used_fallback, true);
});
