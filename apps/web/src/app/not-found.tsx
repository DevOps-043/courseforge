import { ErrorShell } from "./_components/ErrorShell";
import { getAuthBridgeUser } from "@/utils/auth/session";

export default async function NotFound() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return (
      <ErrorShell
        code="404"
        title="Sesion expirada"
        description="Tu sesion ya no esta activa o no pudimos validar tu acceso. Inicia sesion de nuevo para recuperar tus empresas y continuar."
        primaryHref="/login?error=session_expired"
        primaryLabel="Iniciar sesion"
        primaryMode="login"
      />
    );
  }

  return (
    <ErrorShell
      code="404"
      title="No encontramos esta pagina"
      description="La ruta no existe o no tienes acceso a esta empresa. Puedes volver al menu principal para continuar desde una seccion disponible."
    />
  );
}
