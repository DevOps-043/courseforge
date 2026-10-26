import type { SupabaseClient } from "@supabase/supabase-js";
import { deliveryDocumentSchema, emptyDeliveryDocument, type DeliveryWorkspace, type DeliveryDocument } from "../types/delivery.schemas";
import { deliveryHash } from "../lib/delivery-hash";
import { curriculumLessons } from "../lib/delivery-policy";

export async function readDeliveryWorkspace(admin: SupabaseClient, artifactId: string, organizationId: string): Promise<DeliveryWorkspace> {
  const { data, error } = await admin.from("course_delivery_workspaces").select("artifact_id,organization_id,revision,document")
    .eq("artifact_id", artifactId).eq("organization_id", organizationId).maybeSingle();
  if (error) {
    // Lectura compatible antes de aplicar la migración: jamás habilita generación.
    if (process.env.SYNCHRONOUS_COURSES_ENABLED !== "true" && (error.code === "42P01" || error.code === "PGRST205")) return { artifact_id: artifactId, organization_id: organizationId, revision: 0, document: emptyDeliveryDocument() };
    throw new Error("No se pudo leer la configuración de impartición.");
  }
  return data ? { ...data, document: deliveryDocumentSchema.parse(data.document) } : { artifact_id: artifactId, organization_id: organizationId, revision: 0, document: emptyDeliveryDocument() };
}
export async function saveDeliveryWorkspace(admin: SupabaseClient, workspace: DeliveryWorkspace, document: DeliveryDocument) {
  const { data, error } = await admin.rpc("save_course_delivery", {
    p_artifact_id: workspace.artifact_id, p_organization_id: workspace.organization_id, p_revision: workspace.revision,
    p_document: deliveryDocumentSchema.parse(document),
  });
  if (error) throw new Error(error.message.includes("CONFLICT") ? "Otra persona modificó el curso. Actualiza antes de guardar." : "No se pudo guardar la configuración de impartición. Verifica la migración local requerida.");
  return data as number;
}
export async function readDeliveryContext(admin: SupabaseClient, artifactId: string, organizationId: string) {
  const [artifact, syllabus, nexus, materials, curation] = await Promise.all([
    admin.from("artifacts").select("id,organization_id,idea_central").eq("id", artifactId).eq("organization_id", organizationId).single(),
    admin.from("syllabus").select("modules,state").eq("artifact_id", artifactId).maybeSingle(),
    admin.from("instructional_plans").select("lesson_plans,state").eq("artifact_id", artifactId).maybeSingle(),
    admin.from("materials").select("*").eq("artifact_id", artifactId).maybeSingle(),
    admin.from("curation").select("id,state,qa_decision").eq("artifact_id", artifactId).maybeSingle(),
  ]);
  if ([artifact, syllabus, nexus, materials, curation].some(result => result.error) || !artifact.data) throw new Error("No se pudo verificar el contexto del curso.");
  const rows = curation.data ? await admin.from("curation_rows").select("*").eq("curation_id", curation.data.id).order("id") : { data: [], error: null };
  if (rows.error) throw new Error("No se pudieron verificar las fuentes del curso.");
  const allSources = rows.data || [];
  const sources = allSources.filter(row => row.apta === true && row.url_status === "OK" &&
    (!row.validation_report?.status || row.validation_report.status === "valid")).map(row => ({
    id: String(row.id), lessonId: String(row.lesson_id), reference: String(row.source_ref),
    title: String(row.source_title || ""), rationale: String(row.source_rationale || ""),
    evidence: row.validation_report, notes: row.notes,
  }));
  const modules = syllabus.data?.modules || [];
  return {
    title: artifact.data.idea_central || "Curso", modules, lessons: curriculumLessons(modules), syllabusApproved: syllabus.data?.state === "STEP_APPROVED",
    syllabusHash: deliveryHash(modules), nexus: nexus.data?.lesson_plans || null, nexusHash: deliveryHash(nexus.data?.lesson_plans || null),
    nexusState: nexus.data?.state, materials: materials.data, curation: curation.data, allSources, sources, sourcesHash: deliveryHash(allSources),
  };
}
export type DeliveryContext = Awaited<ReturnType<typeof readDeliveryContext>>;
