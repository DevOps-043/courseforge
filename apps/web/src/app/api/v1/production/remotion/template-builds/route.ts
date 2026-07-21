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
    const templateVersionId = String(body.templateVersionId || "");
    if (!isUuid(templateVersionId)) {
      return NextResponse.json({ error: "templateVersionId must be a valid UUID" }, { status: 400 });
    }

    const result = await auth.service.startTemplateBuild({
      templateVersionId,
      organizationIds: auth.organizationIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    return mapWorkerError(error);
  }
}
