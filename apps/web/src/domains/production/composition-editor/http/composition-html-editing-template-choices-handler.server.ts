import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { htmlEditingBindingSchema } from "../html-editing/html-editing.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { HTML_TEMPLATE_CHOICES_POLICY as policy, htmlTemplateChoicesQuerySchema,
  htmlTemplateChoicesViewSchema } from "../composition-html-editing-template-choices.contract";

export type HtmlTemplateChoicesCommand = { actorId: string; organizationId: string;
  documentId: string; clipId: string; expectedDocumentHash: string };
export function createHtmlTemplateChoicesHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, command: HtmlTemplateChoicesCommand, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies,
    paramsSchema: z.object({ draftId: z.string().uuid(), clipId: htmlEditingBindingSchema.shape.clipId }).strict(),
    querySchema: htmlTemplateChoicesQuerySchema, resultSchema: htmlTemplateChoicesViewSchema,
    policy: { ...policy, organizationRequests: policy.organizationRequestsPerWindow, actorRequests: policy.actorRequestsPerWindow },
    maximumResponseBytes: policy.responseBytes, ratePrefix: "html-editing-template-choices",
    command: (params, query, owner): HtmlTemplateChoicesCommand => ({ ...owner, documentId: params.draftId,
      clipId: params.clipId, expectedDocumentHash: query.expectedDocumentHash }),
    matches: (view, command) => view.documentId === command.documentId && view.clipId === command.clipId
      && view.documentHash === command.expectedDocumentHash,
    isConflict: error => error instanceof HtmlEditingRevisionError && error.code === "REVISION_CONFLICT",
  });
}
