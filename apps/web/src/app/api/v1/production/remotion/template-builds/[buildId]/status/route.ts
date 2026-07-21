import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ buildId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { buildId } = await context.params;
    if (!isUuid(buildId)) {
      return NextResponse.json({ error: "buildId must be a valid UUID" }, { status: 400 });
    }

    const result = await auth.service.getTemplateBuildStatus(buildId, auth.organizationIds);
    return NextResponse.json(result);
  } catch (error) {
    return mapWorkerError(error);
  }
}
