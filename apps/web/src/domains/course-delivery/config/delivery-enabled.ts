/** Control de despliegue solo servidor; no concede permisos de curso. */
export function deliveryEnabled(organizationId: string, environment: Record<string, string | undefined> = process.env) {
  if (environment.SYNCHRONOUS_COURSES_ENABLED !== "true") return false;
  const organizations = (environment.SYNCHRONOUS_COURSES_ORGANIZATIONS || "").split(",").map(id => id.trim()).filter(Boolean);
  return organizations.length === 0 || organizations.includes(organizationId);
}
