import {z} from "zod";
import type {HyperframesRenderProfileId} from "../hyperframes/hyperframes-render-profiles";

export type HtmlSnapshotEditorPublicationContext={documentHash:string | null;hasHtmlEditing:boolean;
  snapshotHistoryLoaded:boolean;expectedActiveRevisionId:string | null;renderProfileId:HyperframesRenderProfileId;
  saving:boolean;otherWorkPending:boolean;previewPending:boolean};
/** UI admission is convenience, never authority. Server rechecks latest saved
 * hash, active CAS, authenticated tenant, grants and current resources. */
export function resolveHtmlSnapshotPublicationAdmission(input:{enabled:boolean;context:HtmlSnapshotEditorPublicationContext;
  trackingReady:boolean;trackingPending:boolean;storageAvailable:boolean;lockAvailable:boolean}) {
  if (!input.enabled) return "DISABLED";
  if (!input.context.hasHtmlEditing) return "NOT_HTML";
  if (!input.trackingReady || !input.context.snapshotHistoryLoaded) return "NOT_READY";
  if (input.trackingPending) return "PENDING_OPERATION";
  if (!input.storageAvailable || !input.lockAvailable) return "BROWSER_UNAVAILABLE";
  if (input.context.saving || input.context.previewPending) return "SAVE_OR_PREVIEW_PENDING";
  if (input.context.otherWorkPending) return "OTHER_WORK_PENDING";
  if (!z.string().regex(/^[a-f0-9]{64}$/).safeParse(input.context.documentHash).success
    || !z.string().uuid().nullable().safeParse(input.context.expectedActiveRevisionId).success) return "INVALID_SAVED_IDENTITY";
  return "READY";
}
