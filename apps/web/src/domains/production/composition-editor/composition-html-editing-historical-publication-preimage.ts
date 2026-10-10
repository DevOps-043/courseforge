import { htmlHistoricalPublicationCommandSchema, type HtmlHistoricalPublicationCommand } from "./composition-html-editing-historical-publication.contract";

/** Closed string fields cannot contain the delimiter. Shared by server and the
 * future durable browser journal; binds the WHOLE intention, not just a UUID. */
export function historicalHtmlPublicationRequestPreimage(input: HtmlHistoricalPublicationCommand): string {
  const command = htmlHistoricalPublicationCommandSchema.parse(input);
  return ["courseforge-historical-html-publication-request-v1", command.organizationId, command.compositionId,
    command.draftId, command.actorId, command.operationId, command.request.candidateId, command.request.candidateSha256].join("\n");
}
