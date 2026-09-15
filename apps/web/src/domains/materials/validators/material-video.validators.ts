import {
  buildVideoNarrationCharacterBudget,
  isVideoComponentType,
  videoDurationContractSchema,
} from "../../video-duration/video-duration-policy";
import {
  validateVideoDurationContent,
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
    const characterBudget = buildVideoNarrationCharacterBudget(contract);
    return [
      `- ${component.type}: objetivo editorial ${characterBudget.target} caracteres; rango objetivo obligatorio ${characterBudget.targetMinimum}-${characterBudget.targetMaximum} caracteres (±5%); límites absolutos ${characterBudget.absoluteMinimum}-${characterBudget.absoluteMaximum}; la duración efectiva y todos los timecodes se derivarán en servidor a partir de la narración; mínimo ${contract.minimumStoryboardTakes} tomas, ${contract.minimumBrollTakes} B-roll y ${contract.minimumSlideCount} diapositivas potenciales.`,
    ];
  });
  if (contracts.length === 0) return "";

  return [
    "## Guardrails técnicos de video (OBLIGATORIOS)",
    "Estas reglas no son personalizables y prevalecen ante prompts de organización antiguos o contradictorios.",
    ...contracts,
    "- Prioriza caracteres editoriales. Los presupuestos de palabras son metadatos para TTS y no gobiernan la extensión del guion.",
    "- No calcules ni ajustes la extensión del texto a partir de duration_seconds: primero escribe la narración dentro del rango objetivo.",
    "- duration_estimate_minutes, duration_seconds y los timecodes serán normalizados por el servidor desde la narración.",
    "- El storyboard debe cubrir todo el guion y usar narration_text literal en el mismo orden.",
  ].join("\n");
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
