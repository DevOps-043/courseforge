import { NextResponse } from "next/server";
import { buildExternalAuthorBundleBaseZip } from "@/domains/production/bundle-agent/generation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentRouteErrorResponse } from "@/domains/production/bundle-agent/route-contract";
import {
  buildSlideTemplatePackageZip,
  buildSlideTemplateSpecFromConversation,
} from "@/domains/production/bundle-agent/slide-template-package.service";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
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

    return new NextResponse(bundle.buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${bundle.originalFileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return bundleAgentRouteErrorResponse({ component: "admin.bundle-agent.base-bundle", error, requestId });
  }
}
