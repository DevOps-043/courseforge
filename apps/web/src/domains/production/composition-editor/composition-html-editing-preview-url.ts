import { htmlEditingPreviewSessionSchema, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-session.contract";

export function buildHtmlEditingPreviewPageUrl(draftId: string, session: HtmlEditingPreviewSession, revisionId?: string) {
  const parsed = htmlEditingPreviewSessionSchema.parse(session);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(draftId)) throw new Error("HTML_PREVIEW_DRAFT_INVALID");
  if (revisionId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(revisionId)) throw new Error("HTML_PREVIEW_REVISION_INVALID");
  return `/api/production/hyperframes/drafts/${draftId.toLowerCase()}/html-preview?documentHash=${parsed.documentHash}&r=${parsed.previewGeneration}&nonce=${parsed.nonce}${revisionId ? `&revisionId=${revisionId.toLowerCase()}` : ""}`;
}
export function isHtmlEditingPreviewPageUrl(value: string) {
  try { return /^\/api\/production\/hyperframes\/drafts\/[a-f0-9-]{36}\/html-preview$/.test(new URL(value, "https://preview.invalid").pathname); }
  catch { return false; }
}
