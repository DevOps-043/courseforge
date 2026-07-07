import { NextResponse } from "next/server";
import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentConversationService(authContext);
    const data = await service.getConversation(conversationId);

    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 404 });
  }
}
