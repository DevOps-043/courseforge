import {
  isVideoComponentType,
  VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
  videoDurationContractSchema,
  type VideoDurationContract,
} from "../../video-duration/video-duration-policy";
import {
  validateVideoDurationContent,
  type VideoDurationValidationResult,
} from "../../video-duration/video-duration-validation";

export type MaterialVideoValidationStatus = "FAIL" | "PASS" | "PENDING";

export interface MaterialVideoValidationCandidate {
  assets?: Record<string, unknown> | null;
  content?: Record<string, unknown> | null;
  type: string;
  validation_errors?: string[] | null;
  validation_status?: string | null;
}

export interface MaterialVideoValidationSnapshot {
  errors: string[];
  status: MaterialVideoValidationStatus;
}

interface VideoGenerationComponent {
  duration_contract?: unknown;
  type: string;
}

export function buildVideoGenerationGuardrails(
  components: VideoGenerationComponent[],
) {
  const contracts = components.flatMap((component) => {
    if (!isVideoComponentType(component.type)) return [];
    const parsed = videoDurationContractSchema.safeParse(component.duration_contract);
    if (!parsed.success) return [];
    const contract = parsed.data;
    const minimumCharacters = Math.round(
      (contract.minimumDurationSeconds / 60) * VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
    );
    const targetCharacters = Math.round(
      (contract.targetDurationSeconds / 60) * VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
    );
    const maximumCharacters = Math.round(
      (contract.maximumDurationSeconds / 60) * VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
    );
    return [
      `- ${component.type}: duración ${contract.minimumDurationSeconds}-${contract.maximumDurationSeconds}s; objetivo ${contract.targetDurationSeconds}s (±5s); narración ${minimumCharacters}-${maximumCharacters} caracteres, objetivo ${targetCharacters}; mínimo ${contract.minimumStoryboardTakes} tomas, ${contract.minimumBrollTakes} B-roll y ${contract.minimumSlideCount} diapositivas potenciales.`,
    ];
  });
  if (contracts.length === 0) return "";

  return [
    "## Guardrails técnicos de video (OBLIGATORIOS)",
    "Estas reglas no son personalizables y prevalecen ante prompts de organización antiguos o contradictorios.",
    ...contracts,
    "- duration_estimate_minutes debe coincidir con la suma de duration_seconds.",
    "- Los timecodes deben iniciar en 00:00, ser contiguos, no solaparse y terminar exactamente en la duración total.",
    "- El storyboard debe cubrir todo el guion y usar narration_text literal en el mismo orden.",
  ].join("\n");
}

export function buildVideoRepairInstructions(
  componentType: string,
  contract: VideoDurationContract,
  validationErrors: string[],
) {
  const targetCharacterCount = Math.round(
    (contract.targetDurationSeconds / 60) * VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
  );
  return [
    `Corrige únicamente ${componentType}.`,
    `Problemas detectados: ${validationErrors.join(" | ")}`,
    `La suma de script.sections[].duration_seconds debe ser ${contract.targetDurationSeconds}s con tolerancia máxima de 5s.`,
    `duration_estimate_minutes debe ser ${contract.targetDurationSeconds / 60}.`,
    `La narración debe aproximarse a ${targetCharacterCount} caracteres editoriales y superar el mínimo correspondiente, sin relleno ni repeticiones.`,
    `El storyboard debe incluir al menos ${contract.minimumStoryboardTakes} tomas, ${contract.minimumBrollTakes} tomas B-roll y cobertura visual suficiente para ${contract.minimumSlideCount} diapositivas potenciales.`,
    "Todos los timecodes deben iniciar en 00:00, ser contiguos, no solaparse y finalizar exactamente con el guion.",
    "Conserva información sustantiva, decisiones, estados observables, errores y verificación; no inventes datos ni interfaces.",
  ].join(" ");
}

export function shouldUseVideoRepairCandidate(
  initial: Pick<VideoDurationValidationResult, "issues" | "valid">,
  candidate: Pick<VideoDurationValidationResult, "issues" | "valid">,
) {
  if (candidate.valid) return true;
  const initialIssueCodes = new Set(initial.issues.map((issue) => issue.code));
  const introducesNewIssue = candidate.issues.some(
    (issue) => !initialIssueCodes.has(issue.code),
  );
  return !introducesNewIssue && candidate.issues.length < initial.issues.length;
}

export function validateMaterialVideoComponent(
  componentType: string,
  content: unknown,
  durationContract: unknown,
): MaterialVideoValidationSnapshot {
  if (!isVideoComponentType(componentType)) {
    return { errors: [], status: "PENDING" };
  }

  const parsedContract = videoDurationContractSchema.safeParse(durationContract);
  if (!parsedContract.success) {
    return { errors: [], status: "PENDING" };
  }

  const validation = validateVideoDurationContent(content, parsedContract.data);
  return {
    errors: validation.issues.map(
      (issue) => `${issue.code}: ${issue.message}`,
    ),
    status: validation.valid ? "PASS" : "FAIL",
  };
}

export function collectMaterialVideoValidationErrors(
  components: MaterialVideoValidationCandidate[],
) {
  return components.flatMap((component) => {
    if (!isVideoComponentType(component.type)) {
      return [];
    }

    const assets = isRecord(component.assets) ? component.assets : {};
    const validation = validateMaterialVideoComponent(
      component.type,
      component.content,
      assets.video_duration_contract,
    );
    const errors = validation.status === "PENDING" && component.validation_status === "FAIL"
      ? component.validation_errors || []
      : validation.errors;

    return errors.map((error) => `${component.type}/${error}`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
