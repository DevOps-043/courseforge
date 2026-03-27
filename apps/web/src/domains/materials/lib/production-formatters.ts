export function buildStoryOverview(content: any): string {
  const title = content.title || content.script?.title || "Presentacion";
  const duration =
    content.duration_estimate_minutes ||
    content.script?.duration_estimate_minutes ||
    5;
  const script = content.script as { sections?: any[] } | undefined;
  const storyboard = content.storyboard as any[] | undefined;

  let objective = "";
  if (script?.sections?.length) {
    const introSection = script.sections.find(
      (section: any) =>
        section.section_type === "intro" || section.section_number === 1,
    );
    if (introSection?.narration_text) {
      const sentences = introSection.narration_text
        .split(/[.!?]+/)
        .filter((sentence: string) => sentence.trim());
      objective = sentences.slice(0, 2).join(". ").trim();
      if (objective && !objective.endsWith(".")) {
        objective += ".";
      }
    }
  }

  return `STORY OVERVIEW
--------------------------------------------------
Titulo: ${title}
Duracion estimada: ${duration} minutos
Total de slides: ${storyboard?.length || script?.sections?.length || "N/A"}
${objective ? `\nObjetivo: ${objective}` : ""}
--------------------------------------------------`;
}

export function formatGammaContent(content: any): string {
  const script = content.script as { sections?: any[] } | undefined;
  const storyboard = content.storyboard as any[] | undefined;

  if (
    (!script?.sections || script.sections.length === 0) &&
    (!storyboard || storyboard.length === 0)
  ) {
    return "";
  }

  let formatted = `${buildStoryOverview(content)}

CONFIGURACION GAMMA:
- Idioma: EspaÃ±ol Latinoamericano
- IMAGENES: NO GENERAR (Usar solo texto y layouts solidos)
- Estilo: Minimalista, fuentes limpias
- Formato: Presentacion educativa

---
CONTENIDO
---

`;

  const sections = script?.sections || [];
  const storyboardItems = storyboard || [];
  const maxItems = Math.max(sections.length, storyboardItems.length);

  for (let index = 0; index < maxItems; index += 1) {
    const section = sections[index];
    const storyItem = storyboardItems[index];
    const slideNum = index + 1;
    const type = section?.section_type
      ? `[${section.section_type.toUpperCase()}]`
      : "";

    formatted += `### SLIDE ${slideNum} ${type}\n\n`;

    const text = section?.on_screen_text || storyItem?.on_screen_text || "";
    if (text) {
      formatted += `**Texto en Pantalla:**\n${text}\n\n`;
    }

    const narration =
      section?.narration_text || storyItem?.narration_text || "";
    if (narration) {
      formatted += `**Narracion (Speaker Notes):**\n${narration}\n\n`;
    }

    const visual =
      section?.visual_notes || storyItem?.visual_content || "";
    if (visual) {
      formatted += `**Contexto Visual (Referencia):**\n${visual}\n\n`;
    }

    formatted += `---\n\n`;
  }

  return formatted.trim();
}

export function getGammaEmbedUrl(url: string): string | null {
  if (!url) return null;

  const patterns = [
    /gamma\.app\/docs\/([a-zA-Z0-9-]+)/,
    /gamma\.app\/embed\/([a-zA-Z0-9-]+)/,
    /gamma\.app\/public\/([a-zA-Z0-9-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return `https://gamma.app/embed/${match[1]}`;
    }
  }

  return url.includes("gamma.app/embed/") ? url : null;
}
