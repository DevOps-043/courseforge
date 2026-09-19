import {
  normalizeCompositionColorGrading,
  type CompositionColorGrading,
} from "./composition-color-grading.types";

export interface CompositionColorGradingControlValues {
  brightness: number;
  contrast: number;
  saturation: number;
}

export const NEUTRAL_COMPOSITION_COLOR_GRADING_CONTROLS: CompositionColorGradingControlValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

export function toCompositionColorGradingControlValues(
  colorGrading: CompositionColorGrading | null | undefined,
): CompositionColorGradingControlValues {
  const adjust = colorGrading?.adjust;
  return {
    brightness: clampControlValue((adjust?.exposure || 0) * 50),
    contrast: clampControlValue((adjust?.contrast || 0) * 100),
    saturation: clampControlValue((adjust?.saturation || 0) * 100),
  };
}

export function fromCompositionColorGradingControlValues(
  values: CompositionColorGradingControlValues,
): CompositionColorGrading | undefined {
  return normalizeCompositionColorGrading({
    adjust: {
      contrast: clampControlValue(values.contrast) / 100,
      exposure: clampControlValue(values.brightness) / 50,
      saturation: clampControlValue(values.saturation) / 100,
    },
  });
}

function clampControlValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.round(value)));
}
