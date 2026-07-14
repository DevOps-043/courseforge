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
    const componentId = String(body.componentId || "");
    const templateId = String(body.templateId || "");
    if (!isUuid(componentId) || !isUuid(templateId)) {
      return NextResponse.json({ error: "componentId and templateId must be valid UUIDs" }, { status: 400 });
    }

    const variables =
      body.variables && typeof body.variables === "object" && !Array.isArray(body.variables)
        ? (body.variables as Record<string, unknown>)
        : {};
    const result = await auth.service.createDesktopRenderJob({
      componentId,
      templateId,
      variables,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return mapWorkerError(error);
  }
}

