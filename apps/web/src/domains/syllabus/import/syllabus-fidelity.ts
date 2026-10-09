import type { SyllabusModule } from "../types/syllabus.types";
import {
  enrichmentSchema,
  importOutlineSchema,
  type Enrichment,
  type ExpansionProposal,
  type ImportOutline,
} from "./syllabus-import.schema";

function comparableText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}

export function verifyExtractedOutline(
  outline: ImportOutline,
  sourceText: string,
) {
  const source = comparableText(sourceText);
  const issues: string[] = [];
  for (const module of outline) {
    for (const element of [module, ...module.lessons]) {
      const quote = comparableText(element.sourceQuote);
      if (
        !quote ||
        !source.includes(quote) ||
        !quote.includes(comparableText(element.title))
      ) {
        issues.push(
          `No se pudo verificar la procedencia de «${element.title}». Revisa este elemento contra el documento.`,
        );
      }
    }
  }
  return issues;
}

export function assertConfirmableOutline(outline: ImportOutline) {
  importOutlineSchema.parse(outline);
  if (!outline.length || outline.some((module) => !module.lessons.length)) {
    throw new Error(
      "Define al menos un módulo y una lección por módulo antes de confirmar.",
    );
  }
}

export function applyEnrichment(
  outline: ImportOutline,
  input: Enrichment,
): SyllabusModule[] {
  const patches = enrichmentSchema.parse(input);
  const moduleIds = new Set(outline.map((module) => module.id));
  const lessonIds = new Set(
    outline.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
  );
  const ensureUniqueKnownIds = (
    entries: { id: string }[],
    known: Set<string>,
  ) => {
    if (
      new Set(entries.map((entry) => entry.id)).size !== entries.length ||
      entries.some((entry) => !known.has(entry.id))
    ) {
      throw new Error(
        "El enriquecimiento contiene identificadores desconocidos o repetidos.",
      );
    }
  };
  ensureUniqueKnownIds(patches.modules, moduleIds);
  ensureUniqueKnownIds(patches.lessons, lessonIds);
  const modulesById = new Map(
    patches.modules.map((entry) => [entry.id, entry]),
  );
  const lessonsById = new Map(
    patches.lessons.map((entry) => [entry.id, entry]),
  );
  return outline.map((module) => {
    const modulePatch = modulesById.get(module.id);
    if (
      module.objective_general_ref &&
      modulePatch &&
      modulePatch.objective_general_ref !== module.objective_general_ref
    ) {
      throw new Error("La IA intentó reemplazar un objetivo proporcionado.");
    }
    return {
      id: module.id,
      title: module.title,
      objective_general_ref:
        module.objective_general_ref ||
        modulePatch?.objective_general_ref ||
        "",
      lessons: module.lessons.map((lesson) => {
        const patch = lessonsById.get(lesson.id);
        if (
          lesson.objective_specific &&
          patch &&
          patch.objective_specific !== lesson.objective_specific
        ) {
          throw new Error(
            "La IA intentó reemplazar un objetivo proporcionado.",
          );
        }
        return {
          id: lesson.id,
          title: lesson.title,
          topics: [...lesson.topics],
          objective_specific:
            lesson.objective_specific || patch?.objective_specific || "",
        };
      }),
    };
  });
}

export function getFidelityIssues(
  baseline: ImportOutline,
  modules: SyllabusModule[],
) {
  const issues: string[] = [];
  if (baseline.length !== modules.length)
    issues.push("Cambió la cantidad de módulos confirmados.");
  baseline.forEach((original, index) => {
    const module = modules[index];
    if (
      !module ||
      module.id !== original.id ||
      module.title !== original.title
    ) {
      issues.push(
        `Cambió la identidad, el título o el orden del módulo ${index + 1}.`,
      );
      return;
    }
    if (
      original.objective_general_ref &&
      module.objective_general_ref !== original.objective_general_ref
    )
      issues.push("Cambió un objetivo general explícito.");
    if (module.lessons.length !== original.lessons.length)
      issues.push(`Cambió la cantidad de lecciones de «${original.title}».`);
    original.lessons.forEach((lesson, lessonIndex) => {
      const result = module.lessons[lessonIndex];
      if (
        !result ||
        result.id !== lesson.id ||
        result.title !== lesson.title ||
        JSON.stringify(result.topics || []) !== JSON.stringify(lesson.topics)
      ) {
        issues.push(
          `Cambió la identidad, título, temas u orden de «${lesson.title}».`,
        );
      } else if (
        lesson.objective_specific &&
        result.objective_specific !== lesson.objective_specific
      ) {
        issues.push(`Cambió el objetivo explícito de «${lesson.title}».`);
      }
    });
  });
  return issues;
}

export function acceptExpansions(
  outline: ImportOutline,
  proposals: ExpansionProposal[],
  acceptedIds: string[],
): ImportOutline {
  if (
    new Set(acceptedIds).size !== acceptedIds.length ||
    acceptedIds.some((id) => !proposals.some((proposal) => proposal.id === id))
  ) {
    throw new Error(
      "La decisión contiene propuestas desconocidas o repetidas.",
    );
  }
  const result = structuredClone(outline);
  // Reverse insertion preserves the order of proposals sharing the same anchor.
  for (const proposal of [...proposals]
    .reverse()
    .filter((proposal) => acceptedIds.includes(proposal.id))) {
    const module = result.find((entry) => entry.id === proposal.moduleId);
    const anchor =
      proposal.afterLessonId === null
        ? -1
        : module?.lessons.findIndex(
            (lesson) => lesson.id === proposal.afterLessonId,
          );
    if (
      !module ||
      anchor === undefined ||
      (proposal.afterLessonId !== null && anchor < 0)
    )
      throw new Error("La propuesta tiene una ubicación inválida.");
    module.lessons.splice(anchor + 1, 0, {
      id: proposal.id,
      title: proposal.title,
      objective_specific: proposal.objective_specific,
      topics: proposal.topics,
      sourceQuote: "",
    });
  }
  return importOutlineSchema.parse(result);
}
