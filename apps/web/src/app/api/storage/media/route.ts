import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { createClient } from "@/utils/supabase/server";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from "@/domains/production/media-storage.config";

const BROWSER_DELIVERY_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") || "";
  const componentId = url.searchParams.get("componentId") || "";
  const path = url.searchParams.get("path") || "";
  if (bucket !== HYPERFRAMES_PRIVATE_SOURCE_BUCKET || !componentId || !isSafePath(path)) {
    return NextResponse.json({ error: "Referencia de medio inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorizedComponent) {
    return NextResponse.json({ error: "Medio no encontrado para esta empresa." }, { status: 404 });
  }
  if (!pathBelongsToComponent(path, componentId)) {
    return NextResponse.json({ error: "El medio no pertenece al componente autorizado." }, { status: 403 });
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, BROWSER_DELIVERY_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "No se pudo autorizar el medio." }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, {
    headers: { "Cache-Control": "private, no-store" },
    status: 307,
  });
}

function pathBelongsToComponent(path: string, componentId: string) {
  const [folder, fileName, ...extra] = path.split("/");
  return extra.length === 0
    && new Set(["avatars", "broll", "music", "voices"]).has(folder || "")
    && Boolean(fileName?.startsWith(`${componentId}-`));
}

function isSafePath(path: string) {
  return Boolean(path)
    && !path.startsWith("/")
    && !path.includes("..")
    && !path.includes("\\")
    && path.split("/").every((segment) => segment && segment !== ".");
}
