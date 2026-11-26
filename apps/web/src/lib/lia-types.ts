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

export interface LiaSettingsRecord {
  model_name: string;
  temperature: number;
  setting_type: "COMPUTER" | "LIA_MODEL";
  fallback_model?: string | null;
  thinking_level?: string | null;
  thinking_le?: string | null;
}

export interface LiaConfig {
  fallbackModel?: string | null;
  thinkingLevel?: "low" | "medium" | "high";
  temperature: number;
  webSearch: boolean;
}

export interface ParsedLiaResponse {
  action?: LiaAction;
  actions?: LiaAction[];
  cleanText: string;
}

export interface LiaProviderResponse {
  text: string;
  sources: LiaGroundingSource[];
}
