import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionAgentProposal } from "../composition-agent-proposal.service";
import {
  applyStoredCompositionAgentProposal, getCompositionAgentPreviewDocument, CompositionAgentProposalStoreError,
} from "../composition-agent-proposal-store.service";
import { hashCompositionDocument } from "../composition-document-hash";
import { AGENT_TEST_PROPOSAL_ID, compositionAgentFixture } from "./composition-agent-test-fixture";

// Contract fake only. No DB locks/RLS/transaction durability is modeled or credited.
function fixture(highRisk = false) {
  const context = compositionAgentFixture();
  const envelope = buildCompositionAgentProposal({
    baseDocumentHash: context.scope.documentHash, document: context.document,
    patch: { source: "AGENT", summary: "Ajustará el video", operations: highRisk
      ? [{ type: "clip.visibility", clipId: context.clip.id, hidden: true }]
      : [{ type: "clip.layout", clipId: context.clip.id, layout: { opacity: 0.7 } }] },
    proposalId: AGENT_TEST_PROPOSAL_ID,
  });
  const row = {
    id: AGENT_TEST_PROPOSAL_ID, draft_id: context.scope.documentId, organization_id: context.scope.organizationId,
    created_by: context.scope.userId, envelope, base_document_hash: context.scope.documentHash,
    expires_at: new Date(Date.now() + 900_000).toISOString(), model: "test-configured-model", status: "PENDING",
    applied_document_hash: null as string | null, applied_version: null as number | null,
    undone_document_hash: null, undone_version: null,
  };
  let current = { document: context.document, document_hash: context.scope.documentHash, version: context.scope.revision };
  const reads: { table: string; select: string; filters: [string, unknown][] }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let outcome: string | null = null;
  const supabase = {
    from(table: string) {
      const read = { table, select: "", filters: [] as [string, unknown][] };
      reads.push(read);
      const result = () => ({ data: read.filters.some(([key, value]) => key === "organization_id" && value !== row.organization_id || key === "draft_id" && value !== row.draft_id || key === "id" && value !== row.id)
        ? null
        : table === "video_composition_agent_proposals" ? structuredClone(row)
          : table === "video_composition_draft_documents" ? structuredClone(current) : [], error: null });
      const query = {
        select(fields: string) { read.select = fields; return query; },
        eq(key: string, value: unknown) { read.filters.push([key, value]); return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() { return result(); },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
        insert() { throw new Error("Unexpected direct write"); }, update() { throw new Error("Unexpected direct write"); },
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (!outcome || outcome === "APPLIED") {
        current = { document: args.p_document as typeof current.document, document_hash: args.p_document_hash as string, version: current.version + 1 };
        row.status = "APPLIED";
        row.applied_document_hash = current.document_hash;
        row.applied_version = current.version;
      }
      const result = { data: [{ outcome: outcome ?? "APPLIED", document_hash: current.document_hash, version: current.version }], error: null };
      const query = {
        retry(value: boolean) { assert.equal(value, false); return query; },
        abortSignal() { return query; },
        then(resolve: (value: typeof result) => unknown) { return Promise.resolve(result).then(resolve); },
      };
      return query;
    },
  };
  const params = {
    draftId: context.scope.documentId, organizationId: context.scope.organizationId, userId: context.scope.userId,
    proposalId: AGENT_TEST_PROPOSAL_ID, expectedDocumentHash: context.scope.documentHash,
    reinforcedConfirmation: false, supabase: supabase as never,
  };
  return { params, row, reads, rpcCalls, context, setOutcome: (value: string) => { outcome = value; }, current: () => current };
}

const storeCode = (code: string) => (error: unknown) => error instanceof CompositionAgentProposalStoreError && error.code === code;

test("expired and terminal pending proposals reject before any mutation RPC", async () => {
  for (const status of ["PENDING", "EXPIRED", "DISMISSED"]) {
    const f = fixture();
    f.row.status = status;
    f.row.expires_at = new Date(0).toISOString();
    await assert.rejects(applyStoredCompositionAgentProposal(f.params), storeCode(status === "PENDING" ? "PROPOSAL_EXPIRED" : "PROPOSAL_UNAVAILABLE"));
    assert.equal(f.rpcCalls.length, 0);
  }
});

test("stale expected/current base hash rejects without writes", async () => {
  const f = fixture();
  await assert.rejects(applyStoredCompositionAgentProposal({ ...f.params, expectedDocumentHash: "a".repeat(64) }), storeCode("PROPOSAL_CONFLICT"));
  f.row.base_document_hash = "a".repeat(64);
  await assert.rejects(getCompositionAgentPreviewDocument(f.params), storeCode("PROPOSAL_CONFLICT"));
  assert.equal(f.rpcCalls.length, 0);
});

test("lookup is document/tenant scoped and cross-tenant lookup cannot apply", async () => {
  const f = fixture();
  await assert.rejects(applyStoredCompositionAgentProposal({ ...f.params, organizationId: "00000000-0000-4000-8000-000000000088" }), storeCode("PROPOSAL_UNAVAILABLE"));
  assert.equal(f.rpcCalls.length, 0);
  assert.ok(f.reads[0]?.filters.some(([key]) => key === "draft_id"));
  assert.ok(f.reads[0]?.filters.some(([key]) => key === "organization_id"));
});

test("high-risk proposal requires reinforced confirmation in TS and at RPC", async () => {
  const f = fixture(true);
  await assert.rejects(applyStoredCompositionAgentProposal(f.params), storeCode("PROPOSAL_CONFIRMATION_REQUIRED"));
  assert.equal(f.rpcCalls.length, 0);
  f.setOutcome("CONFIRMATION_REQUIRED");
  await assert.rejects(applyStoredCompositionAgentProposal({ ...f.params, reinforcedConfirmation: true }), storeCode("PROPOSAL_CONFIRMATION_REQUIRED"));
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.current().document_hash, f.context.scope.documentHash);
});

test("preview has no writes and replay causes no second RPC", async () => {
  const f = fixture();
  const before = structuredClone(f.context.document);
  await getCompositionAgentPreviewDocument(f.params);
  assert.equal(f.rpcCalls.length, 0);
  const first = await applyStoredCompositionAgentProposal(f.params);
  const replay = await applyStoredCompositionAgentProposal(f.params);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(first.documentHash, replay.documentHash);
  assert.equal(f.rpcCalls.length, 1);
  assert.deepEqual(f.context.document, before);
  assert.equal(f.rpcCalls[0]?.name, "apply_video_composition_agent_proposal");
  assert.notEqual(hashCompositionDocument(first.document), f.context.scope.documentHash);
});

test("store rebuilds stored diff/risk instead of trusting forged client-visible metadata", async () => {
  const f = fixture(true);
  f.row.envelope.risk.requiresReinforcedConfirmation = false;
  f.row.envelope.diff[0]!.after = "forged-result";
  await assert.rejects(applyStoredCompositionAgentProposal(f.params), storeCode("PROPOSAL_CONFIRMATION_REQUIRED"));
  assert.equal(f.rpcCalls.length, 0);
});

test("RPC expiry/conflict/replay outcomes preserve their contract with simulated dependencies", async () => {
  for (const [outcome, code] of [["PROPOSAL_EXPIRED", "PROPOSAL_EXPIRED"], ["CONFLICT", "PROPOSAL_CONFLICT"]]) {
    const f = fixture(); f.setOutcome(outcome!);
    await assert.rejects(applyStoredCompositionAgentProposal(f.params), storeCode(code!));
    assert.equal(f.current().document_hash, f.context.scope.documentHash);
  }
  const f = fixture(); f.setOutcome("ALREADY_APPLIED");
  assert.equal((await applyStoredCompositionAgentProposal(f.params)).idempotentReplay, true);
});

test("audit gap: store currently permits another same-tenant actor without checking proposal owner", async () => {
  const f = fixture();
  const otherUser = "00000000-0000-4000-8000-000000000088";
  await applyStoredCompositionAgentProposal({ ...f.params, userId: otherUser });
  assert.equal(f.row.created_by, f.context.scope.userId);
  assert.equal(f.rpcCalls[0]?.args.p_actor_id, otherUser);
  assert.ok(f.reads.filter((read) => read.table === "video_composition_agent_proposals").every((read) => !read.select.includes("created_by") && !read.filters.some(([key]) => key === "created_by")));
  // Characterization is evidence of a gap, not acceptance of this permission model.
});

test("audit gap: invalid expiry date is accepted by the current TS preview reader", async () => {
  const f = fixture(); f.row.expires_at = "not-a-date";
  await getCompositionAgentPreviewDocument(f.params);
  assert.equal(f.rpcCalls.length, 0);
  // PostgreSQL timestamptz is typed; this tests the TS reader's missing validation only.
});
