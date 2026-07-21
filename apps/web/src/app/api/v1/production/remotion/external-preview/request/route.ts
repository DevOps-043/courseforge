import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
  parseJsonBody,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody(request);
    const templateId = String(body.templateId || "");
    const componentId = body.componentId ? String(body.componentId) : null;

    if (!isUuid(templateId)) {
      return NextResponse.json({ error: "templateId must be a valid UUID" }, { status: 400 });
    }
    if (componentId && !isUuid(componentId)) {
      return NextResponse.json({ error: "componentId must be a valid UUID" }, { status: 400 });
    }

    const variables =
      body.variables && typeof body.variables === "object" && !Array.isArray(body.variables)
        ? (body.variables as Record<string, unknown>)
        : {};

    const result = await auth.service.requestExternalTemplatePreview({
      templateId,
      componentId,
      variables,
      organizationIds: auth.organizationIds,
      userId: auth.user.id,
    });

    return NextResponse.json({ success: true, ...result.data, previewId: result.previewId, previewStatus: result.status });
  } catch (error) {
    return mapWorkerError(error);
  }
}
