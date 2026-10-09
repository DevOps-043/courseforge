import type { Handler } from "@netlify/functions";
import { z } from "zod";
import {
  backgroundGuardFailureResponse,
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
} from "./shared/http";
import { createServiceRoleClient } from "./shared/bootstrap";
import { executeSyllabusImport } from "../../src/domains/syllabus/import/syllabus-import.service";

const jobSchema = z
  .object({
    artifactId: z.string().uuid(),
    importId: z.string().uuid(),
    revision: z.number().int().positive(),
    organizationId: z.string().nullable(),
  })
  .strict();
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  let input: unknown;
  try {
    input = await parseVerifiedBackgroundBody(event);
  } catch (error) {
    return backgroundGuardFailureResponse(error);
  }
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { statusCode: 400, body: "Invalid import job" };
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("artifacts")
    .select("organization_id")
    .eq("id", parsed.data.artifactId)
    .single();
  if (error || !data || data.organization_id !== parsed.data.organizationId)
    return { statusCode: 404, body: "Artifact not found" };
  try {
    await executeSyllabusImport(
      admin,
      parsed.data.artifactId,
      parsed.data.importId,
      parsed.data.revision,
    );
    return { statusCode: 200, body: "Import operation completed" };
  } catch {
    return {
      statusCode: 500,
      body: "Import operation failed; original preserved",
    };
  }
};
