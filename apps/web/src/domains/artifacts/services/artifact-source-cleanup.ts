import type { SupabaseClient } from "@supabase/supabase-js";
import { COURSE_SOURCE_BUCKET } from "../../course-sources/course-source-policy";

const QUEUE = "artifact_source_storage_cleanup";
const MAX_OBJECTS_PER_RUN = 100;
const RETRY_DELAY_MS = 15 * 60 * 1000;

export async function cleanDeletedArtifactSources(admin: SupabaseClient) {
  const now = new Date();
  const cutoff = now.toISOString();
  const due = await admin.from(QUEUE).select("storage_path").lte("next_attempt_at", cutoff)
    .order("next_attempt_at").order("storage_path").limit(MAX_OBJECTS_PER_RUN);
  if (due.error) throw due.error;
  if (!due.data.length) return 0;

  // La condición se vuelve a evaluar al actualizar. Solo un ejecutor obtiene
  // cada ruta, y la reserva expira si el proceso termina antes de confirmarla.
  const claimed = await admin.from(QUEUE)
    .update({ next_attempt_at: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() })
    .in("storage_path", due.data.map(({ storage_path }) => storage_path))
    .lte("next_attempt_at", cutoff).select("storage_path");
  if (claimed.error) throw claimed.error;
  const paths = claimed.data.map(({ storage_path }) => storage_path);
  if (!paths.length) return 0;

  const removal = await admin.storage.from(COURSE_SOURCE_BUCKET).remove(paths);
  if (removal.error) throw removal.error;
  const acknowledged = await admin.from(QUEUE).delete().in("storage_path", paths);
  if (acknowledged.error) throw acknowledged.error;
  return paths.length;
}
