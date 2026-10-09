export const MATERIALIZED_MEASUREMENT_PLAN_POLICY = {
  path: "controlled-measurement-plan.json",
  maximumBytes: 20 * 1024 * 1024,
  scope: "AUTHORIZED_MATERIALIZED_SOURCE_NOT_CAPTURE_EVIDENCE",
} as const;
