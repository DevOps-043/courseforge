import type { SupabaseClient } from "@supabase/supabase-js";
import { COURSE_SOURCE_BUCKET, COURSE_SOURCE_LIMITS } from "./course-source-policy";
import { CourseSourceError } from "./course-source-error";
import type { SourceStorage } from "./course-source.service";

export function createSourceStorage(admin: SupabaseClient): SourceStorage {
  const bucket = admin.storage.from(COURSE_SOURCE_BUCKET);
  return {
    async sign(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (error || !data) throw new CourseSourceError(503, "No se pudo preparar la carga privada. Reintenta con la misma clave.");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async read(path, expectedBytes) {
      const { data: info, error: infoError } = await bucket.info(path);
      if (infoError || !info) throw new CourseSourceError(409, "La carga aún no está disponible. Consulta su estado antes de repetirla.");
      if (info.size !== expectedBytes || info.size > COURSE_SOURCE_LIMITS.fileBytes) {
        throw new CourseSourceError(413, "El tamaño almacenado no coincide con la reserva.");
      }
      const { data: blob, error } = await bucket.download(path);
      if (error || !blob) throw new CourseSourceError(503, "No se pudo verificar temporalmente el archivo recibido.");
      if (blob.size !== expectedBytes) throw new CourseSourceError(413, "El tamaño recibido no coincide con la reserva.");
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}
