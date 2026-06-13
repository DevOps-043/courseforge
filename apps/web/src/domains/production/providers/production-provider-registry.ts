import {
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  type ProductionJobType,
  type ProductionProvider,
} from "../types/production.types";

interface ProductionProviderDefinition {
  jobTypes: ProductionJobType[];
  key: ProductionProvider;
  name: string;
}

const PROVIDERS: ProductionProviderDefinition[] = [
  {
    key: PRODUCTION_PROVIDERS.GEMINI,
    name: "Gemini",
    jobTypes: [PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION],
  },
  {
    key: PRODUCTION_PROVIDERS.MANUAL,
    name: "Manual Upload/Link",
    jobTypes: [],
  },
];

export function getProductionProvider(provider: ProductionProvider) {
  return PROVIDERS.find((entry) => entry.key === provider) || null;
}

export function assertProviderSupportsJobType(
  provider: ProductionProvider,
  jobType: ProductionJobType,
) {
  const definition = getProductionProvider(provider);

  if (!definition) {
    throw new Error(`Proveedor de produccion no registrado: ${provider}`);
  }

  if (!definition.jobTypes.includes(jobType)) {
    throw new Error(
      `El proveedor ${provider} no soporta el job de produccion ${jobType}`,
    );
  }

  return definition;
}
