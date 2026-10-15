import { z } from "zod";
import { narrativeFragmentApplyRequestSchema, narrativeFragmentCommandResultSchema,
  type NarrativeFragmentApplyRequest, type NarrativeFragmentCommandResult } from "./composition-narrative-fragment-command-contract";
import { narrativeExtractionRejectionSchema } from "./composition-narrative-extraction-contract";
import { readNarrativeExtractionResponse } from "./composition-narrative-extraction-response";

export type NarrativeFragmentCommandResponse =
  | { kind: "CONFIRMED"; receipt: Exclude<NarrativeFragmentCommandResult, { status: "UNCONFIRMED" }> }
  | { kind: "REJECTED"; commandId: string; message: string }
  | { kind: "UNCONFIRMED"; commandId: string; message: string };

/** Sends identical immutable intent for apply/recovery. No automatic retry or voice fallback. */
export async function requestNarrativeFragmentCommand(params: { mode: "APPLY" | "RECOVERY"; draftId: string;
  command: NarrativeFragmentApplyRequest; signal: AbortSignal; fetcher?: typeof fetch }): Promise<NarrativeFragmentCommandResponse> {
  const draftId = z.string().uuid().parse(params.draftId);
  const command = narrativeFragmentApplyRequestSchema.parse(params.command);
  params.signal.throwIfAborted();
  const uncertain = (): NarrativeFragmentCommandResponse => ({ kind: "UNCONFIRMED", commandId: command.commandId,
    message: "El fragmento audiovisual no está confirmado. Consulta el resultado del mismo comando antes de crear otro fragmento." });
  try {
    const action = params.mode === "APPLY" ? "apply" : "receipt";
    const response = await (params.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${draftId}/narrative-fragment/${action}`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: params.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
    });
    params.signal.throwIfAborted();
    if (!response.ok) {
      const rejected = narrativeExtractionRejectionSchema.safeParse(await readNarrativeExtractionResponse(response, params.signal));
      params.signal.throwIfAborted();
      if (params.mode === "APPLY" && rejected.success && (!rejected.data.details.commandId || rejected.data.details.commandId === command.commandId)) {
        return { kind: "REJECTED", commandId: command.commandId,
          message: "El servidor rechazó este fragmento sin guardarlo. Consulta una revisión nueva antes de confirmar." };
      }
      return uncertain();
    }
    const parsed = z.object({ success: z.literal(true), data: narrativeFragmentCommandResultSchema,
      requestId: z.string().optional(), correlationId: z.string().optional() }).strict()
      .safeParse(await readNarrativeExtractionResponse(response, params.signal));
    params.signal.throwIfAborted();
    if (!parsed.success || parsed.data.data.commandId !== command.commandId) return uncertain();
    const result = parsed.data.data;
    if (result.status === "UNCONFIRMED" || (params.mode === "RECOVERY" ? result.status !== "CONFIRMED" : result.status === "CONFIRMED")) return uncertain();
    return { kind: "CONFIRMED", receipt: result };
  } catch { return uncertain(); }
}
