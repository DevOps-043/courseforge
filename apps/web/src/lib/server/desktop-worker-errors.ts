export type OutputDurationMismatchDetails = {
  expectedFrames: number;
  expectedFps: number;
  expectedDurationSeconds: number;
  receivedDurationSeconds: number;
  toleranceSeconds: number;
};

export class OutputDurationMismatchError extends Error {
  readonly code = "OUTPUT_DURATION_MISMATCH";

  constructor(readonly details: OutputDurationMismatchDetails) {
    super(
      `OUTPUT_DURATION_MISMATCH: el worker genero ${formatDuration(details.receivedDurationSeconds)}s, `
      + `pero el contrato exige ${formatDuration(details.expectedDurationSeconds)}s `
      + `(${details.expectedFrames} frames a ${details.expectedFps} fps).`,
    );
    this.name = "OutputDurationMismatchError";
  }
}

function formatDuration(value: number) {
  return Number(value.toFixed(3)).toString();
}
