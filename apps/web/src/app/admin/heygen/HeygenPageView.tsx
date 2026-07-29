import HeygenStudioClient from "./HeygenStudioClient";

export default function HeygenPageView({
  organizationLabel,
}: {
  organizationLabel: string;
}) {
  return <HeygenStudioClient organizationLabel={organizationLabel} />;
}
