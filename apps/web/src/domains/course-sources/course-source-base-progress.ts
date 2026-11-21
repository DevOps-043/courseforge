export const BASE_CONTINUATION_LIFETIME_MS = 23 * 60 * 60_000;
const BASE_UNCLAIMED_RETRY_DELAY_MS = 60_000;

export interface DocumentaryBaseReservation {
  run_id?: string;
  started_at?: string;
  base_queue?: { invocations?: number; owner?: string | null } | null;
}

export function canRetryUnclaimedDocumentaryBase(metadata?: DocumentaryBaseReservation | null, now = Date.now()) {
  return typeof metadata?.run_id === "string" && typeof metadata.started_at === "string"
    && metadata.base_queue?.invocations === 0 && !metadata.base_queue.owner
    && now - Date.parse(metadata.started_at) >= BASE_UNCLAIMED_RETRY_DELAY_MS;
}

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
