import {z} from "zod";

/** Operator-selected bounds, never values selected by composition content. */
export const WINDOWS_JOB_RESOURCE_POLICY = Object.freeze({
  id: "WINDOWS_JOB_RESOURCE_LIMITS_V1", maximumProcesses: 64,
  minimumProcessMemoryBytes: 64 * 1024 ** 2, maximumJobMemoryBytes: 4 * 1024 ** 3,
  maximumUserCpuSeconds: 600, maximumCpuRatePercent: 100,
});
export const windowsJobResourceLimitsSchema = z.object({
  policy: z.literal(WINDOWS_JOB_RESOURCE_POLICY.id),
  maximumProcesses: z.number().int().min(1).max(WINDOWS_JOB_RESOURCE_POLICY.maximumProcesses),
  processMemoryBytes: z.number().int().min(WINDOWS_JOB_RESOURCE_POLICY.minimumProcessMemoryBytes)
    .max(WINDOWS_JOB_RESOURCE_POLICY.maximumJobMemoryBytes),
  jobMemoryBytes: z.number().int().min(WINDOWS_JOB_RESOURCE_POLICY.minimumProcessMemoryBytes)
    .max(WINDOWS_JOB_RESOURCE_POLICY.maximumJobMemoryBytes),
  userCpuSeconds: z.number().int().min(1).max(WINDOWS_JOB_RESOURCE_POLICY.maximumUserCpuSeconds),
  cpuRatePercent: z.number().int().min(1).max(WINDOWS_JOB_RESOURCE_POLICY.maximumCpuRatePercent),
}).strict().refine(limits => limits.processMemoryBytes <= limits.jobMemoryBytes,
  "CONTROLLED_RENDER_WINDOWS_RESOURCE_LIMIT_INVALID");
export type WindowsJobResourceLimits = z.infer<typeof windowsJobResourceLimitsSchema>;
