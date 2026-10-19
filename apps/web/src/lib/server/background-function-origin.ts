import deployment from "./background-deployment.generated.json";

const LOCAL_FUNCTIONS_ORIGIN = "http://localhost:8888";

/** El destino procede del build, nunca de headers o de la URL pública del sitio. */
export function resolveBackgroundFunctionOrigin(
  environment: Readonly<Record<string, string | undefined>>,
  pinnedOrigin: string | null = deployment.origin,
): string {
  if (environment.NODE_ENV === "development" && environment.NETLIFY !== "true") {
    return LOCAL_FUNCTIONS_ORIGIN;
  }

  const candidate = pinnedOrigin ?? environment.DEPLOY_URL;
  if (!candidate) {
    throw new Error("Falta el destino del despliegue para los workers. Ejecuta el build de Netlify con la captura de DEPLOY_URL.");
  }

  let destination: URL;
  try {
    destination = new URL(candidate);
  } catch {
    throw new Error("El destino del despliegue para los workers no es una URL válida.");
  }
  if (destination.protocol !== "https:" || destination.username || destination.password
    || destination.pathname !== "/" || destination.search || destination.hash) {
    throw new Error("El destino de los workers debe ser un origen HTTPS sin credenciales, ruta ni parámetros.");
  }
  return destination.origin;
}
