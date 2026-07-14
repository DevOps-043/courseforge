import { NextResponse } from "next/server";
import { mapWorkerError, parseJsonBody } from "@/lib/server/desktop-worker-routes";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const code = String(body.code || "");
    if (!code.trim()) return NextResponse.json({ error: "code is required" }, { status: 400 });

    const result = await new DesktopWorkerControlPlane().consumeLinkCode({
      code,
      deviceName: body.deviceName,
      platform: body.platform,
      arch: body.arch,
      appVersion: body.appVersion,
    });

    return NextResponse.json({ success: true, worker: result.worker, workerToken: result.workerToken }, { status: 201 });
  } catch (error) {
    return mapWorkerError(error);
  }
}
