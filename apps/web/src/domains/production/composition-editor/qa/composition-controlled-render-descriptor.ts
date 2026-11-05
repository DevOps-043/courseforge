import type { CompositionConformanceContract } from "../composition-preview-render-conformance";

/** Contrato de entrada compartido sin depender del supervisor ni de sus adaptadores. */
export interface ControlledRenderDescriptor {
  organizationId: string;
  revisionId: string;
  executionId: string;
  documentHash: string;
  projectHash: string;
  contract: CompositionConformanceContract;
}
