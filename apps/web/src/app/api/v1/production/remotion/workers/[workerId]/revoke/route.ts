import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
  parseJsonBody,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ workerId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workerId } = await context.params;
    const body = await parseJsonBody(request);
    const organizationId = String(body.organizationId || "");
    if (!isUuid(workerId) || !isUuid(organizationId)) {
      return NextResponse.json({ error: "workerId and organizationId must be valid UUIDs" }, { status: 400 });
    }
    if (!auth.organizationIds.includes(organizationId)) {
      return NextResponse.json({ error: "Forbidden: You do not have access to this organization" }, { status: 403 });
    }

    const worker = await auth.service.revokeWorker(workerId, organizationId);
    return NextResponse.json({ success: true, worker });
  } catch (error) {
    return mapWorkerError(error);
  }
}

