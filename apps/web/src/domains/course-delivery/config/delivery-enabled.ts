/** Control de despliegue solo servidor; no concede permisos de curso. */
export function deliveryEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.SYNCHRONOUS_COURSES_ENABLED === "true";
}
