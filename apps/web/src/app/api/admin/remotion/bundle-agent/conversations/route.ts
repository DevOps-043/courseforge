import { NextResponse } from "next/server";
import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const context = await resolveBundleAgentAuthContext();

    const service = new BundleAgentConversationService(context);
    const conversation = await service.createConversation({
      title: typeof body?.title === "string" ? body.title : null,
      templateId: typeof body?.templateId === "string" ? body.templateId : null,
    });

    return NextResponse.json({ success: true, conversation }, { status: 201 });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 400 });
  }
}
