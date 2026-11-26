import type { SupabaseClient } from "@supabase/supabase-js";
import { deliveryDocumentSchema } from "../types/delivery.schemas";
import { readDeliveryContext } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { deliveryEnabled } from "../config/delivery-enabled";
import { academyScope, assertAcademyPlans } from "../lib/academy-scope";

/** Adapta necesidades de sesión a lecciones reales, sin persistir un plan Nexus ficticio. */
export async function mergeDeliveryCurationPlan(admin: SupabaseClient, artifactId: string, nexusPlans: unknown) {
  const legacy = Array.isArray(nexusPlans) ? nexusPlans : [];
  if (!deliveryEnabled()) return legacy;
  const { data: row, error } = await admin.from("course_delivery_workspaces").select("organization_id,document").eq("artifact_id", artifactId).maybeSingle();
  if (error) throw new Error("No se pudo verificar la modalidad antes de curar.");
  if (!row) return legacy;
  const document = deliveryDocumentSchema.parse(row.document);
  if (document.config.mode === "NEXUS") return legacy;
  const context = await readDeliveryContext(admin, artifactId, row.organization_id);
  if (!deliveryReadiness(document, context).planReady) throw new Error("Aprueba el plan completo y vigente antes de buscar fuentes.");
  const needs = context.lessons.filter(lesson => document.agenda.some(session => session.coverage.some(item => item.lessonId === lesson.id)))
    .map(lesson => ({
      lesson_id: lesson.id, lesson_title: lesson.title, module_title: lesson.module, oa_text: lesson.objective,
      components: [{ type: "READING", summary: "Fundamento conceptual de sesión" }, { type: "EXERCISE", summary: "Casos, actividades y respuestas para la sesión" }],
    }));
  if (document.config.mode === "SYNCHRONOUS") return needs;
  assertAcademyPlans(academyScope(document, context.modules), legacy);
  return [...legacy.map(lesson => ({ ...lesson, components: [...(lesson.components || []), ...(needs.find(need => need.lesson_id === lesson.lesson_id)?.components || [])]
    .filter((component, index, all) => all.findIndex(candidate => candidate.type === component.type) === index) })),
    ...needs.filter(need => !legacy.some(lesson => lesson.lesson_id === need.lesson_id))];
}
