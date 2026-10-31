import { createInitialCompositionDocument } from "../composition-document.factory";

/** Datos sintéticos generados en Node; el navegador no importa la factory de servidor. */
export function createNestedGroupsQaDocument() {
  const document = createInitialCompositionDocument({ animatedDeck: { css: "", fonts: [], width: 1920, height: 1080,
    slides: Array.from({ length: 4 }, (_, index) => ({ index, label: `Elemento ${index}`, classes: "slide", html: "<section>Prueba</section>", animationCount: 0 })) },
    assets: [], plan: { accentColor: "#38BDF8", durationSeconds: 20, title: "QA agrupaciones", subtitle: "" } });
  document.clips.forEach((clip, index) => { clip.id = `clip-${index}`; clip.hfId = `hf-${index}`; clip.startSeconds = index * 2; clip.durationSeconds = 1; });
  document.groups = [{ id: "group-a", label: "Grupo A", order: 0, clipIds: ["clip-0", "clip-1"] }, { id: "group-b", label: "Grupo B", order: 1, clipIds: ["clip-2", "clip-3"] }];
  return document;
}
