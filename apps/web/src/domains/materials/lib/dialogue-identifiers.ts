const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID_PATTERN.test(value);
}

function stableId(value: string, prefix: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug)
    throw new Error(
      `DIALOGUE_IDENTIFIER_INVALID: ${prefix} requiere un id reconocible.`,
    );
  return /^[a-z]/.test(slug) ? slug : `${prefix}_${slug}`;
}

/** A single identifier contract for generation, DoD and publication. */
export function validateDialogueIdentifiers(
  content: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const idsByGroup = new Map<string, Set<string>>();
  for (const group of ["successCriteria", "hintLadder", "rubric"]) {
    const ids = new Set<string>();
    const entries = content[group];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!isRecord(entry) || !isStableId(entry.id)) {
          errors.push(`${group} contiene ids no estables`);
          continue;
        }
        if (ids.has(entry.id))
          errors.push(`${group} contiene ids duplicados: ${entry.id}`);
        ids.add(entry.id);
      }
    }
    idsByGroup.set(group, ids);
  }
  const criterionIds = idsByGroup.get("successCriteria")!;
  if (Array.isArray(content.hintLadder)) {
    for (const hint of content.hintLadder) {
      if (
        !isRecord(hint) ||
        typeof hint.targetCriterionId !== "string" ||
        !criterionIds.has(hint.targetCriterionId)
      ) {
        errors.push("hintLadder debe apuntar a criterios existentes");
      }
    }
  }
  return [...new Set(errors)];
}

/** Normalize newly generated IDs together with their references, without mutating content.
 * Ambiguous or missing references require regeneration; never guess a learning criterion.
 */
export function normalizeGeneratedDialogueIdentifiers(
  content: Record<string, unknown>,
) {
  if (content.runtimeType !== "SOFLIA_DIALOGUE") return content;
  const normalizeGroup = (group: string, prefix: string) => {
    const entries = content[group];
    if (!Array.isArray(entries))
      return { entries, mapping: new Map<string, string>() };
    const mapping = new Map<string, string>();
    const used = new Set(
      entries
        .filter(isRecord)
        .map((entry) => entry.id)
        .filter(isStableId),
    );
    const normalized = entries.map((entry: unknown) => {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        !entry.id.trim()
      ) {
        throw new Error(
          `DIALOGUE_IDENTIFIER_INVALID: ${group} requiere ids no vacíos.`,
        );
      }
      if (mapping.has(entry.id)) {
        throw new Error(
          `DIALOGUE_IDENTIFIER_INVALID: ${group} contiene el id duplicado ${entry.id}.`,
        );
      }
      let id = entry.id;
      if (!isStableId(id)) {
        const base = stableId(id, prefix);
        id = base;
        let suffix = 2;
        while (used.has(id)) id = `${base}_${suffix++}`;
      }
      used.add(id);
      mapping.set(entry.id, id);
      return { ...entry, id };
    });
    return { entries: normalized, mapping };
  };
  const criteria = normalizeGroup("successCriteria", "criterion");
  const hints = normalizeGroup("hintLadder", "hint");
  const rubric = normalizeGroup("rubric", "rubric");
  const resolveCriterion = (target: unknown) => {
    if (typeof target !== "string" || !target.trim()) {
      throw new Error(
        "DIALOGUE_IDENTIFIER_INVALID: hintLadder requiere targetCriterionId.",
      );
    }
    const exact = criteria.mapping.get(target);
    if (exact) return exact;
    const canonical = stableId(target, "criterion");
    const matches = [...criteria.mapping].filter(
      ([original]) => stableId(original, "criterion") === canonical,
    );
    if (matches.length !== 1) {
      throw new Error(
        `DIALOGUE_IDENTIFIER_INVALID: hintLadder apunta a un criterio inexistente o ambiguo: ${target}.`,
      );
    }
    return matches[0][1];
  };
  return {
    ...content,
    successCriteria: criteria.entries,
    hintLadder: Array.isArray(hints.entries)
      ? hints.entries.map((hint: Record<string, unknown>) => ({
          ...hint,
          targetCriterionId: resolveCriterion(hint.targetCriterionId),
        }))
      : hints.entries,
    rubric: rubric.entries,
  };
}
