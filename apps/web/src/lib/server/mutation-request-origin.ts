import { API_ERROR_CODE } from "./api-contract";
import { apiErrorResponse } from "./api-response";

function allowsMutationOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;

  const origin = request.headers.get("origin");
  if (origin === null || origin === new URL(request.url).origin) return true;

  // El adaptador puede reconstruir la URL. El navegador controla Fetch Metadata.
  if (site !== "same-origin" || !URL.canParse(origin)) return false;
  const browserOrigin = new URL(origin);
  return browserOrigin.protocol === "https:" && browserOrigin.origin === origin;
}

export function rejectCrossOriginMutation(
  request: Request,
  response: { requestId: string; headers: HeadersInit },
) {
  if (allowsMutationOrigin(request)) return null;
  return apiErrorResponse({
    ...response,
    status: 403,
    code: API_ERROR_CODE.originForbidden,
    message: "El origen de la solicitud no está autorizado.",
  });
}
