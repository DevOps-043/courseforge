import HeygenStudioClient from "./HeygenStudioClient";
import HeygenPlatformTools from "./HeygenPlatformTools";

export default function HeygenPageView({
  organizationLabel,
}: {
  organizationLabel: string;
}) {
  return (
    <div className="space-y-6">
      <HeygenStudioClient organizationLabel={organizationLabel} />
      <HeygenPlatformTools />
    </div>
  );
}
