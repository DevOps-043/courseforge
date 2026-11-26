import type { DeliveryConfig } from "../types/delivery.schemas";
import type { FieldHelpSelection } from "../../../components/ui/FieldHelp";

export const deliveryModeHelp: Record<DeliveryConfig["mode"], FieldHelpSelection> = {
  NEXUS: { label: "Asíncrono", description: "Organiza lecciones para que el participante estudie a su ritmo en Academy. No requiere definir sesiones en vivo." },
  SYNCHRONOUS: { label: "Síncrono", description: "Organiza sesiones en vivo con instructor, plan y materiales de apoyo para impartir en Hub. La duración se configura por sesión." },
  HYBRID: { label: "Híbrido", description: "Combina lecciones asíncronas en Academy y sesiones en vivo en Hub. Define cómo se relacionan ambas partes para mantener un recorrido coherente." },
};
export const deliveryBalanceHelp: Record<DeliveryConfig["balance"], FieldHelpSelection> = {
  EXPLANATION: { label: "Más explicación", description: "Prioriza la explicación del instructor y el desarrollo de conceptos y ejemplos durante el taller." },
  BALANCED: { label: "Explicación y práctica", description: "Combina explicación del instructor con actividades de aplicación para los participantes." },
  PRACTICE: { label: "Más práctica", description: "Da mayor énfasis a resolver casos, practicar y revisar resultados con acompañamiento del instructor." },
};
export const deliveryApproachHelp: Record<DeliveryConfig["approach"], FieldHelpSelection> = {
  COMPLEMENTARY: { label: "Taller complementario", description: "El vivo amplía o aplica lo aprendido en las lecciones asíncronas mediante práctica, ejemplos o discusión." },
  CLASS_VERSION: { label: "Versión en vivo de la clase", description: "El taller retoma el contenido de las lecciones para trabajarlo con un instructor durante la sesión." },
};
