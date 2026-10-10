import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as actor, htmlEditingFixtureOtherId as candidateId } from "./composition-html-editing-test-fixtures";
import { hashCompositionDocument } from "../composition-document.service";
import { prepareLegacyHtmlEditingPilot } from "../html-editing/html-editing-legacy-instrumentation.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { createHtmlLegacyOperatorHost } from "../composition-html-editing-legacy-operator-host.server";
import { createHtmlLegacyOperatorHandoff } from "../composition-html-editing-legacy-operator-handoff.server";
import type { HtmlLegacyAdoptionCandidate } from "../composition-html-editing-legacy-adoption.contract";

export {actor, candidateId};
export const otherActor = "33333333-3333-4333-8333-333333333333";
export async function createLegacyOperatorFixture() {
  const native = createHtmlEditingRevisionFixture(), binding = native.authority.authoritativeBinding;
  await mkdir(".tmp", {recursive: true});
  const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-legacy-operator-")), handoffRoot = join(root, "handoff"), intentRoot = join(root, "intents");
  await mkdir(handoffRoot); await mkdir(intentRoot);
  const context = {organizationId: actor, documentId: actor, clipId: binding.clipId, revisionId: candidateId,
    documentHash: hashCompositionDocument(native.document), document: native.document, grantedAssetIds: [actor]};
  const state = {context: structuredClone(context), stored: null as HtmlLegacyAdoptionCandidate | null, revoked: false, loseAck: false, deny: false,
    contextUnavailable: false, installed: true, mutations: 0, beforeRegister: undefined as (() => Promise<void>) | undefined};
  const calls: Array<{name: string; parameters: Record<string, unknown>}> = [];
  const supabase = {rpc: (name: string, parameters: Record<string, unknown>) => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({name, parameters});
    if (state.deny || name === "read_html_editing_bootstrap_context" && state.contextUnavailable) return {data: null, error: {message: "PRIVATE_SQL_SECRET"}};
    if (name === "read_html_editing_bootstrap_context") return {data: structuredClone(state.context), error: null};
    if (name === "record_html_editing_legacy_candidate") {
      await state.beforeRegister?.(); state.stored = structuredClone(parameters.p_candidate as HtmlLegacyAdoptionCandidate); state.mutations++;
      if (state.loseAck) throw new Error("PRIVATE_ACK_LOST_AFTER_REGISTRATION");
      return {data: true, error: null};
    }
    if (name === "read_html_editing_legacy_registration") return {data: state.stored ? {status: "RECORDED", candidate: structuredClone(state.stored), revoked: state.revoked}
      : {status: "NOT_FOUND"}, error: null};
    throw new Error("UNEXPECTED_RPC");
  }})} as unknown as SupabaseClient;
  const pilot = prepareLegacyHtmlEditingPilot({sourceHtml: native.current.revision.sourceHtml, templateId: "legacy_intro", templateVersion: 1,
    authoritativeAnchor: {organizationId: actor, documentId: actor, clipId: binding.clipId, revisionId: candidateId,
      documentSha256: context.documentHash}, grantedAssetIds: context.grantedAssetIds,
    imageSources: new Map([[actor, `conformance-media/${actor}`]])});
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1", organizationId: actor, templates: [pilot.candidate.template]}));
  const key = Buffer.alloc(32, 19), configuration = {supabase, handoffRoot, intentRoot, integrityKey: key,
    readCatalog: () => {if (!state.installed) throw new Error("NOT_INSTALLED"); return catalog;}};
  const workflow = await createHtmlLegacyOperatorHost(configuration), handoff = createHtmlLegacyOperatorHandoff(configuration);
  const identity = {actorId: actor, organizationId: actor};
  const prepare = {action: "PREPARE" as const, documentId: actor, clipId: binding.clipId, candidateId, templateId: "legacy_intro", templateVersion: 1,
    expectedDocumentHash: context.documentHash};
  const approval = {evidenceSha256: "d".repeat(64), completedReviews: [...pilot.requiredReviews]};
  return {native, context, state, calls, supabase, catalog, configuration, workflow, handoff, root, handoffRoot, intentRoot, identity, prepare, approval, pilot,
    cleanup: () => rm(root, {recursive: true, force: true})};
}
