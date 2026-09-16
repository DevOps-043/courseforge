import HeygenStudioClient from "./HeygenStudioClient";
import HeygenPlatformTools from "./HeygenPlatformTools";
import type { ProductionCourseContext } from "@/domains/production/course-context/production-course-context";

export default function HeygenPageView({
  courseContext,
  organizationLabel,
}: {
  courseContext?: ProductionCourseContext | null;
  organizationLabel: string;
}) {
  return (
    <div className="space-y-6">
      <HeygenStudioClient
        courseContext={courseContext}
        organizationLabel={organizationLabel}
      />
      <HeygenPlatformTools />
    </div>
  );
}
