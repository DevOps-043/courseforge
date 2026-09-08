import {
  isVideoComponentType,
  videoDurationContractSchema,
} from "../../video-duration/video-duration-policy";
import { validateVideoDurationContent } from "../../video-duration/video-duration-validation";

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
