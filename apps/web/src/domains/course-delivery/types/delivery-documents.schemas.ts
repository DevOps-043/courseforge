import { z } from "zod";

const text = z.string().trim().min(1).max(2400);
const reference = z.string().trim().min(1).max(200);
const conditional = z.object({
  applicable: z.boolean(),
  reason: text,
  content: z.string().trim().max(4000),
}).strict().superRefine((value, context) => {
  if (value.applicable && !value.content) {
    context.addIssue({ code: "custom", path: ["content"], message: "Desarrolla el entregable que aplica." });
  }
});

/** La plantilla describe campos. Los resultados reales se registran al impartir. */
export const sessionDocumentsSchema = z.object({
  instruments: z.array(z.object({
    activityId: reference,
    instructions: text,
    participantCriteria: z.array(text).min(1).max(10),
    expectedAnswer: text,
    feedback: text,
    criticalErrors: z.array(text).min(1).max(10),
    retry: text,
    sourceRefs: z.array(reference).min(1).max(20),
  }).strict()).min(1).max(30),
  contingencies: z.array(z.object({
    blockId: reference,
    situation: text,
    trigger: text,
    action: text,
    timeImpact: text,
    evidenceImpact: text,
    objectiveLimit: text,
  }).strict()).min(1).max(20),
  recordTemplate: z.object({
    sessionFields: z.array(text).min(1).max(20),
    participantFields: z.array(text).min(1).max(20),
    instructions: text,
  }).strict(),
  jobAid: conditional,
  followUp: conditional,
  absence: conditional,
}).strict();

export type SessionDocuments = z.infer<typeof sessionDocumentsSchema>;
