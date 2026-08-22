import { z } from "zod";

const hyperframesCompositionIdSchema = z.string().uuid();

/** Keeps route-parameter validation separate from document validation. */
export function validateHyperframesCompositionId(value: unknown) {
  return hyperframesCompositionIdSchema.safeParse(value);
}

/** Produces useful diagnostics without logging rejected values or document data. */
export function summarizeHyperframesValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String).join("."),
  }));
}
