import { z } from "zod";
export const sourceAssociationSchema = z
  .object({
    lessonId: z.string().min(1).max(200),
    evidenceType: z.enum(["DOCUMENT", "WEB"]),
    evidenceId: z.uuid(),
    requirementIds: z.array(z.string().min(1).max(200)).min(1).max(50),
    verified: z.boolean(),
    conflict: z.boolean(),
    resolution: z.string().trim().max(2000),
  })
  .strict();
const version = {
  expectedRevision: z.number().int().nonnegative(),
  curriculumHash: z.string().regex(/^[a-f0-9]{32}$/),
};
export const sourceReviewSnapshotSchema = z.object({
  policy: z
    .enum(["DOCUMENTS_ONLY", "DOCUMENTS_AND_WEB", "WEB_ONLY"])
    .nullable(),
  configured: z.boolean(),
  revision: z.number().int().nonnegative(),
  approved: z.boolean(),
  curriculumHash: z.string().regex(/^[a-f0-9]{32}$/),
  planReady: z.boolean(),
  canApprove: z.boolean().optional(),
  lessons: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      webRequired: z.number().nonnegative(),
      requirements: z.array(
        z.object({ id: z.string().min(1), label: z.string() }),
      ),
    }),
  ),
  evidence: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(["DOCUMENT", "WEB"]),
      title: z.string(),
      text: z.string(),
      lessonId: z.string().optional(),
      sourceRef: z.string().optional(),
    }),
  ),
  associations: z.array(sourceAssociationSchema),
});
export const sourceReviewCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("policy"),
      ...version,
      policy: z.enum(["DOCUMENTS_ONLY", "DOCUMENTS_AND_WEB", "WEB_ONLY"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      ...version,
      associations: z.array(sourceAssociationSchema).max(1000),
    })
    .strict(),
  z.object({ action: z.literal("approve"), ...version }).strict(),
  z.object({ action: z.literal("propose") }).strict(),
]);
