import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlReconstructionResourceHandlers } from "../http/composition-html-editing-reconstruction-resource-handlers.server";
import { htmlReconstructionResourceLinkPreimage, type HtmlReconstructionResourceCandidate,
  type HtmlReconstructionResourceLinkCommand, type HtmlReconstructionResourceLinkReceipt } from "../composition-html-editing-reconstruction-resource-link.contract";
import type { HtmlSnapshotLocatorStorage } from "../composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "../composition-html-snapshot-publication-lock.client";
import type { HtmlReconstructionResourceLinkScope } from "../composition-html-editing-reconstruction-resource-link-journal.client";

export const actor = "11111111-1111-4111-8111-111111111111", draft = "22222222-2222-4222-8222-222222222222",
  assetId = "33333333-3333-4333-8333-333333333333", operation = "44444444-4444-4444-8444-444444444444";
export const scope: HtmlReconstructionResourceLinkScope = {actorId: actor, organizationId: actor, compositionId: draft, draftId: draft};
export const candidate: HtmlReconstructionResourceCandidate = {scope: "CURRENT_TENANT_RESOURCE_CANDIDATE_NOT_LINK_OR_APPROVAL",
  organizationId: actor, compositionId: draft, draftId: draft, currentDocumentHash: "a".repeat(64), currentVersion: 2,
  resourceIdentitySha256: "b".repeat(64), alreadyLinked: false,
  asset: {productionAssetId: assetId, checksum: "c".repeat(64), fileSizeBytes: 1024, mimeType: "image/png", label: "Medio de otra lección",
    durationSeconds: null, hasAudio: null, sourceWidth: 320, sourceHeight: 180, timelineRole: "MEDIA", timelineVariant: null}};
export const command: HtmlReconstructionResourceLinkCommand = {...scope, operationId: operation,
  request: {assetId, resourceIdentitySha256: candidate.resourceIdentitySha256, expectedDocumentHash: candidate.currentDocumentHash,
    expectedVersion: candidate.currentVersion, confirmedResourceOnly: true}};
export function receipt(input = command, reason: HtmlReconstructionResourceLinkReceipt["rejectionReason"] = null): HtmlReconstructionResourceLinkReceipt {
  return {scope: "RESOURCE_LINK_RECEIPT_NOT_CURRENT_GRANT_OR_PUBLICATION", command: structuredClone(input),
    requestSha256: createHash("sha256").update(htmlReconstructionResourceLinkPreimage(input)).digest("hex"),
    resourceLinked: reason === null, rejectionReason: reason, nativeDocumentChanged: false, originalDraftChanged: false};
}
export function resourceLinkFixture() {
  const calls: Array<{name: string; parameters: Record<string, unknown>}> = [], requests: Array<{method: string; url: string; body?: string}> = [];
  const receipts = new Map<string, HtmlReconstructionResourceLinkReceipt>(), slots = new Map<string, string>();
  const state = {candidate: structuredClone(candidate), linked: false, mutations: 0, lostPost: false, beforePost: undefined as (() => Promise<void>) | undefined,
    error: null as null | {message: string}, malformedReceipt: false, rejectReason: null as HtmlReconstructionResourceLinkReceipt["rejectionReason"],
    failStorage: false, allowed: true, writesEnabled: true, originalNative: "UNCHANGED", authenticated: true};
  const storage: HtmlSnapshotLocatorStorage = {getItem: key => slots.get(key) ?? null,
    setItem: (key, value) => {if (state.failStorage) throw new Error("PRIVATE_STORAGE"); slots.set(key, value);},
    removeItem: key => {slots.delete(key);}};
  const lock: HtmlSnapshotPublicationLock = {runExclusive: async (_scope, task) => task()};
  const supabase = {rpc: (name: string, parameters: Record<string, unknown>) => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({name, parameters});
    if (name === "consume_api_rate_limit") return {data: [{allowed: state.allowed, reset_at: "2026-10-10T00:00:00Z"}], error: null};
    if (state.error) return {data: null, error: state.error};
    if (name === "read_html_reconstruction_resource_candidate") return {data: structuredClone({...state.candidate, alreadyLinked: state.linked}), error: null};
    const current = {...scope, operationId: parameters.p_operation as string, request: parameters.p_request as HtmlReconstructionResourceLinkCommand["request"]};
    if (name === "link_html_reconstruction_resource") {
      await state.beforePost?.();
      if (!receipts.has(current.operationId)) {
        receipts.set(current.operationId, receipt(current, state.rejectReason));
        if (!state.rejectReason) {state.linked = true; state.mutations++;}
      }
      const recorded = structuredClone(receipts.get(current.operationId)!);
      return {data: state.malformedReceipt ? {...recorded, nativeDocumentChanged: true} : recorded, error: null};
    }
    if (name === "read_html_reconstruction_resource_link") return {data: receipts.has(current.operationId)
      ? {status: "RECORDED", receipt: structuredClone(receipts.get(current.operationId))} : {status: "NOT_FOUND"}, error: null};
    throw new Error("UNEXPECTED_RPC");
  }})} as unknown as SupabaseClient;
  const handlers = createHtmlReconstructionResourceHandlers({enabled: method => method === "GET" || state.writesEnabled,
    authenticate: async () => state.authenticated ? {actorId: actor, tenant: {organizationId: actor, userId: actor, platformRole: "ADMIN"}} : {actorId: null, tenant: null},
    serviceClient: () => supabase});
  const fetcher: typeof fetch = async (url, options) => {
    const path = new URL(String(url), "https://app.test"), method = options?.method ?? "GET";
    requests.push({method, url: String(url), body: typeof options?.body === "string" ? options.body : undefined});
    const headers = new Headers(options?.headers); if (method === "POST") headers.set("origin", "https://app.test");
    const request = new Request(path, {...options, headers});
    if (path.pathname.includes("html-reconstruction-resources/")) return handlers.lookup(request, {draftId: draft, assetId});
    const params = {draftId: draft, operationId: path.pathname.split("/").at(-1)!};
    const response = await (method === "POST" ? handlers.link : handlers.read)(request, params);
    if (method === "POST" && state.lostPost) throw new Error("ACK_LOST_AFTER_COMMIT");
    return response;
  };
  return {calls, requests, receipts, slots, state, storage, lock, supabase, handlers, fetcher};
}
