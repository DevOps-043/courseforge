import { buildControlledBundleZip } from "./generation.service";
import { sanitizeErrorMessage } from "./redaction.service";
import { computeSpecHash, stableJsonHash } from "./spec.service";
import { validateGeneratedRemotionBundle } from "./security-validator";
import { bundleAgentSpecSchema, type BundleAgentAuthContext, type BundleAgentSpec } from "./types";
import { generateBundleSpecWithAi } from "./ai-spec.service";
import { createTemplateVersionRecord } from "@/domains/production/templates/template-version.service";
import {
  DEFAULT_TEMPLATE_RENDER_CONFIG,
  createTemplateConfigSchemaDefinition,
  parseTemplateRenderConfig,
} from "@/remotion/template-config";

const ACTIVE_CONVERSATION_LIMIT = 25;
const HOURLY_GENERATION_LIMIT = 12;

function getSpecAccentColor(spec: BundleAgentSpec) {
  const value = spec.defaultProps.accentColor;
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : DEFAULT_TEMPLATE_RENDER_CONFIG.accentColor;
}

function shouldRefreshDefaultAgentConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }

  const record = value as Record<string, unknown>;
  return record.accentColor === DEFAULT_TEMPLATE_RENDER_CONFIG.accentColor;
}

export class BundleAgentWorkflowService {
  constructor(private readonly context: BundleAgentAuthContext) {}

