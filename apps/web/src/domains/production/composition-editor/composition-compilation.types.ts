export class CompositionPreviewCompilerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CompositionPreviewCompilerError";
  }
}

export class CompositionPreviewDependencyError extends CompositionPreviewCompilerError {
  constructor(message: string) {
    super(message, 500, false);
    this.name = "CompositionPreviewDependencyError";
  }
}

export const COMPOSITION_COMPILATION_TARGETS = {
  HYPERFRAMES_RENDER: "HYPERFRAMES_RENDER",
  INTERACTIVE_PREVIEW: "INTERACTIVE_PREVIEW",
} as const;
export type CompositionCompilationTarget = typeof COMPOSITION_COMPILATION_TARGETS[keyof typeof COMPOSITION_COMPILATION_TARGETS];

