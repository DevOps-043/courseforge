import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SLIDE_AGENT_PROMPT_CODES,
  SLIDE_AGENT_PROMPT_SCOPE,
  type SlideAgentModelConfig,
  type SlideAgentModelSettingRecord,
  type SlideAgentPromptConfig,
  type SlideAgentPromptKey,
  type SlideAgentPromptRecord,
} from "./slide-agent-prompt-codes";

interface SystemPromptRow {
  code: string;
  content: string;
  organization_id: string | null;
  scope: string | null;
  source: string | null;
  version: string;
}

interface ModelSettingRow {
  fallback_model: string | null;
  model_name: string | null;
  scope: string | null;
  setting_type: string;
  temperature: number | string | null;
  thinking_level: string | null;
}

const SLIDE_AGENT_PROMPT_ENTRIES = Object.entries(SLIDE_AGENT_PROMPT_CODES) as Array<
  [SlideAgentPromptKey, string]
>;

const DEFAULT_MODEL_SETTINGS: Record<SlideAgentPromptKey, SlideAgentModelSettingRecord> = {
  deckBrief: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o-mini",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.deckBrief,
    temperature: 0.2,
    thinkingLevel: "low",
  },
  evidence: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o-mini",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.evidence,
    temperature: 0.1,
    thinkingLevel: "low",
  },
  qa: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o-mini",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.qa,
    temperature: 0.1,
    thinkingLevel: "low",
  },
  slideStrategy: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.slideStrategy,
    temperature: 0.3,
    thinkingLevel: "medium",
  },
  templateType: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.templateType,
    temperature: 0.45,
    thinkingLevel: "medium",
  },
  visibleCopy: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o-mini",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.visibleCopy,
    temperature: 0.3,
    thinkingLevel: "low",
  },
  visualTemplate: {
    fallbackModel: "gemini-2.0-flash",
    modelName: "gpt-4o",
    scope: SLIDE_AGENT_PROMPT_SCOPE,
    settingType: SLIDE_AGENT_PROMPT_CODES.visualTemplate,
    temperature: 0.5,
    thinkingLevel: "medium",
  },
};

function mapRowToPromptRecord(row: SystemPromptRow): SlideAgentPromptRecord {
  return {
    code: row.code,
    content: row.content,
    scope: row.scope || SLIDE_AGENT_PROMPT_SCOPE,
    source: row.source,
    version: row.version,
  };
}

function assignRowsToConfig(rows: SystemPromptRow[], config: SlideAgentPromptConfig) {
  const codeToKey = new Map(
    SLIDE_AGENT_PROMPT_ENTRIES.map(([key, code]) => [code, key]),
  );

  for (const row of rows) {
    const key = codeToKey.get(row.code);
    if (key && !config[key]) {
      config[key] = mapRowToPromptRecord(row);
    }
  }
}

function parseTemperature(value: ModelSettingRow["temperature"], fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function mapRowToModelSetting(
  row: ModelSettingRow,
  fallback: SlideAgentModelSettingRecord,
): SlideAgentModelSettingRecord {
  return {
    fallbackModel: row.fallback_model || fallback.fallbackModel,
    modelName: row.model_name || fallback.modelName,
    scope: row.scope || fallback.scope,
    settingType: row.setting_type,
    temperature: parseTemperature(row.temperature, fallback.temperature),
    thinkingLevel: row.thinking_level || fallback.thinkingLevel,
  };
}

function assignModelRowsToConfig(rows: ModelSettingRow[], config: SlideAgentModelConfig) {
  const codeToKey = new Map(
    SLIDE_AGENT_PROMPT_ENTRIES.map(([key, code]) => [code, key]),
  );

  for (const row of rows) {
    const key = codeToKey.get(row.setting_type);
    if (key && !config[key]) {
      config[key] = mapRowToModelSetting(row, DEFAULT_MODEL_SETTINGS[key]);
    }
  }
}

export async function resolveSlideAgentPromptConfig(
  supabase: SupabaseClient,
  organizationId?: string | null,
): Promise<SlideAgentPromptConfig> {
  const codes = SLIDE_AGENT_PROMPT_ENTRIES.map(([, code]) => code);
  const config: SlideAgentPromptConfig = {};

  if (organizationId) {
    const { data: orgRows, error: orgError } = await supabase
      .from("system_prompts")
      .select("code, content, organization_id, scope, source, version, updated_at, created_at")
      .in("code", codes)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (orgError) {
      throw orgError;
    }

    assignRowsToConfig((orgRows || []) as SystemPromptRow[], config);
  }

  const missingCodes = SLIDE_AGENT_PROMPT_ENTRIES
    .filter(([key]) => !config[key])
    .map(([, code]) => code);

  if (missingCodes.length === 0) {
    return config;
  }

  const { data: globalRows, error: globalError } = await supabase
    .from("system_prompts")
    .select("code, content, organization_id, scope, source, version, updated_at, created_at")
    .in("code", missingCodes)
    .is("organization_id", null)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (globalError) {
    throw globalError;
  }

  assignRowsToConfig((globalRows || []) as SystemPromptRow[], config);
  return config;
}

export async function resolveSlideAgentModelConfig(
  supabase: SupabaseClient,
  organizationId?: string | null,
): Promise<SlideAgentModelConfig> {
  const settingTypes = SLIDE_AGENT_PROMPT_ENTRIES.map(([, code]) => code);
  const config: SlideAgentModelConfig = {};

  if (organizationId) {
    const { data: orgRows, error: orgError } = await supabase
      .from("model_settings")
      .select("model_name, fallback_model, temperature, thinking_level, scope, setting_type")
      .in("setting_type", settingTypes)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("id", { ascending: false });

    if (orgError) {
      throw orgError;
    }

    assignModelRowsToConfig((orgRows || []) as ModelSettingRow[], config);
  }

  const missingTypes = SLIDE_AGENT_PROMPT_ENTRIES
    .filter(([key]) => !config[key])
    .map(([, code]) => code);

  if (missingTypes.length > 0) {
    const { data: globalRows, error: globalError } = await supabase
      .from("model_settings")
      .select("model_name, fallback_model, temperature, thinking_level, scope, setting_type")
      .in("setting_type", missingTypes)
      .is("organization_id", null)
      .eq("is_active", true)
      .order("id", { ascending: false });

    if (globalError) {
      throw globalError;
    }

    assignModelRowsToConfig((globalRows || []) as ModelSettingRow[], config);
  }

  for (const [key] of SLIDE_AGENT_PROMPT_ENTRIES) {
    if (!config[key]) {
      config[key] = DEFAULT_MODEL_SETTINGS[key];
    }
  }

  return config;
}
