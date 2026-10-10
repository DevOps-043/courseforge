import { htmlReconstructionResourceRouteHandlers } from "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-resource-route.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{draftId: string; operationId: string}>};
export async function GET(request: Request, context: Context) {return htmlReconstructionResourceRouteHandlers.read(request, await context.params);}
export async function POST(request: Request, context: Context) {return htmlReconstructionResourceRouteHandlers.link(request, await context.params);}
