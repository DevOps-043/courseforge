import { courseSourceHttp } from "@/domains/course-sources/course-source-http";
type Context = { params: Promise<{ artifactId: string }> };
export async function GET(request: Request, context: Context) { return courseSourceHttp(request, "legacy-list", (await context.params).artifactId); }
export async function POST(request: Request, context: Context) { return courseSourceHttp(request, "legacy-import", (await context.params).artifactId); }
