import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId } = await context.params;
    if (!isUuid(jobId)) {
      return NextResponse.json({ error: "jobId must be a valid UUID" }, { status: 400 });
    }

    const job = await auth.service.getJobStatus(jobId, auth.organizationIds);
    return NextResponse.json(job);
  } catch (error) {
    return mapWorkerError(error);
  }
}
