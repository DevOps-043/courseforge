import { z } from "zod";
import { DELIVERY_LIMITS as limits } from "../config/delivery.config";

const text = z.string().trim().min(1).max(limits.text);
const reference = z.string().trim().min(1).max(200);
export const deliveryModeSchema = z.enum(["NEXUS", "SYNCHRONOUS", "HYBRID"]);
export const deliveryConfigSchema = z.object({
  mode: deliveryModeSchema.default("NEXUS"),
  approach: z.enum(["COMPLEMENTARY", "CLASS_VERSION"]).default("COMPLEMENTARY"),
  balance: z.enum(["EXPLANATION", "BALANCED", "PRACTICE"]).default("BALANCED"),
  sessionCount: z.number().int().min(1).max(limits.sessions).nullable().default(null),
  sessionMinutes: z.number().int().min(15).max(limits.sessionMinutes).default(90),
}).strict();
export const coverageSchema = z.object({
  lessonId: reference,
  scope: text,
  review: z.boolean(),
}).strict();
export const agendaSessionSchema = z.object({
  id: z.uuid(),
  title: text,
  minutes: z.number().int().min(15).max(limits.sessionMinutes),
  objectives: z.array(text).min(1).max(20),
  coverage: z.array(coverageSchema).min(1).max(limits.lessons),
  evidence: text,
}).strict();
export const agendaSchema = z.array(agendaSessionSchema).min(1).max(limits.sessions);
export const generatedAgendaSchema = z.object({
  sessions: z.array(agendaSessionSchema.omit({ id: true })).min(1).max(limits.sessions),
}).strict();
export const sessionPlanSchema = z.object({
  blocks: z.array(z.object({
    id: reference,
    purpose: text,
    minutes: z.number().int().positive().max(limits.sessionMinutes),
    explanation: text,
    activity: text,
    criteria: z.array(text).min(1).max(10),
    resources: z.array(text).max(20),
  }).strict()).min(1).max(30),
  nexusLinks: z.array(z.object({
    lessonId: reference,
    timing: z.enum(["BEFORE", "AFTER"]),
    purpose: text,
  }).strict()).max(limits.lessons),
}).strict();
export const sessionMaterialsSchema = z.object({
  concepts: z.array(z.object({ title: text, explanation: text, example: text, misconceptions: z.array(text).max(10), sourceRefs: z.array(reference).min(1).max(20) }).strict()).min(1).max(30),
  activities: z.array(z.object({ id: reference, title: text, instructions: text, template: text, answer: text, criteria: z.array(text).min(1).max(10), sourceRefs: z.array(reference).min(1).max(20) }).strict()).min(1).max(30),
  preparation: z.object({ understand: text, explain: text, conduct: text, deepen: text, expand: text }).strict(),
  slides: z.array(z.object({ title: text, points: z.array(text).min(1).max(6), notes: z.string().max(1800), sourceRefs: z.array(reference).min(1).max(20) }).strict()).min(1).max(40),
}).strict();
export type DeliveryConfig = z.infer<typeof deliveryConfigSchema>;
export type AgendaSession = z.infer<typeof agendaSessionSchema>;
export type SessionPlan = z.infer<typeof sessionPlanSchema>;
export type SessionMaterials = z.infer<typeof sessionMaterialsSchema>;
export type DeliveryOperation = "AGENDA" | "PLAN" | "MATERIALS";
export interface DeliveryApproval { revision: number; syllabus: string; nexus: string; sources: string; content: string; userId: string }
export interface DeliveryDocument {
  config: DeliveryConfig;
  syllabusHash: string;
  agenda: AgendaSession[];
  plans: Record<string, SessionPlan>;
  materials: Record<string, SessionMaterials>;
  stalePlans: string[];
  staleMaterials: string[];
  planInputHashes: Record<string, string>;
  materialInputHashes: Record<string, string>;
  planApproval: DeliveryApproval | null;
  materialsApproval: DeliveryApproval | null;
}
export const deliveryDocumentSchema = z.object({
  config: deliveryConfigSchema, syllabusHash: z.string(), agenda: z.array(agendaSessionSchema).max(limits.sessions),
  plans: z.record(z.string(), sessionPlanSchema), materials: z.record(z.string(), sessionMaterialsSchema),
  stalePlans: z.array(z.string()).default([]), staleMaterials: z.array(z.string()).default([]),
  planInputHashes: z.record(z.string(), z.string()).default({}), materialInputHashes: z.record(z.string(), z.string()).default({}),
  planApproval: z.object({ revision: z.number().int(), syllabus: z.string(), nexus: z.string(), sources: z.string(), content: z.string(), userId: z.string() }).nullable(),
  materialsApproval: z.object({ revision: z.number().int(), syllabus: z.string(), nexus: z.string(), sources: z.string(), content: z.string(), userId: z.string() }).nullable(),
}).strict();
export interface DeliveryWorkspace { artifact_id: string; organization_id: string; revision: number; document: DeliveryDocument }
export function emptyDeliveryDocument(): DeliveryDocument {
  return { config: deliveryConfigSchema.parse({}), syllabusHash: "", agenda: [], plans: {}, materials: {}, stalePlans: [], staleMaterials: [], planInputHashes: {}, materialInputHashes: {}, planApproval: null, materialsApproval: null };
}
