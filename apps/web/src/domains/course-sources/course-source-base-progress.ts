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
