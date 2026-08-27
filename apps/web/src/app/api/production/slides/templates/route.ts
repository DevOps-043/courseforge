import { NextResponse } from "next/server";
import { getSlideTemplatePackagesAction } from "@/domains/production/slides/slide-template-library.actions";

/** Browser-safe endpoint for the review panel; avoids a Server Action POST from a client-only flow. */
export async function GET() {
  const result = await getSlideTemplatePackagesAction();
  return NextResponse.json(result, { status: result.success ? 200 : 500, headers: { "Cache-Control": "private, no-store" } });
}
