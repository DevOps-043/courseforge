import { courseSourceHttp } from "@/domains/course-sources/course-source-http";

export async function POST(request: Request) {
  return courseSourceHttp(request, "draft");
}
