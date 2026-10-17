import { z } from "zod";
import { narrativeExtractionApplyRequestSchema, narrativeExtractionCommandResultSchema, narrativeExtractionRejectionSchema,
  type NarrativeExtractionApplyRequest, type NarrativeExtractionCommandResult } from "./composition-narrative-extraction-contract";
import { readNarrativeExtractionResponse } from "./composition-narrative-extraction-response";

export type NarrativeExtractionCommandResponse =
  | { kind: "CONFIRMED"; receipt: Exclude<NarrativeExtractionCommandResult, { status: "UNCONFIRMED" }> }
  | { kind: "REJECTED"; commandId: string; message: string }
  | { kind: "UNCONFIRMED"; commandId: string; message: string };

/** Only a bounded explicit negative acknowledgement can reject a fresh apply; never retries. */
export async function requestNarrativeExtractionCommand(params: {
  mode: "APPLY" | "RECOVERY"; draftId: string; command: NarrativeExtractionApplyRequest;
  signal: AbortSignal; fetcher?: typeof fetch;
}): Promise<NarrativeExtractionCommandResponse> {
  const draftId = z.string().uuid().parse(params.draftId);
  const command = narrativeExtractionApplyRequestSchema.parse(params.command);
  params.signal.throwIfAborted();
  const uncertain = (): NarrativeExtractionCommandResponse => ({ kind: "UNCONFIRMED", commandId: command.commandId,
    message: "El guardado no está confirmado. Consulta el resultado de este comando antes de crear otro fragmento." });
  try {
    const action = params.mode === "APPLY" ? "apply" : "receipt";
    const response = await (params.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${draftId}/narrative-extraction/${action}`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: params.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
    });
    params.signal.throwIfAborted();
    if (!response.ok) {
      const rejected = narrativeExtractionRejectionSchema.safeParse(await readNarrativeExtractionResponse(response, params.signal));
      if (params.mode === "APPLY" && rejected.success
        && (!rejected.data.details.commandId || rejected.data.details.commandId === command.commandId)) {
        return { kind: "REJECTED", commandId: command.commandId,
          message: "El servidor rechazó esta extracción sin guardarla. Revisa los permisos, la disponibilidad y vuelve a consultar el rango antes de confirmar." };
      }
      return uncertain();
    }
    const parsed = z.object({ success: z.literal(true), data: narrativeExtractionCommandResultSchema,
      requestId: z.string().optional(), correlationId: z.string().optional() }).strict()
      .safeParse(await readNarrativeExtractionResponse(response, params.signal));
    if (!parsed.success || parsed.data.data.commandId !== command.commandId) return uncertain();
    const result = parsed.data.data;
    if (result.status === "UNCONFIRMED") return uncertain();
    if (params.mode === "RECOVERY" ? result.status !== "CONFIRMED" : result.status === "CONFIRMED") return uncertain();
    return { kind: "CONFIRMED", receipt: result };
  } catch {
    // Abort after dispatch is not evidence that the database transaction was cancelled.
    return uncertain();
  }
}
