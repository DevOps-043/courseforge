import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { BundleAgentWorkflowService } from "@/domains/production/bundle-agent/workflow.service";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const authContext = await resolveBundleAgentAuthContext();
    const service = new BundleAgentWorkflowService(authContext);
    const result = await service.generateVersion(conversationId, {
      specId: typeof body?.specId === "string" ? body.specId : null,
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 400 });
  }
}
