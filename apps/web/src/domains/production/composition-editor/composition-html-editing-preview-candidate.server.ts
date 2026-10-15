import {isDeepStrictEqual} from "node:util";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {compositionEditorDocumentSchema, type CompositionEditorDocument} from "./composition-document.types";
import {hashCompositionDocument} from "./composition-document-hash";
import {compositionAgentProposalEnvelopeSchema} from "./composition-agent-proposal.types";
import {prepareCompositionAgentProposalApplication} from "./composition-agent-proposal-store.service";
import {readCompositionHtmlEditingSnapshot, type HtmlEditingHistoricalRead} from "./composition-html-editing-reader.service";
import {freezeCompositionHtmlEditingSnapshot} from "./composition-html-editing-snapshot-bundle.server";
import {HTML_EDITING_REPOSITORY_POLICY} from "./composition-html-editing-repository-policy";
import {htmlPreviewCandidateSelectorSchema, type HtmlPreviewCandidateSelector} from "./composition-html-editing-preview-candidate.contract";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.object({id: z.string().uuid(), draft_id: z.string().uuid(), organization_id: z.string().uuid(),
  created_by: z.string().uuid(), status: z.literal("PENDING"), base_document_hash: hash,
  expires_at: z.string().datetime({offset: true})}).strict();
const proposalRow = identity.extend({envelope: compositionAgentProposalEnvelopeSchema}).strict();
const presetRow = identity.extend({proposed_document: z.unknown(), proposed_document_hash: hash}).strict();
const latestRow = z.array(z.object({document_hash: hash, version: z.number().int().positive()}).strict()).length(1);
type Snapshot = Awaited<ReturnType<typeof readCompositionHtmlEditingSnapshot>>;

/** Pure projection after host authorization. Retained references/source MUST be
 * identical to the exact saved baseline; no new HTML authority is synthesized.
 * Native edits/deletions can change the candidate hash without saving a draft. */
export function projectHtmlPreviewCandidateSnapshot(base: Snapshot, candidate: CompositionEditorDocument, documentHash: string): Snapshot {
  const document = compositionEditorDocumentSchema.parse(candidate);
  if (hashCompositionDocument(base.document) !== base.context.documentHash || hashCompositionDocument(document) !== documentHash
    || !document.htmlEditing?.items.length) throw new Error("HTML_PREVIEW_CANDIDATE_UNAVAILABLE");
  const retained = document.htmlEditing.items;
  for (const reference of retained) {
    const original = base.document.htmlEditing?.items.find(item => item.clipId === reference.clipId);
    const originalClip = base.document.clips.find(clip => clip.id === reference.clipId);
    const proposedClip = document.clips.find(clip => clip.id === reference.clipId);
    if (!original || !isDeepStrictEqual(original, reference) || !isDeepStrictEqual(originalClip?.source, proposedClip?.source))
      throw new Error("HTML_PREVIEW_CANDIDATE_UNAVAILABLE");
  }
  const context = {...base.context, documentHash, revisions: base.context.revisions.filter(row =>
    retained.some(reference => reference.clipId === row.authoritativeBinding.clipId))};
  return {document, context, bundle: freezeCompositionHtmlEditingSnapshot({document, context})};
}

/** Current creator/status/expiry/base checks precede exact RPC authorization.
 * This read-only HTML adapter does not change CAP025 policy/stores or imply a
 * delegation contract for other users. Every resource read re-enters it. */
export async function readHtmlPreviewCandidateSnapshot(input: HtmlEditingHistoricalRead & {
  candidate: HtmlPreviewCandidateSelector; supabase: SupabaseClient;
}, ports: {readSnapshot?: typeof readCompositionHtmlEditingSnapshot; now?: () => number} = {}): Promise<Snapshot> {
  try {
    const candidate = htmlPreviewCandidateSelectorSchema.parse(input.candidate);
    const scope = z.object({actorId: z.string().uuid(), organizationId: z.string().uuid(), documentId: z.string().uuid(), documentHash: hash})
      .parse(input);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    signal.throwIfAborted();
    const commonColumns = "id,draft_id,organization_id,created_by,status,base_document_hash,expires_at";
    const agent = candidate.kind === "AGENT_PROPOSAL";
    const result = await input.supabase.from(agent ? "video_composition_agent_proposals" : "video_composition_preset_applications")
      .select(`${commonColumns},${agent ? "envelope" : "proposed_document,proposed_document_hash"}`)
      .eq("id", candidate.id).eq("draft_id", scope.documentId).eq("organization_id", scope.organizationId)
      .eq("created_by", scope.actorId).limit(1).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
    const decoded = z.array(agent ? proposalRow : presetRow).length(1).parse(result.data)[0]!;
    const now = (ports.now ?? Date.now)(), expires = Date.parse(decoded.expires_at);
    if (!Number.isFinite(now) || !Number.isFinite(expires) || expires <= now || decoded.id !== candidate.id
      || decoded.created_by !== scope.actorId || decoded.organization_id !== scope.organizationId || decoded.draft_id !== scope.documentId) throw new Error();
    const current = await input.supabase.from("video_composition_draft_documents").select("document_hash,version")
      .eq("draft_id", scope.documentId).eq("organization_id", scope.organizationId)
      .order("version", {ascending: false}).limit(1).abortSignal(signal);
    signal.throwIfAborted();
    if (current.error || Buffer.byteLength(JSON.stringify(current.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.acknowledgmentBytes
      || latestRow.parse(current.data)[0]!.document_hash !== decoded.base_document_hash) throw new Error();
    const base = await (ports.readSnapshot ?? readCompositionHtmlEditingSnapshot)({...scope,
      documentHash: decoded.base_document_hash, supabase: input.supabase, signal});
    signal.throwIfAborted();
    let document: CompositionEditorDocument;
    if ("envelope" in decoded) {
      if (decoded.envelope.proposalId !== candidate.id || decoded.envelope.baseDocumentHash !== decoded.base_document_hash) throw new Error();
      const rebuilt = prepareCompositionAgentProposalApplication({document: base.document, baseDocumentHash: decoded.base_document_hash,
        envelope: decoded.envelope});
      if (!rebuilt.envelope.validation.passed) throw new Error();
      document = rebuilt.document;
    } else {
      document = compositionEditorDocumentSchema.parse(decoded.proposed_document);
      if (hashCompositionDocument(document) !== decoded.proposed_document_hash) throw new Error();
    }
    const projected = projectHtmlPreviewCandidateSnapshot(base, document, scope.documentHash);
    signal.throwIfAborted();
    return projected;
  } catch { throw new Error("HTML_PREVIEW_CANDIDATE_UNAVAILABLE"); }
}
