import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { HTML_RECONSTRUCTION_OPENING_POLICY as policy, htmlReconstructionOpeningSchema, htmlReconstructionOpeningRequestSchema,
  matchesHtmlReconstructionOpening, type HtmlReconstructionOpeningRequest } from "../composition-html-editing-reconstruction-opening.contract";

export function createHtmlReconstructionOpeningHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlReconstructionOpeningRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({...dependencies,
    paramsSchema: z.object({draftId: z.string().uuid()}).strict(),
    querySchema: z.object({compositionId: z.string().uuid()}).strict(), resultSchema: htmlReconstructionOpeningSchema,
    policy, maximumResponseBytes: policy.responseBytes, ratePrefix: "html-reconstruction-opening",
    command: (params, query, owner) => htmlReconstructionOpeningRequestSchema.parse({...owner, ...params, ...query}),
    matches: matchesHtmlReconstructionOpening,
  });
}
