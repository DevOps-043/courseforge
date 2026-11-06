import type { SupabaseClient } from "@supabase/supabase-js";
import { readCourseSourcePolicy } from "./course-source-settings";
import { CourseSourceError } from "./course-source-error";

export function assertNoPrivateSourceReferences(payload: unknown) {
  const text = JSON.stringify(payload);
  if (
    /course-source-(?:documents|originals)|private:\/\/curation-sources|organizations\/[\w-]+\/(?:courses|curation-sources)\/|\/sources\/documents\//i.test(
      text,
    )
  ) {
    throw new CourseSourceError(
      409,
      "El paquete contiene referencias documentales privadas. Corrige el contenido antes de entregarlo.",
    );
  }
}
export async function assertCourseSourcePublication(
  admin: SupabaseClient,
  artifactId: string,
  expected?: { revision: unknown; fingerprint: unknown },
) {
  const settings = await readCourseSourcePolicy(admin, artifactId);
  if (!settings || settings.policy === "WEB_ONLY") return null;
  const { error } = await admin.rpc("assert_course_source_publication", {
    p_artifact: artifactId,
  });
  if (error)
    throw new CourseSourceError(
      409,
      "Las fuentes o sus materiales cambiaron. Revisa y aprueba sus versiones antes de producir o publicar.",
    );
  const { data: fingerprint, error: fingerprintError } = await admin.rpc(
    "course_source_generation_fingerprint",
    { p_artifact: artifactId, p_stage: "MATERIALS" },
  );
  if (fingerprintError)
    throw new CourseSourceError(
      503,
      "No se pudo verificar la vigencia documental.",
    );
  if (
    expected &&
    (expected.revision !== settings.revision ||
      expected.fingerprint !== fingerprint)
  )
    throw new CourseSourceError(
      409,
      "El paquete encolado corresponde a otra versión documental. Prepara y revisa un paquete nuevo.",
    );
  return { revision: settings.revision, fingerprint: fingerprint as string };
}
