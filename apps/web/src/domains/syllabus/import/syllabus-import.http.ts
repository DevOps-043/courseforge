import { z } from "zod";
import { createClient } from "../../../utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
} from "../../../lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "../../../lib/server/tenant-context";
import { SyllabusImportError } from "./syllabus-import.repository";

export async function authorizeSyllabusImport(artifactId: string) {
  if (!z.string().uuid().safeParse(artifactId).success)
    throw new SyllabusImportError("Identificador de artefacto inválido.", 400);
  const user = await getAuthenticatedUser(await createClient());
  if (!user) throw new SyllabusImportError("No autorizado.", 401);
  const tenant = await resolveActiveTenantContext();
  if (!tenant) throw new SyllabusImportError("Empresa no autorizada.", 403);
  if (tenant.userId !== user.userId)
    throw new SyllabusImportError(
      "La sesión y la empresa activa no corresponden al mismo usuario. Vuelve a iniciar sesión.",
      401,
    );
  const authorized = await getAuthorizedArtifactAdminForTenant(
    artifactId,
    tenant,
  );
  if (!authorized)
    throw new SyllabusImportError(
      "Artefacto no encontrado para esta empresa.",
      404,
    );
  return { admin: authorized.admin, actorId: user.userId, tenant };
}
