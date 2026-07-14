import { NextResponse } from "next/server";
import {
  authenticateWorkerRoute,
  isUuid,
  mapWorkerError,
  parseJsonBody,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateWorkerRoute(request);
    if (!auth) return NextResponse.json({ error: "Invalid or revoked worker token" }, { status: 401 });
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return NextResponse.json({ error: "jobId must be a valid UUID" }, { status: 400 });
    const body = await parseJsonBody(request);
    const result = await auth.service.completeJob(auth.worker, jobId, {
      outputStoragePath: String(body.outputStoragePath || ""),
      checksum: typeof body.checksum === "string" ? body.checksum : undefined,
      durationSeconds: Number(body.durationSeconds),
      logsRef: typeof body.logsRef === "string" ? body.logsRef : undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return mapWorkerError(error);
  }
}

