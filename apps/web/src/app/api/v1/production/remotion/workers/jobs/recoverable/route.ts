import { NextResponse } from "next/server";
import {
  authenticateWorkerRoute,
  mapWorkerError,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

async function handle(request: Request) {
  try {
    const auth = await authenticateWorkerRoute(request);
    if (!auth) return NextResponse.json({ error: "Invalid or revoked worker token" }, { status: 401 });
    const result = await auth.service.listRecoverableJobs(auth.worker);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return mapWorkerError(error);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
