export const ARTIFACT_WORKFLOW_FIRST_STEP = 1;
export const ARTIFACT_WORKFLOW_LAST_STEP = 8;

export type ArtifactWorkflowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ArtifactWorkspacePreferences {
  currentStep: ArtifactWorkflowStep;
  scrollByStep: Partial<Record<ArtifactWorkflowStep, number>>;
}

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SerializedArtifactWorkspacePreferences {
  version: 1;
  currentStep: ArtifactWorkflowStep;
  scrollByStep: Partial<Record<ArtifactWorkflowStep, number>>;
}

const STORAGE_KEY_PREFIX = "courseforge:artifact-workspace:v1";

export function createDefaultArtifactWorkspacePreferences(): ArtifactWorkspacePreferences {
  return {
    currentStep: ARTIFACT_WORKFLOW_FIRST_STEP,
    scrollByStep: {},
  };
}

export function isArtifactWorkflowStep(value: unknown): value is ArtifactWorkflowStep {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ARTIFACT_WORKFLOW_FIRST_STEP &&
    value <= ARTIFACT_WORKFLOW_LAST_STEP
  );
}

export function getArtifactWorkspaceStorageKey(artifactId: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(artifactId)}`;
}

function parseScrollByStep(value: unknown): ArtifactWorkspacePreferences["scrollByStep"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const scrollByStep: ArtifactWorkspacePreferences["scrollByStep"] = {};
  for (let step = ARTIFACT_WORKFLOW_FIRST_STEP; step <= ARTIFACT_WORKFLOW_LAST_STEP; step += 1) {
    const scrollPosition = (value as Record<string, unknown>)[String(step)];
    if (typeof scrollPosition === "number" && Number.isFinite(scrollPosition) && scrollPosition >= 0) {
      scrollByStep[step as ArtifactWorkflowStep] = scrollPosition;
    }
  }

  return scrollByStep;
}

export function loadArtifactWorkspacePreferences(
  storage: StorageAdapter,
  artifactId: string,
): ArtifactWorkspacePreferences {
  try {
    const serialized = storage.getItem(getArtifactWorkspaceStorageKey(artifactId));
    if (!serialized) return createDefaultArtifactWorkspacePreferences();

    const parsed = JSON.parse(serialized) as Partial<SerializedArtifactWorkspacePreferences>;
    if (parsed.version !== 1 || !isArtifactWorkflowStep(parsed.currentStep)) {
      return createDefaultArtifactWorkspacePreferences();
    }

    return {
      currentStep: parsed.currentStep,
      scrollByStep: parseScrollByStep(parsed.scrollByStep),
    };
  } catch {
    return createDefaultArtifactWorkspacePreferences();
  }
}

export function saveArtifactWorkspacePreferences(
  storage: StorageAdapter,
  artifactId: string,
  preferences: ArtifactWorkspacePreferences,
): void {
  const serialized: SerializedArtifactWorkspacePreferences = {
    version: 1,
    currentStep: preferences.currentStep,
    scrollByStep: parseScrollByStep(preferences.scrollByStep),
  };

  try {
    storage.setItem(getArtifactWorkspaceStorageKey(artifactId), JSON.stringify(serialized));
  } catch {
    // Navigation must remain usable when storage is unavailable or its quota is full.
  }
}

export function resolveRestoredArtifactWorkflowStep(
  preferences: ArtifactWorkspacePreferences,
  canAccessStep: (step: ArtifactWorkflowStep) => boolean,
): ArtifactWorkflowStep {
  return canAccessStep(preferences.currentStep)
    ? preferences.currentStep
    : ARTIFACT_WORKFLOW_FIRST_STEP;
}
