import type {CompositionConformanceContract} from "../composition-preview-render-conformance";

export type ControlledRenderDescriptor = {
  organizationId: string;
  revisionId: string;
  executionId: string;
  documentHash: string;
  projectHash: string;
  contract: CompositionConformanceContract;
};
