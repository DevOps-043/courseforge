import type { Handler } from "@netlify/functions";
import {
  dispatchDocumentaryBase, documentaryBaseScope,
} from "../../src/domains/course-sources/course-source-base-continuation";
import { createServiceRoleClient } from "./shared/bootstrap";
import {
  backgroundGuardFailureResponse, jsonResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody,
} from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  try {
    const body = await parseVerifiedBackgroundBody<{ operation?: string }>(event);
    if (body.operation !== "reconcile-documentary-base") return jsonResponse({ success: false }, 400);
  } catch (error) {
    return backgroundGuardFailureResponse(error);
  }
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("list_due_documentary_base", {
    p_scope: documentaryBaseScope(), p_now: new Date().toISOString(),
  });
  if (error) {
    console.error("[Fuentes] No se pudieron consultar las continuaciones de Base.", { code: error.code });
    return jsonResponse({ success: false }, 503);
  }
  const due = data as { artifact_id: string; organization_id: string; run_id: string }[];
  const results = await Promise.allSettled(due.map(({ artifact_id, organization_id, run_id }) =>
    dispatchDocumentaryBase({ artifactId: artifact_id, organizationId: organization_id, runId: run_id })));
  const dispatched = results.filter((result) => result.status === "fulfilled").length;
  if (dispatched !== due.length)
    console.warn("[Fuentes] Despachos de Base pendientes para la próxima reconciliación.", { dispatched, candidates: due.length });
  return jsonResponse({ candidates: due.length, dispatched });
};