  async createSpec(conversationId: string, overrides?: unknown) {
    const conversation = await this.getConversation(conversationId);
    const { data: messages } = await this.context.admin
      .from("soflia_bundle_messages")
      .select("role, content_redacted, metadata")
      .eq("conversation_id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .order("created_at", { ascending: true });

    const generated = await generateBundleSpecWithAi({
      organizationId: this.context.organizationId,
      title: conversation.title,
      messages: messages || [],
    });
    const spec = bundleAgentSpecSchema.parse({
      ...generated.spec,
      ...(overrides && typeof overrides === "object" ? overrides : {}),
    });
    const specHash = computeSpecHash(spec);
    const { data: latest } = await this.context.admin
      .from("soflia_bundle_specs")
      .select("version_number")
      .eq("conversation_id", conversationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await this.context.admin
      .from("soflia_bundle_specs")
      .insert({
        conversation_id: conversationId,
        organization_id: this.context.organizationId,
        version_number: latest ? latest.version_number + 1 : 1,
        spec_json: spec,
        spec_hash: specHash,
        created_by: this.context.userId,
      })
      .select("*")
      .single();

    if (error) throw error;

    await this.context.admin
      .from("soflia_bundle_messages")
      .insert({
        conversation_id: conversationId,
        organization_id: this.context.organizationId,
        role: "TOOL",
        content_redacted: generated.source === "openai"
          ? "Spec estructurada generada por SofLIA con OpenAI y validada por contrato."
          : generated.source === "gemini"
            ? "Spec estructurada generada por SofLIA con Gemini y validada por contrato."
            : "Spec estructurada generada con fallback deterministico y validada por contrato.",
        metadata: {
          source: generated.source,
          model: generated.model,
          warning: generated.warning,
          specId: data.id,
          specHash,
        },
        created_by: this.context.userId,
      });

    await this.context.admin
      .from("soflia_bundle_conversations")
      .update({ status: "READY_FOR_GENERATION", updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", this.context.organizationId);

    return data;
  }

  async generateVersion(conversationId: string, input: { specId?: string | null } = {}) {
    await this.enforceGenerationLimit();
    const conversation = await this.getConversation(conversationId);
    let specRow = input.specId
      ? await this.getSpec(input.specId, conversationId)
      : await this.getLatestSpec(conversationId);
    if (!input.specId && (!specRow || await this.hasUserMessagesAfterSpec(conversationId, specRow.created_at))) {
      specRow = await this.createSpec(conversationId);
    }
    if (!specRow) {
      throw new Error("No hay spec disponible para generar el bundle.");
    }

    const spec = bundleAgentSpecSchema.parse(specRow.spec_json);
    const templateId = conversation.template_id || (await this.createPrimaryTemplate(conversationId, spec));
    await this.refreshAgentTemplateDefaultConfig(templateId, spec);
    const run = await this.createGenerationRun(conversationId, specRow.id, templateId, spec);

    try {
      await this.context.admin
        .from("soflia_bundle_conversations")
        .update({ status: "GENERATING", updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("organization_id", this.context.organizationId);

      const bundle = await buildControlledBundleZip(spec);
      const validationReport = await validateGeneratedRemotionBundle(bundle.buffer, bundle.originalFileName);
      const storagePath = await this.uploadBundle(templateId, run.id, bundle.originalFileName, bundle.buffer);
      const parentTemplateVersionId = await this.getLatestTemplateVersionId(templateId);
      const { version } = await createTemplateVersionRecord({
        admin: this.context.admin,
        activeOrgId: this.context.organizationId,
        userId: this.context.userId,
        templateId,
        storagePath,
        originalFileName: bundle.originalFileName,
        bundleBuffer: bundle.buffer,
        validationReport,
      });

      await this.context.admin
        .from("soflia_bundle_generation_runs")
        .update({
          status: validationReport.isValid ? "SUBMITTED_FOR_REVIEW" : "VALIDATION_FAILED",
          output_hash: bundle.hash,
          bundle_storage_path: storagePath,
          validation_report: validationReport,
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("organization_id", this.context.organizationId);

      await this.context.admin
        .from("soflia_bundle_version_links")
        .insert({
          conversation_id: conversationId,
          organization_id: this.context.organizationId,
          generation_run_id: run.id,
          template_version_id: version.id,
          parent_template_version_id: parentTemplateVersionId,
          change_summary: spec.changeSummary,
        });

      await this.context.admin
        .from("soflia_bundle_conversations")
        .update({
          status: validationReport.isValid ? "VERSION_PENDING_REVIEW" : "FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("organization_id", this.context.organizationId);

      return { generationRunId: run.id, templateId, version, validationReport };
    } catch (error) {
      await this.context.admin
        .from("soflia_bundle_generation_runs")
        .update({
          status: "FAILED",
          error_sanitized: sanitizeErrorMessage(error),
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("organization_id", this.context.organizationId);

      await this.context.admin
        .from("soflia_bundle_conversations")
        .update({ status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("organization_id", this.context.organizationId);

      throw error;
    }
  }

  async enforceConversationLimit() {
    const { count, error } = await this.context.admin
      .from("soflia_bundle_conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.context.organizationId)
      .in("status", ["DRAFTING", "READY_FOR_GENERATION", "GENERATING", "VERSION_PENDING_REVIEW", "ACTIVE"]);

    if (error) throw error;
    if ((count || 0) >= ACTIVE_CONVERSATION_LIMIT) {
      throw new Error("La organizacion alcanzo el limite de conversaciones activas de SofLIA Bundle Agent.");
    }
  }

  private async enforceGenerationLimit() {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await this.context.admin
      .from("soflia_bundle_generation_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.context.organizationId)
      .gte("created_at", since);

    if (error) throw error;
    if ((count || 0) >= HOURLY_GENERATION_LIMIT) {
      throw new Error("La organizacion alcanzo el limite horario de generaciones de bundles.");
    }
  }

  private async getConversation(conversationId: string) {
    const { data, error } = await this.context.admin
      .from("soflia_bundle_conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Conversacion no encontrada para esta organizacion.");
    return data;
  }

  private async getSpec(specId: string, conversationId: string) {
    const { data, error } = await this.context.admin
      .from("soflia_bundle_specs")
      .select("*")
      .eq("id", specId)
      .eq("conversation_id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  private async getLatestSpec(conversationId: string) {
    const { data, error } = await this.context.admin
      .from("soflia_bundle_specs")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  private async hasUserMessagesAfterSpec(conversationId: string, specCreatedAt?: string | null) {
    if (!specCreatedAt) {
      return true;
    }

    const { count, error } = await this.context.admin
      .from("soflia_bundle_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .eq("role", "USER")
      .gt("created_at", specCreatedAt);

    if (error) throw error;
    return (count || 0) > 0;
  }

  private async createPrimaryTemplate(conversationId: string, spec: BundleAgentSpec): Promise<string> {
    const { data, error } = await this.context.admin
      .from("remotion_templates")
      .insert({
        organization_id: this.context.organizationId,
        name: spec.title,
        description: `SofLIA Bundle Agent: ${spec.description || spec.visualStyle}`,
        entry_point: "src/index.tsx",
        composition_id: "full-slides",
        is_public: false,
        storage_path: null,
        thumbnail_url: null,
        config_schema: createTemplateConfigSchemaDefinition(),
        default_config: parseTemplateRenderConfig({ accentColor: getSpecAccentColor(spec) }),
        bundle_status: "NOT_APPLICABLE",
      })
      .select("id")
      .single();

    if (error) throw error;

    await this.context.admin
      .from("soflia_bundle_conversations")
      .update({ template_id: data.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", this.context.organizationId)
      .is("template_id", null);

    return data.id;
  }

  private async refreshAgentTemplateDefaultConfig(templateId: string, spec: BundleAgentSpec) {
    const { data } = await this.context.admin
      .from("remotion_templates")
      .select("default_config")
      .eq("id", templateId)
      .eq("organization_id", this.context.organizationId)
      .maybeSingle();

    if (!shouldRefreshDefaultAgentConfig(data?.default_config)) {
      return;
    }

    await this.context.admin
      .from("remotion_templates")
      .update({
        default_config: parseTemplateRenderConfig({
          ...(data?.default_config || {}),
          accentColor: getSpecAccentColor(spec),
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId)
      .eq("organization_id", this.context.organizationId);
  }

  private async createGenerationRun(
    conversationId: string,
    specId: string,
    templateId: string,
    spec: BundleAgentSpec,
  ) {
    const { data, error } = await this.context.admin
      .from("soflia_bundle_generation_runs")
      .insert({
        conversation_id: conversationId,
        organization_id: this.context.organizationId,
        spec_id: specId,
        template_id: templateId,
        status: "RUNNING",
        model: "courseforge-controlled-template-v1",
        input_hash: stableJsonHash(spec),
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  private async uploadBundle(
    templateId: string,
    runId: string,
    originalFileName: string,
    buffer: ArrayBuffer,
  ): Promise<string> {
    const safeFileName = originalFileName.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `organizations/${this.context.organizationId}/templates/${templateId}/agent-runs/${runId}/${safeFileName}`;
    const { error } = await this.context.admin.storage
      .from("template-bundles")
      .upload(path, Buffer.from(buffer), {
        contentType: "application/zip",
        upsert: false,
      });

    if (error) throw error;
    return `template-bundles/${path}`;
  }

  private async getLatestTemplateVersionId(templateId: string): Promise<string | null> {
    const { data } = await this.context.admin
      .from("remotion_template_versions")
      .select("id")
      .eq("template_id", templateId)
      .eq("organization_id", this.context.organizationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.id || null;
  }
}
