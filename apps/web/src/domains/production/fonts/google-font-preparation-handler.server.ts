import { z } from "zod";
import { API_ERROR_CODE, type ApiErrorCode } from "../../../lib/server/api-contract";
import { BoundedConcurrencyLimiter, isExternalImportCapacityError } from "../../../lib/server/external-import-concurrency";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";
import { inspectRegisteredGoogleFont, type GoogleFontPreparationRepository } from "./google-font-preparation-query.server";
import type { GoogleFontBundleReceipt } from "./google-font-bundle.contract";
import type { GoogleFontAdmissionReceipt } from "./google-font-admission.contract";
import { GoogleFontBundleCommitError } from "./google-font-bundle-store.server";
import { readGoogleFontPreparationRequest } from "./google-font-preparation-request.server";

type Preparation = Extract<Awaited<ReturnType<typeof inspectRegisteredGoogleFont>>, { ok: true }>["candidate"];
type Result = { status: 200; preparation: Preparation } | { status: 200; bundle: GoogleFontBundleReceipt }
  | { status: 200; admission: GoogleFontAdmissionReceipt }
  | { status: number; code: ApiErrorCode; message: string };

export type GoogleFontPreparationHttpDependencies = {
  authenticate(): Promise<{ authenticated: boolean; organizationId: string | null; platformRole: string | null; actorId?: string }>;
  repository: GoogleFontPreparationRepository;
  capacity: BoundedConcurrencyLimiter;
  fetchImpl?: typeof fetch;
  recordFailure(reason: string): void;
  materialize?(input: { organizationId: string; actorId: string; fontId: string; expectedCandidateSha256: string; signal: AbortSignal }): Promise<GoogleFontBundleReceipt>;
  admit?(input: { organizationId: string; actorId: string; fontId: string; expectedCandidateSha256: string; signal: AbortSignal }): Promise<GoogleFontAdmissionReceipt>;
};

/** HTTP/application orchestration only. Auth and repositories remain adapters;
 * no network before all request/access gates. Persistence requires an explicit
 * persist:true and reviewed hash; {} retains the read-only preparation behavior. */
export async function handleGoogleFontPreparation(request: Request, rawParams: unknown,
  dependencies: GoogleFontPreparationHttpDependencies): Promise<Result> {
  const fail = (status: number, code: ApiErrorCode, message: string): Result => ({ status, code, message });
  if (request.method !== "POST") return fail(405, API_ERROR_CODE.invalidRequest, "Método no permitido.");
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return fail(403, API_ERROR_CODE.tenantForbidden, "Origen de solicitud no autorizado.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return fail(415, API_ERROR_CODE.unsupportedMediaType, "Se requiere una solicitud JSON.");
  }
  try {
    const context = await dependencies.authenticate();
    if (!context.authenticated) return fail(401, API_ERROR_CODE.authRequired, "No autorizado.");
    if (!context.organizationId) return fail(403, API_ERROR_CODE.tenantForbidden, "Empresa no autorizada.");
    if (context.platformRole !== "ADMIN" && context.platformRole !== "SUPERADMIN") return fail(403, API_ERROR_CODE.roleForbidden, "Se requiere acceso de administrador.");
    const route = z.object({ fontId: z.string().uuid() }).strict().safeParse(rawParams);
    if (!route.success) return fail(400, API_ERROR_CODE.invalidRequest, "Solicitud de preparación inválida.");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(GOOGLE_FONT_PREPARATION_POLICY.timeoutMs)]);
    const body = await readGoogleFontPreparationRequest(request, signal);
    if (!body.success) {
      const tooLarge = body.reason === "too_large";
      return fail(tooLarge ? 413 : 400, tooLarge ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, "Solicitud de preparación inválida.");
    }
    const organizationId = context.organizationId;
    if ("admit" in body.data) {
      const actor = z.string().uuid().safeParse(context.actorId);
      if (!actor.success) return fail(403, API_ERROR_CODE.roleForbidden, "Actor no autorizado para validar fuentes.");
      const admit = dependencies.admit;
      if (!admit) return fail(503, API_ERROR_CODE.dependencyUnavailable, "La validación de variantes no está disponible.");
      const expectedCandidateSha256 = body.data.expectedCandidateSha256;
      const admission = await dependencies.capacity.run(() => admit({ organizationId, actorId: actor.data,
        fontId: route.data.fontId, expectedCandidateSha256, signal }), signal);
      return { status: 200, admission };
    }
    if ("persist" in body.data) {
      const actor = z.string().uuid().safeParse(context.actorId);
      if (!actor.success) return fail(403, API_ERROR_CODE.roleForbidden, "Actor no autorizado para guardar fuentes.");
      if (!dependencies.materialize) return fail(503, API_ERROR_CODE.dependencyUnavailable, "El almacenamiento de fuentes no está disponible.");
      const materialize = dependencies.materialize;
      const bundle = await dependencies.capacity.run(() => materialize({ organizationId, actorId: actor.data,
        fontId: route.data.fontId, expectedCandidateSha256: body.data.expectedCandidateSha256, signal }), signal);
      return { status: 200, bundle };
    }
    const result = await dependencies.capacity.run(() => inspectRegisteredGoogleFont({ organizationId,
      fontId: route.data.fontId, signal, repository: dependencies.repository, fetchImpl: dependencies.fetchImpl }), signal);
    if (!result.ok) return result.reason === "NOT_FOUND"
      ? fail(404, API_ERROR_CODE.resourceNotFound, "Fuente no encontrada.")
      : fail(409, API_ERROR_CODE.conflict, "La fuente registrada no admite esta preparación. Revisa la familia y su URL de Google Fonts.");
    return { status: 200, preparation: result.candidate };
  } catch (error) {
    if (isExternalImportCapacityError(error)) return fail(429, API_ERROR_CODE.rateLimited, "La preparación de fuentes está ocupada. Intenta nuevamente.");
    if (error instanceof GoogleFontBundleCommitError) return error.reason === "FORBIDDEN"
      ? fail(403, API_ERROR_CODE.roleForbidden, "El permiso para guardar fuentes ya no está vigente.")
      : fail(409, API_ERROR_CODE.conflict, "La fuente o el conjunto revisado cambió o fue revocado. Consulta nuevamente antes de guardar.");
    // Never pass arbitrary dependency errors/URLs/tokens to the logger adapter.
    dependencies.recordFailure("GOOGLE_FONT_PREPARATION_UNAVAILABLE");
    return fail(503, API_ERROR_CODE.dependencyUnavailable, "No se pudo confirmar la preparación o su guardado. No se activó la fuente. Si estabas guardando, verifica con la misma solicitud revisada.");
  }
}
