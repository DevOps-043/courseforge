import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document-hash";
import { COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES } from "../composition-agent-policy.service";
import { COMPOSITION_AGENT_READ_TOOL_NAMES, type CompositionAgentAuthorization, type CompositionAgentScope } from "../composition-agent-read-session.service";

export const AGENT_TEST_NOW = 1_000_000;
export const AGENT_TEST_PROPOSAL_ID = "00000000-0000-4000-8000-000000000099";

export function compositionAgentFixture(assetCount = 1) {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: Array.from({ length: assetCount }, (_, index) => ({
      checksum: "d".repeat(64), durationSeconds: 4, fileSizeBytes: 4, mimeType: "video/mp4",
      productionAssetId: `00000000-0000-4000-8000-${String(index + 54).padStart(12, "0")}`,
      publicUrl: null, storageBucket: "production-assets", storagePath: `production-assets/agent-${index}.mp4`, timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#00D4B3", durationSeconds: assetCount * 4, subtitle: "Contrato local", title: "Agente" },
  });
  const scope: CompositionAgentScope = {
    documentId: "00000000-0000-4000-8000-000000000011",
    organizationId: "00000000-0000-4000-8000-000000000012",
    userId: "00000000-0000-4000-8000-000000000013",
    revision: 7,
    documentHash: hashCompositionDocument(document),
  };
  const authorization: CompositionAgentAuthorization = {
    scope: { ...scope }, expiresAtMs: AGENT_TEST_NOW + 900_000,
    tools: [...COMPOSITION_AGENT_READ_TOOL_NAMES], canSimulate: true,
    operationTypes: [...COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES],
  };
  return { document, scope, authorization, now: () => AGENT_TEST_NOW, clip: document.clips.find((clip) => clip.kind === "VIDEO")! };
}
