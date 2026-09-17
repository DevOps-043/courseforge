const PROFILE_TIME_ZONE = "America/Mexico_City";

function isValidDateValue(value?: string | null): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function resolveMemberSinceDate({
  localCreatedAt,
  sofliaCreatedAt,
}: {
  localCreatedAt?: string | null;
  sofliaCreatedAt?: string | null;
}) {
  if (isValidDateValue(sofliaCreatedAt)) return sofliaCreatedAt;
  if (isValidDateValue(localCreatedAt)) return localCreatedAt;
  return null;
}

export function formatMemberSinceDate(value?: string | null) {
  if (!isValidDateValue(value)) return null;

  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: PROFILE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(value));
}
