import { z } from "zod";

export const renderAssignmentModeSchema = z.enum(["AUTO", "MANUAL", "MIXED"]);

export const renderWorkerCapacitySchema = z.object({
  maxConcurrentJobs: z.number().int().min(1).max(8).default(1),
  runningJobs: z.number().int().min(0).max(8).default(0),
  cpuCount: z.number().int().min(1).max(256).optional(),
  memoryGb: z.number().min(0).max(2048).optional(),
  source: z.enum(["AUTO", "MANUAL", "UNKNOWN"]).default("UNKNOWN"),
});

export const renderBatchItemRequestSchema = z.object({
  componentId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  preferredWorkerId: z.string().uuid().nullable().optional(),
  variables: z.record(z.string(), z.unknown()).default({}),
});

export const renderBatchRequestSchema = z.object({
  artifactId: z.string().uuid(),
  defaultTemplateId: z.string().uuid(),
  assignmentMode: renderAssignmentModeSchema.default("AUTO"),
  items: z.array(renderBatchItemRequestSchema).min(1).max(100),
});

export interface RenderBatchItemStatusView {
  componentId: string;
  jobId: string | null;
  label: string;
  status: string;
  progress: number;
  finalVideoUrl?: string;
  error?: string;
  errorCode?: string;
  lastLog?: string;
  templateId?: string | null;
  preferredWorkerId?: string | null;
  workerId?: string | null;
}

export interface RenderBatchStatusView {
  id: string;
  status: string;
  assignmentMode: z.infer<typeof renderAssignmentModeSchema>;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  items: RenderBatchItemStatusView[];
}

export type RenderAssignmentMode = z.infer<typeof renderAssignmentModeSchema>;
export type RenderBatchRequest = z.infer<typeof renderBatchRequestSchema>;
export type RenderBatchItemRequest = z.infer<typeof renderBatchItemRequestSchema>;
export type RenderWorkerCapacity = z.infer<typeof renderWorkerCapacitySchema>;
