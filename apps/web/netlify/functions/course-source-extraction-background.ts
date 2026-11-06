import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { backgroundGuardFailureResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody } from "./shared/http";
import { createServiceRoleClient } from "./shared/bootstrap";
import { extractCourseSource } from "../../src/domains/course-sources/course-source-extraction";

const schema = z.object({ artifactId: z.uuid(), documentId: z.uuid(), organizationId: z.uuid() }).strict();
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  let body: unknown;
  try { body = await parseVerifiedBackgroundBody(event); } catch (error) { return backgroundGuardFailureResponse(error); }
  const input = schema.safeParse(body);
  if (!input.success) return { statusCode: 400, body: "Solicitud documental inválida." };
  try {
    await extractCourseSource(createServiceRoleClient(), input.data.artifactId, input.data.documentId, input.data.organizationId);
    return { statusCode: 200, body: "Procesamiento documental completado." };
  } catch { return { statusCode: 409, body: "No se pudo completar la extracción; original conservado." }; }
};
