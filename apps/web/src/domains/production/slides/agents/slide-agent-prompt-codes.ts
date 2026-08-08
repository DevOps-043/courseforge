export const SLIDE_AGENT_PROMPT_SCOPE = "Modulos: Slides";

export const SLIDE_AGENT_PROMPT_CODES = {
  deckBrief: "SLIDES_DECK_BRIEF_AGENT",
  evidence: "SLIDES_EVIDENCE_AGENT",
  qa: "SLIDES_QA_AGENT",
  slideStrategy: "SLIDES_STRATEGY_AGENT",
  templateType: "SLIDE_TEMPLATE_TYPE_AGENT",
  visibleCopy: "SLIDES_VISIBLE_COPY_AGENT",
  visualTemplate: "SLIDES_VISUAL_TEMPLATE_AGENT",
} as const;

export type SlideAgentPromptKey = keyof typeof SLIDE_AGENT_PROMPT_CODES;

export interface SlideAgentPromptRecord {
  code: string;
  content: string;
  scope: string;
  source?: string | null;
  version: string;
}

export type SlideAgentPromptConfig = Partial<
  Record<SlideAgentPromptKey, SlideAgentPromptRecord>
>;

export interface SlideAgentModelSettingRecord {
  fallbackModel: string | null;
  modelName: string;
  scope: string;
  settingType: string;
  temperature: number;
  thinkingLevel: string | null;
}

export type SlideAgentModelConfig = Partial<
  Record<SlideAgentPromptKey, SlideAgentModelSettingRecord>
>;
