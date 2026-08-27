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
    key: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
    name: "SofLIA - Engine Slides",
    jobTypes: [
      PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
      PRODUCTION_JOB_TYPES.SLIDE_DECK_EXPORT,
      PRODUCTION_JOB_TYPES.SLIDE_DECK_PREPARE,
    ],
  },
  {
    key: PRODUCTION_PROVIDERS.GEMINI,
    name: "Gemini",
    jobTypes: [PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION],
  },
  {
    key: PRODUCTION_PROVIDERS.OPENAI,
    name: "OpenAI GPT Image",
    jobTypes: [
      PRODUCTION_JOB_TYPES.SLIDE_BACKGROUND_GENERATION,
      PRODUCTION_JOB_TYPES.SLIDE_SUPPORTING_IMAGE_GENERATION,
    ],
  },
  {
    key: PRODUCTION_PROVIDERS.MANUAL,
    name: "Manual Upload/Link",
    jobTypes: [],
  },
  {
    key: PRODUCTION_PROVIDERS.HEYGEN,
    name: "HeyGen",
    jobTypes: [
      PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
      PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
      PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
    ],
  },
  {
    key: PRODUCTION_PROVIDERS.HYPERFRAMES,
    name: "HyperFrames Cloud",
    jobTypes: [PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER],
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
