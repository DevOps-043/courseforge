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

    const result = await auth.service.claimNextJob(auth.worker);
    if (result && typeof result === "object" && "jobs" in result) {
      const jobs = Array.isArray((result as { jobs?: unknown }).jobs) ? (result as { jobs: unknown[] }).jobs : [];
      return NextResponse.json({ success: true, job: jobs[0] || null, jobs });
    }

    return NextResponse.json({ success: true, job: result, jobs: result ? [result] : [] });
  } catch (error) {
    return mapWorkerError(error);
  }
}
