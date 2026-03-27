export interface LiaMessage {
  role: string;
  content: string;
}

export interface LiaRequestPayload {
  actionResult?: string;
  computerUseMode?: boolean;
  domMap?: string;
  messages: LiaMessage[];
  screenshot?: string;
  url?: string;
}

export interface LiaActionArgs {
  [key: string]: string | number | boolean | null;
}

export interface LiaAction {
  name: string;
  args: LiaActionArgs;
}

export interface LiaGroundingSource {
  title: string;
  url: string;
}

export interface LiaGroundingChunk {
  web?: {
    title?: string;
    uri?: string;
  };
}

export interface LiaGroundingMetadata {
  groundingChunks?: LiaGroundingChunk[];
}

export interface LiaSettingsRecord {
  model_name: string;
  temperature: number;
  setting_type: "COMPUTER" | "LIA_MODEL";
  thinking_le?: string | null;
}

export interface LiaConfig {
  temperature: number;
  thinkingConfig?: {
    thinkingBudget: number;
  };
  tools?: Array<{ googleSearch: Record<string, never> }>;
}

export interface ParsedLiaResponse {
  action?: LiaAction;
  actions?: LiaAction[];
  cleanText: string;
}

export interface GeminiRestResponse {
  text: string;
  groundingMetadata?: LiaGroundingMetadata;
}
