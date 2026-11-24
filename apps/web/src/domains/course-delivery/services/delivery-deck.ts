import { z } from "zod";
import { deliveryHash } from "../lib/delivery-hash";
import type { DeliveryWorkspace } from "../types/delivery.schemas";
import { courseDeckSpecSchema, courseSlideSpecSchema } from "../../production/slides/specs/course-deck.schema";
import { renderCourseDeckHtml } from "../../production/slides/render/html-deck-renderer.service";
import { validateCourseDeckQuality } from "../../production/slides/validation/course-deck-qa.service";
import { copyBudgetForSlideType } from "../../production/slides/content/slide-copy-policy.service";

export const SESSION_DECK_VERSION = "session-deck-v1";
const sessionDeckSchema = courseDeckSpecSchema.omit({ materialComponentId: true }).extend({
  sessionId: z.uuid(), slides: z.array(courseSlideSpecSchema).min(1).max(400),
});

export function sessionDeckIdentity(workspace: DeliveryWorkspace, sessionId: string) {
  const session = workspace.document.agenda.find(item => item.id === sessionId);
  const material = workspace.document.materials[sessionId];
  if (!session || !material) throw new Error("La sesión no tiene materiales disponibles.");
  const hash = deliveryHash({ version: SESSION_DECK_VERSION, artifactId: workspace.artifact_id,
    organizationId: workspace.organization_id, session, slides: material.slides,
    approval: workspace.document.materialsApproval });
  // UUID determinista: repetir la producción no duplica el asset ni pisa otra revisión.
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { id, hash, session, material };
}

/** Pagina sin resumir, inventar ni descartar puntos del contenido aprobado. */
function paginatePoints(points: string[]) {
  const budget = copyBudgetForSlideType("concepto");
  const pages: string[][] = [];
  let page: string[] = [];
  let length = 0;
  for (const point of points) {
    const chunks: string[] = [];
    let chunk = "";
    for (const word of point.trim().split(/\s+/)) {
      if (chunk && chunk.length + word.length + 1 > budget.maxBodyItemCharacters) {
        chunks.push(chunk); chunk = "";
      }
      chunk = chunk ? `${chunk} ${word}` : word;
    }
    if (chunk) chunks.push(chunk);
    for (const chunk of chunks) {
      const text = chunk.trim();
      if (!text) continue;
      if (page.length && (page.length === budget.maxBodyItems || length + text.length > budget.maxBodyCharacters)) {
        pages.push(page); page = []; length = 0;
      }
      page.push(text); length += text.length;
    }
  }
  if (page.length) pages.push(page);
  // Evita una última página con una frase residual cuando cabe redistribuir
  // el contenido sin superar el presupuesto ni dejar vacía la página anterior.
  const last = pages.at(-1);
  const previous = pages.at(-2);
  if (last && previous && last.join(" ").length < 60 && previous.length > 1
    && last.length < budget.maxBodyItems && previous.slice(0, -1).join(" ").length >= 60) {
    last.unshift(previous.pop()!);
  }
  return pages;
}

export function buildSessionDeck(workspace: DeliveryWorkspace, sessionId: string) {
  const identity = sessionDeckIdentity(workspace, sessionId);
  const slides = identity.material.slides.flatMap((slide, index) =>
    paginatePoints(slide.points).map((items, page) => ({
      id: `session_slide_${index + 1}_${page + 1}`, title: slide.title,
      order: 0, type: "concepto", bodyBlocks: [{ kind: "bullets", items }],
      validationHints: { sourceRefs: slide.sourceRefs },
      // Notas, soluciones y preparación nunca se serializan en el deck proyectable.
    }))).map((slide, index) => ({ ...slide, order: index + 1,
      renderHints: { layout: index % 2 === 0 ? "split" : "split_reverse" } }));
  const deck = sessionDeckSchema.parse({
    schemaVersion: "course-deck-v1", artifactId: workspace.artifact_id, sessionId,
    designSystem: {}, appearance: "light", format: "16:9", width: 1920, height: 1080,
    locale: "es", template: "course-module", slides,
    sourceSnapshot: { componentType: "SYNCHRONOUS_SESSION", source: "custom_request", title: identity.session.title },
  });
  const html = renderCourseDeckHtml(deck);
  const qa = validateCourseDeckQuality({ deckSpec: deck, html });
  return { version: SESSION_DECK_VERSION, sourceHash: identity.hash, deck, html, qa };
}

export type SessionDeckResult = {
  id: string;
  status: "READY" | "QA_FAILED";
  sourceHash: string;
  qa: ReturnType<typeof validateCourseDeckQuality>;
};
