import { NextResponse } from "next/server";
import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = await request.json();
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentConversationService(authContext);
    const message = await service.addMessage({
      conversationId,
      role: typeof body?.role === "string" ? body.role : "USER",
      content: typeof body?.content === "string" ? body.content : "",
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
    });

    return NextResponse.json({ success: true, message }, { status: 201 });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 400 });
  }
}
