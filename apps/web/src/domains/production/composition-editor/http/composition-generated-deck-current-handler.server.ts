import { z } from "zod";
import { createHtmlAuthenticatedReadHandler } from "./composition-html-authenticated-read-handler.server";
import type { HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERATED_DECK_INITIALIZATION_POLICY, generatedDeckInitializationCurrentSchema, generatedDeckInitializationRequestSchema } from "../composition-generated-deck-initialization.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY as policy } from "../composition-html-editing-initialization-operation-http-policy";
import { GeneratedDeckInitializationHost } from "../composition-generated-deck-initialization.server";

export function createGeneratedDeckCurrentHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies,
    paramsSchema: z.object({ draftId: z.string().uuid() }).strict(),
    querySchema: generatedDeckInitializationRequestSchema.omit({ expectedDocumentHash: true })
      .extend({ documentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    resultSchema: generatedDeckInitializationCurrentSchema,
    policy: { maximumUrlBytes: policy.maximumUrlBytes, timeoutMs: GENERATED_DECK_INITIALIZATION_POLICY.timeoutMs,
      windowSeconds: policy.windowSeconds, organizationRequests: policy.organizationReadRequests,
      actorRequests: policy.actorReadRequests, maximumRateResponseBytes: policy.maximumRateResponseBytes },
    ratePrefix: "generated-deck-initialization-current", maximumResponseBytes: GENERATED_DECK_INITIALIZATION_POLICY.maximumReceiptBytes,
    command: (params, query, owner) => ({ owner: { ...owner, draftId: params.draftId }, identity: query }),
    read: (client, command, signal) => new GeneratedDeckInitializationHost(client).readCurrent(command.owner, command.identity, signal),
    matches: (result, command) => result.documentHash === command.identity.documentHash
      && result.receipt.operationId === command.identity.operationId && result.receipt.requestSha256 === command.identity.requestSha256
      && result.receipt.owner.actorId === command.owner.actorId && result.receipt.owner.organizationId === command.owner.organizationId
      && result.receipt.owner.draftId === command.owner.draftId,
  });
}
