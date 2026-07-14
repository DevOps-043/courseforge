import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!isUuid(organizationId)) {
      return NextResponse.json({ error: "organizationId must be a valid UUID" }, { status: 400 });
    }
    if (!auth.organizationIds.includes(organizationId)) {
      return NextResponse.json({ error: "Forbidden: You do not have access to this organization" }, { status: 403 });
    }

    const workers = await auth.service.listWorkers(organizationId);
    return NextResponse.json({ success: true, workers });
  } catch (error) {
    return mapWorkerError(error);
  }
}

