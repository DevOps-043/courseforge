import { NextResponse } from "next/server";
import { buildExternalAuthorBundleBaseZip } from "@/domains/production/bundle-agent/generation.service";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import {
  buildSlideTemplatePackageZip,
  buildSlideTemplateSpecFromConversation,
} from "@/domains/production/bundle-agent/slide-template-package.service";

export async function GET(request: Request) {
  try {
    await resolveBundleAgentAuthContext();
    const url = new URL(request.url);
    const artifactKind = url.searchParams.get("artifactKind");
    const bundle = artifactKind === "slide_template"
      ? await buildSlideTemplatePackageZip(buildSlideTemplateSpecFromConversation({
          messages: [],
          title: "Plantilla SofLIA Deck Base",
        }))
      : await buildExternalAuthorBundleBaseZip();

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
