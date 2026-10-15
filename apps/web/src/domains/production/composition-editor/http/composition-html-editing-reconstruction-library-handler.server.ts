import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { HtmlReconstructionLibraryConflict } from "../composition-html-editing-reconstruction-library.server";
import { HTML_RECONSTRUCTION_LIBRARY_POLICY as policy, htmlReconstructionLibraryQuerySchema,
  htmlReconstructionLibraryPageSchema, htmlReconstructionLibraryRequestSchema, matchesHtmlReconstructionLibrary,
  type HtmlReconstructionLibraryRequest } from "../composition-html-editing-reconstruction-library.contract";

export function createHtmlReconstructionLibraryHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlReconstructionLibraryRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({...dependencies, paramsSchema: z.object({draftId: z.string().uuid()}).strict(),
    querySchema: htmlReconstructionLibraryQuerySchema, resultSchema: htmlReconstructionLibraryPageSchema,
    policy, maximumResponseBytes: policy.responseBytes, ratePrefix: "html-reconstruction-library",
    command: (params, query, owner) => htmlReconstructionLibraryRequestSchema.parse({...owner, ...params, query}),
    matches: matchesHtmlReconstructionLibrary, isConflict: error => error instanceof HtmlReconstructionLibraryConflict,
  });
}
