import { NextResponse } from "next/server";
import {
  authenticateWorkerRoute,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await authenticateWorkerRoute(request);
    if (!auth) return NextResponse.json({ error: "Invalid or revoked worker token" }, { status: 401 });

    const job = await auth.service.claimNextJob(auth.worker);
    return NextResponse.json({ success: true, job });
  } catch (error) {
    return mapWorkerError(error);
  }
}

