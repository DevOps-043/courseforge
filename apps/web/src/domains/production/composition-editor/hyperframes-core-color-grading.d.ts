declare module "@hyperframes/core/color-grading" {
  export function serializeHfColorGrading(grading: {
    adjust: {
      contrast: number;
      exposure: number;
      saturation: number;
    };
  }): string;
}
