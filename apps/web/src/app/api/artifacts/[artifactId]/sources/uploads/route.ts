import { courseSourceHttp } from "@/domains/course-sources/course-source-http";

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  return courseSourceHttp(request, "reserve", (await context.params).artifactId);
}
