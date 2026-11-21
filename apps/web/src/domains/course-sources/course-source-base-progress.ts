export const BASE_CONTINUATION_LIFETIME_MS = 23 * 60 * 60_000;

export interface DocumentaryBaseProgress {
  phase: "reading" | "writing" | "verifying";
  confirmed: number | null;
  total: number | null;
  started_at?: string;
}

export type DocumentaryBatchCounts = {
  confirmed: number;
  total: number;
};
