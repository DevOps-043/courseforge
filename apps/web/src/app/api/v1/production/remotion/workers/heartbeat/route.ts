import { NextResponse } from "next/server";
import {
  authenticateWorkerRoute,
  mapWorkerError,
  parseJsonBody,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await authenticateWorkerRoute(request);
    if (!auth) return NextResponse.json({ error: "Invalid or revoked worker token" }, { status: 401 });

    const worker = await auth.service.heartbeat(auth.worker, await parseJsonBody(request));
    return NextResponse.json({ success: true, worker });
  } catch (error) {
    return mapWorkerError(error);
  }
}

