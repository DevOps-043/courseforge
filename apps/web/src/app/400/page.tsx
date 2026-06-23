import { ErrorShell } from "../_components/ErrorShell";
import { getAuthBridgeUser } from "@/utils/auth/session";

export default async function BadRequestPage() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return (
      <ErrorShell
        code="400"
        title="Sesion expirada"
        description="Tu sesion ya no esta activa o la solicitud se hizo sin credenciales validas. Inicia sesion de nuevo para continuar."
        primaryHref="/login?error=session_expired"
        primaryLabel="Iniciar sesion"
        primaryMode="login"
      />
    );
  }

  return (
    <ErrorShell
      code="400"
      title="La solicitud no se pudo procesar"
      description="La pagina recibio datos incompletos o invalidos. Regresa al menu principal y vuelve a iniciar la accion desde una ruta valida."
    />
  );
}
