import { courseSourceHttp } from "@/domains/course-sources/course-source-http";

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  return courseSourceHttp(request, "list", (await context.params).artifactId);
}
