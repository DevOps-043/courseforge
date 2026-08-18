import type { CompositionAgentRisk } from "./composition-agent-proposal.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";

const riskRank: Record<CompositionAgentRisk["level"], number> = {
  HIGH: 3,
  LOW: 1,
  MEDIUM: 2,
};

export function classifyCompositionAgentRisk(
  operations: CompositionEditorPatchOperation[],
): CompositionAgentRisk {
  let level: CompositionAgentRisk["level"] = "LOW";
  let requiresReinforcedConfirmation = false;
  const reasons = new Set<string>();

  const raise = (nextLevel: CompositionAgentRisk["level"], reason: string) => {
    if (riskRank[nextLevel] > riskRank[level]) level = nextLevel;
    if (nextLevel === "HIGH") requiresReinforcedConfirmation = true;
    reasons.add(reason);
  };

  for (const operation of operations) {
    switch (operation.type) {
      case "clip.move":
        raise("MEDIUM", "Modifica la posición temporal o la capa de un clip.");
        break;
      case "clip.duration":
        raise("MEDIUM", "Modifica la duración visible de un clip.");
        break;
      case "clip.visibility":
        if (operation.hidden) raise("HIGH", "Oculta contenido de la composición.");
        else reasons.add("Vuelve a mostrar contenido existente.");
        break;
      case "track.update":
        if (operation.settings.hidden === true || operation.settings.muted === true) {
          raise("HIGH", "Oculta o silencia una capa completa.");
        } else {
          raise("MEDIUM", "Modifica controles persistentes de una capa.");
        }
        break;
      case "audio-mix.update":
        raise("MEDIUM", "Modifica la mezcla automática de audio.");
        break;
      case "clip.layout":
        reasons.add("Modifica únicamente el layout de un clip.");
        break;
      case "animation.add-preset":
      case "animation.update-timing":
        reasons.add("Modifica motion declarativo y reversible.");
        break;
      default:
        raise("HIGH", "Incluye una operación fuera del perfil normal del agente.");
    }
  }

  return {
    level,
    reasons: [...reasons],
    requiresConfirmation: true,
    requiresReinforcedConfirmation,
  };
}
