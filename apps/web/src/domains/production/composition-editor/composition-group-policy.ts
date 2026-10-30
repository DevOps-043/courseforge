import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionGroupIndex } from "./composition-group-hierarchy";

export const COMPOSITION_GROUPING_CLIENT_HEADER = "X-Composition-Grouping-Version";

export class CompositionGroupingPolicyError extends Error {
  readonly status = 409;
  constructor(readonly code: "COMPOSITION_GROUPING_CLIENT_OUTDATED" | "COMPOSITION_NESTED_GROUPS_DISABLED") {
    super(code === "COMPOSITION_GROUPING_CLIENT_OUTDATED"
      ? "Esta versión del editor no admite agrupaciones anidadas. Recarga la página."
      : "La creación de agrupaciones anidadas está deshabilitada temporalmente.");
  }
}

export function introducesCompositionGroupEdges(before: CompositionEditorDocument, after: CompositionEditorDocument): boolean {
  const prior = buildCompositionGroupIndex(before.groups);
  return (after.groups ?? []).some(group => group.childGroupIds?.some(child => {
    // Promover un descendiente al desagrupar simplifica una relación existente.
    // Comparar únicamente aristas directas bloquearía esa operación durante rollback.
    let parent = prior.parentByGroupId.get(child);
    while (parent) {
      if (parent === group.id) return false;
      parent = prior.parentByGroupId.get(parent);
    }
    return true;
  }));
}

export function assertCompositionGroupingWrite(params: {
  before: CompositionEditorDocument;
  after: CompositionEditorDocument;
  clientVersion: string | null | undefined;
  canCreateNestedGroups: boolean;
}) {
  if ((params.before.groupingVersion === 2 || params.after.groupingVersion === 2) && params.clientVersion !== "2") {
    throw new CompositionGroupingPolicyError("COMPOSITION_GROUPING_CLIENT_OUTDATED");
  }
  if (!params.canCreateNestedGroups && introducesCompositionGroupEdges(params.before, params.after)) {
    throw new CompositionGroupingPolicyError("COMPOSITION_NESTED_GROUPS_DISABLED");
  }
}
