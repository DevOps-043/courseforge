import {z} from "zod";

/** A routing selector only. It never carries a document, grant or actor. */
export const htmlPreviewCandidateSelectorSchema = z.object({
  kind: z.enum(["AGENT_PROPOSAL", "PRESET_APPLICATION"]), id: z.string().uuid(),
}).strict();
export type HtmlPreviewCandidateSelector = z.infer<typeof htmlPreviewCandidateSelectorSchema>;

export function readHtmlPreviewCandidateQuery(query: URLSearchParams): HtmlPreviewCandidateSelector | undefined {
  const proposal = query.getAll("proposalId"), application = query.getAll("applicationId");
  if (!proposal.length && !application.length) return undefined;
  if (proposal.length + application.length !== 1) throw new Error("HTML_PREVIEW_CANDIDATE_INVALID");
  const candidate = htmlPreviewCandidateSelectorSchema.parse({kind: proposal.length ? "AGENT_PROPOSAL" : "PRESET_APPLICATION",
    id: proposal[0] ?? application[0]});
  return {...candidate, id: candidate.id.toLowerCase()};
}
