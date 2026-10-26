import { participantMaterials } from "../lib/delivery-policy";
import { deliveryHash } from "../lib/delivery-hash";
import type { DeliveryWorkspace } from "../types/delivery.schemas";
import type { DeliveryContext } from "./delivery-repository";

export type DeliveryAudience = "participant" | "facilitator" | "presentation";
export function escapeDeliveryHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
const paragraph = (text: string) => `<p>${escapeDeliveryHtml(text)}</p>`;
const heading = (text: string) => `<h2>${escapeDeliveryHtml(text)}</h2>`;
const list = (items: string[]) => `<ul>${items.map(item => `<li>${escapeDeliveryHtml(item)}</li>`).join("")}</ul>`;
export function renderDeliveryExport(workspace: DeliveryWorkspace, context: DeliveryContext, audience: DeliveryAudience, draft = false) {
  const document = workspace.document;
  const usedRefs = new Set<string>();
  const body = document.agenda.map((session, index) => {
    const material = document.materials[session.id];
    const plan = document.plans[session.id];
    if (!material || !plan) return `<section>${heading(session.title)}${paragraph("Contenido pendiente de generar.")}</section>`;
    const publicContent = participantMaterials(material);
    const relevant = audience === "participant" ? publicContent : material;
    [...relevant.concepts, ...relevant.activities, ...relevant.slides].forEach(item => item.sourceRefs.forEach(ref => usedRefs.add(ref)));
    const slides = publicContent.slides.map((slide, position) => `<article class="slide">${heading(slide.title)}${list(slide.points)}${audience === "presentation" ? `<details class="notes"><summary>Notas del facilitador</summary>${paragraph(material.slides[position].notes)}</details>` : ""}</article>`).join("");
    if (audience === "presentation") return `<section>${heading(`${index + 1}. ${session.title}`)}${slides}</section>`;
    const concepts = relevant.concepts.map(concept => `${heading(concept.title)}${paragraph(concept.explanation)}${paragraph(concept.example)}`).join("");
    const activities = material.activities.map(activity => `<article>${heading(activity.title)}${paragraph(activity.instructions)}${paragraph(activity.template)}${audience === "facilitator" ? `${heading("Respuesta razonada")}${paragraph(activity.answer)}${list(activity.criteria)}` : ""}</article>`).join("");
    const preparation = audience === "facilitator" ? [
      ["Qué comprender", material.preparation.understand], ["Qué explicar", material.preparation.explain],
      ["Qué conducir", material.preparation.conduct], ["Dónde profundizar", material.preparation.deepen], ["Cómo ampliar", material.preparation.expand],
    ].map(([title, text]) => heading(title) + paragraph(text)).join("") : "";
    const agenda = audience === "facilitator" ? plan.blocks.map(block => `${heading(`${block.minutes} min · ${block.purpose}`)}${paragraph(block.explanation)}${paragraph(block.activity)}${list(block.criteria)}`).join("") : "";
    return `<section>${heading(`${index + 1}. ${session.title} · ${session.minutes} min`)}${list(session.objectives)}${preparation}${agenda}${concepts}${activities}</section>`;
  }).join("");
  const sources = context.sources.filter(source => usedRefs.has(source.id)).map(source => {
    let link = "";
    try { const url = new URL(source.reference); if (url.protocol === "https:" && !url.search && !url.username && !url.password) link = ` <a href="${escapeDeliveryHtml(url.href)}" rel="noreferrer">${escapeDeliveryHtml(url.hostname)}</a>`; } catch { /* PDF privado: conservar título, no ruta interna. */ }
    return `<li>${escapeDeliveryHtml(source.title || "Fuente aprobada")}${link}</li>`;
  }).join("");
  const projected = audience === "participant"
    ? document.agenda.map(session => document.materials[session.id] ? participantMaterials(document.materials[session.id]) : null)
    : document.agenda.map(session => document.materials[session.id] || null);
  const manifest = { course: workspace.artifact_id, revision: workspace.revision, audience, syllabus: context.syllabusHash, content: deliveryHash(projected), draft };
  const title = audience === "participant" ? "Material del participante" : audience === "facilitator" ? "Guía del facilitador" : "Presentación";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeDeliveryHtml(title)}</title>
<meta name="course-delivery-manifest" content="${escapeDeliveryHtml(JSON.stringify(manifest))}">
<style>body{font:17px/1.6 system-ui,sans-serif;color:#172b3a;background:#edf3f6;margin:0}main{max-width:1000px;margin:24px auto;padding:32px;background:white}h1,h2{line-height:1.2;color:#075c70}h2{margin-top:28px;font-size:1.35em}section{border-top:2px solid #bddbe1;margin-top:32px;padding-top:16px}p{white-space:pre-wrap;overflow-wrap:anywhere}.slide{min-height:360px;padding:32px;margin:24px 0;border:1px solid #bfd3dc;border-radius:16px}.slide li{font-size:1.3em;margin:15px 0}.notes{font-size:.9em;color:#374151}footer{font-size:12px;overflow-wrap:anywhere}@media print{body{background:white}main{margin:0;padding:0;max-width:none}.slide{break-after:page;border:none}article,li{break-inside:avoid}details.notes{display:none}h2{break-after:avoid}}</style></head><body><main>
<h1>${escapeDeliveryHtml(context.title)}</h1><p>${title}${draft ? " · BORRADOR SIN APROBAR" : ""}</p>
<nav><h2>Sesiones</h2>${list(document.agenda.map(session => `${session.title} · ${session.minutes} min`))}</nav>
${body}<section>${heading("Fuentes aprobadas")}<ul>${sources}</ul></section>
<footer>Revisión ${workspace.revision} · ${title}</footer></main></body></html>`;
}
