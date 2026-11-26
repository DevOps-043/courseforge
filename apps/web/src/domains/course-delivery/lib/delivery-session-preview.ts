import type { DeliveryWorkspace } from "../types/delivery.schemas";
import type { DeliveryAudience } from "../services/delivery-export";
import { buildSessionDocuments } from "../services/delivery-documents";
import { participantMaterials } from "./delivery-policy";

export interface SessionPreviewSection { title: string; body?: string; points?: string[]; reserved?: boolean }

/** Proyecta las audiencias sin HTML ni contenido reservado en la vista participante. */
export function deliverySessionPreview(workspace: DeliveryWorkspace, sessionId: string, audience: DeliveryAudience): SessionPreviewSection[] {
  const document = workspace.document;
  const session = document.agenda.find(item => item.id === sessionId);
  const material = document.materials[sessionId];
  const plan = document.plans[sessionId];
  if (!session || !material || !plan) return [];
  const publicContent = participantMaterials(material);
  if (audience === "presentation") return publicContent.slides.map(item => ({ title: item.title, points: item.points }));
  const sections: SessionPreviewSection[] = [
    { title: "Objetivos de la sesión", points: session.objectives },
    ...publicContent.concepts.map(item => ({ title: item.title, body: `${item.explanation}\n\n${item.example}` })),
    ...publicContent.activities.map(item => ({ title: item.title, body: `${item.instructions}\n\n${item.template}` })),
  ];
  if (audience === "facilitator") {
    const labels = { understand: "Qué comprender", explain: "Qué explicar", conduct: "Qué conducir", deepen: "Dónde profundizar", expand: "Cómo ampliar" };
    sections.push(...Object.entries(material.preparation).map(([key, body]) => ({ title: labels[key as keyof typeof labels], body, reserved: true })));
    sections.push(...plan.blocks.map(item => ({ title: `${item.minutes} min · ${item.purpose}`, body: [item.explanation, item.activity, ...item.resources].join("\n\n"), points: item.criteria, reserved: true })));
    sections.push(...material.concepts.filter(item => item.misconceptions.length).map(item => ({ title: `Confusiones frecuentes · ${item.title}`, points: item.misconceptions, reserved: true })));
    sections.push(...material.activities.map(item => ({ title: `Respuesta razonada · ${item.title}`, body: item.answer, points: item.criteria, reserved: true })));
    sections.push(...material.slides.filter(item => item.notes.trim()).map(item => ({ title: `Notas · ${item.title}`, body: item.notes, reserved: true })));
  }
  // El snapshot de autoría no contiene la bibliografía; se revisa en Fuentes.
  const supplemental = buildSessionDocuments(workspace, session, plan, material, { sources: [] }, { includeSources: false });
  for (const item of supplemental.filter(item => item.applicable && !["course_plan", "agenda", "session_plan", "participant_material", "presentation", "facilitator_guide", "bibliography"].includes(item.kind))) {
    sections.push(...item.participant_sections.map(section => ({ title: `${item.title} · ${section.heading}`, body: section.body })));
    if (audience === "facilitator") sections.push(...item.facilitator_sections.map(section => ({ title: `${item.title} · ${section.heading}`, body: section.body, reserved: true })));
  }
  return sections;
}
