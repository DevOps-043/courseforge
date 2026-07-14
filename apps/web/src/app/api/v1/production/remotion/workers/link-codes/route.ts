import { NextResponse } from "next/server";
import {
  authenticateWorkerUser,
  isUuid,
  mapWorkerError,
  parseJsonBody,
} from "@/lib/server/desktop-worker-routes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await authenticateWorkerUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody(request);
    const organizationId = String(body.organizationId || "");
    if (!isUuid(organizationId)) {
      return NextResponse.json({ error: "organizationId must be a valid UUID" }, { status: 400 });
    }
    if (!auth.organizationIds.includes(organizationId)) {
      return NextResponse.json({ error: "Forbidden: You do not have access to this organization" }, { status: 403 });
    }

    const result = await auth.service.createLinkCode({
      organizationId,
      userId: auth.user.id,
      deviceName: body.deviceName,
      platform: body.platform,
      arch: body.arch,
      appVersion: body.appVersion,
    });

    return NextResponse.json({ success: true, code: result.code, linkCode: result.linkCode }, { status: 201 });
  } catch (error) {
    return mapWorkerError(error);
  }
}

