import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import {
  normalizeProductionAssetStoragePath,
} from "@/domains/production/validation/open-design-html-rasterizer.service";

export const runtime = "nodejs";

const BUCKET = "production-assets";

export async function GET(request: Request) {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    return NextResponse.json({ error: "path es requerido." }, { status: 400 });
  }

  let storagePath: string;
  try {
    storagePath = normalizeProductionAssetStoragePath(rawPath);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ruta de HTML invalida." },
      { status: 400 },
    );
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "HTML no encontrado." },
      { status: 404 },
    );
  }

  const html = await data.text();
  return new Response(html, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Security-Policy": [
        "default-src 'self' data: blob:",
        "img-src * data: blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'unsafe-inline'",
      ].join("; "),
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
