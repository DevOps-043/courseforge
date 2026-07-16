import {
  bundleAgentMessageMetadataSchema,
  bundleAgentMessageRoleSchema,
  type BundleAgentAuthContext,
} from "./types";
import { redactSensitiveText } from "./redaction.service";

const ACTIVE_CONVERSATION_LIMIT = 25;

export class BundleAgentConversationService {
  constructor(private readonly context: BundleAgentAuthContext) {}

  async createConversation(input: { title?: string | null; templateId?: string | null }) {
    if (input.templateId) {
      return this.getOrCreateConversationForTemplate({
        templateId: input.templateId,
        title: input.title,
      });
    }

    const title = input.title?.trim() || "SofLIA Remotion bundle";
    await this.enforceConversationLimit();

    const { data, error } = await this.context.admin
      .from("soflia_bundle_conversations")
      .insert({
        organization_id: this.context.organizationId,
        created_by: this.context.userId,
        title,
        status: "DRAFTING",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getOrCreateConversationForTemplate(input: { templateId: string; title?: string | null }) {
    const template = await this.assertTemplateAccess(input.templateId);

    const { data: existing, error: existingError } = await this.context.admin
      .from("soflia_bundle_conversations")
      .select("*")
      .eq("organization_id", this.context.organizationId)
      .eq("template_id", template.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return existing;

    const title = input.title?.trim() || template.name || "SofLIA Remotion bundle";
    await this.enforceConversationLimit();

    const { data, error } = await this.context.admin
      .from("soflia_bundle_conversations")
      .insert({
        organization_id: this.context.organizationId,
        created_by: this.context.userId,
        template_id: template.id,
        title,
        status: "DRAFTING",
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async addMessage(input: { conversationId: string; role: string; content: string; metadata?: Record<string, unknown> }) {
    const role = bundleAgentMessageRoleSchema.parse(input.role);
    const metadata = bundleAgentMessageMetadataSchema.parse(input.metadata || {});
    await this.assertConversationAccess(input.conversationId);

    const { data, error } = await this.context.admin
      .from("soflia_bundle_messages")
      .insert({
        conversation_id: input.conversationId,
        organization_id: this.context.organizationId,
        role,
        content_redacted: redactSensitiveText(input.content).slice(0, 12_000),
        metadata,
        created_by: this.context.userId,
      })
      .select("*")
      .single();

    if (error) throw error;

    await this.context.admin
      .from("soflia_bundle_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", input.conversationId)
      .eq("organization_id", this.context.organizationId);

    return data;
  }

  async getConversation(conversationId: string) {
    const conversation = await this.assertConversationAccess(conversationId);
    const [{ data: messages }, { data: specs }, { data: runs }, { data: links }] = await Promise.all([
      this.context.admin
        .from("soflia_bundle_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("organization_id", this.context.organizationId)
        .order("created_at", { ascending: true }),
      this.context.admin
        .from("soflia_bundle_specs")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("organization_id", this.context.organizationId)
        .order("version_number", { ascending: false }),
      this.context.admin
        .from("soflia_bundle_generation_runs")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("organization_id", this.context.organizationId)
        .order("created_at", { ascending: false }),
      this.context.admin
        .from("soflia_bundle_version_links")
        .select("*, template_version:remotion_template_versions(*)")
        .eq("conversation_id", conversationId)
        .eq("organization_id", this.context.organizationId)
        .order("created_at", { ascending: false }),
    ]);

    return {
      conversation,
      messages: messages || [],
      specs: specs || [],
      generationRuns: runs || [],
      versionLinks: links || [],
    };
  }

  async assertConversationAccess(conversationId: string) {
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

  private async enforceConversationLimit() {
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

  private async assertTemplateAccess(templateId: string) {
    const { data, error } = await this.context.admin
      .from("remotion_templates")
      .select("id, name, organization_id")
      .eq("id", templateId)
      .eq("organization_id", this.context.organizationId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Plantilla no encontrada para esta organizacion.");
    return data;
  }
}
