import type { ComponentType } from "../types/materials.types";

const COMPONENT_TYPE_ORDER: ComponentType[] = [
  "DIALOGUE",
  "READING",
  "QUIZ",
  "DEMO_GUIDE",
  "EXERCISE",
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
];

const COMPONENT_ORDER_INDEX = new Map(
  COMPONENT_TYPE_ORDER.map((type, index) => [type, index]),
);

type VersionedMaterialComponent = {
  type: string;
  iteration_number?: number | null;
};

function getIterationNumber(component: VersionedMaterialComponent) {
  return Number(component.iteration_number) || 0;
}

function getComponentOrder(type: string) {
  return COMPONENT_ORDER_INDEX.get(type as ComponentType) ?? Number.MAX_SAFE_INTEGER;
}

export function selectLatestComponentsByType<T extends VersionedMaterialComponent>(
  components: T[] | null | undefined,
): T[] {
  if (!Array.isArray(components) || components.length === 0) {
    return [];
  }

  const latestByType = new Map<string, T>();

  for (const component of components) {
    const existing = latestByType.get(component.type);

    if (
      !existing ||
      getIterationNumber(component) >= getIterationNumber(existing)
    ) {
      latestByType.set(component.type, component);
    }
  }

  return Array.from(latestByType.values()).sort((left, right) => {
    const orderDiff = getComponentOrder(left.type) - getComponentOrder(right.type);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    return getIterationNumber(right) - getIterationNumber(left);
  });
}
