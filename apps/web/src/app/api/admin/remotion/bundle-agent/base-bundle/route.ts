import { NextResponse } from "next/server";
import { buildExternalAuthorBundleBaseZip } from "@/domains/production/bundle-agent/generation.service";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";

export async function GET() {
  try {
    await resolveBundleAgentAuthContext();
    const bundle = await buildExternalAuthorBundleBaseZip();

    return new NextResponse(Buffer.from(bundle.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${bundle.originalFileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 400 });
  }
}
