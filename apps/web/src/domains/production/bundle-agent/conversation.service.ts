import { bundleAgentMessageRoleSchema, type BundleAgentAuthContext } from "./types";
import { redactSensitiveText } from "./redaction.service";

export class BundleAgentConversationService {
  constructor(private readonly context: BundleAgentAuthContext) {}

  async createConversation(input: { title?: string | null }) {
    const title = input.title?.trim() || "SofLIA Remotion bundle";
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

  async addMessage(input: { conversationId: string; role: string; content: string; metadata?: Record<string, unknown> }) {
    const role = bundleAgentMessageRoleSchema.parse(input.role);
    await this.assertConversationAccess(input.conversationId);

    const { data, error } = await this.context.admin
      .from("soflia_bundle_messages")
      .insert({
        conversation_id: input.conversationId,
        organization_id: this.context.organizationId,
        role,
        content_redacted: redactSensitiveText(input.content).slice(0, 12_000),
        metadata: input.metadata || {},
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
}
