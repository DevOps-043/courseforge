import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";

/**
 * Proxy que descarga un HTML de slides desde Supabase Storage y lo sirve con
 * los headers HTTP correctos para que el navegador lo renderice como página.
 *
 * Supabase Storage CDN añade Content-Disposition: attachment en archivos HTML
 * de buckets públicos como medida anti-XSS, lo que fuerza descarga en lugar
 * de renderizado. Este proxy resuelve eso sirviendo el HTML desde el servidor
 * con los headers explícitos correctos.
 *
 * Query params:
 *   path  — ruta relativa dentro del bucket production-assets
 *            (ej: "slides/abc123-slides.html")
 */

const BUCKET = "production-assets";

// Solo se permiten paths dentro de la carpeta slides/ con extensión .html.
// Cubre tanto el formato open-design ("{id}-slides.html") como el del import
// desde cloud ("{id}-{prefix}-{name}.html"). Evita path traversal.
const ALLOWED_PATH_RE = /^slides\/[a-zA-Z0-9_-]+\.html$/;

function normalizePath(raw: string): string | null {
  // Acepta tanto "slides/x-slides.html" como "production-assets/slides/x-slides.html"
  const stripped = raw.replace(/^production-assets\//, "");
  return ALLOWED_PATH_RE.test(stripped) ? stripped : null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const rawPath = request.nextUrl.searchParams.get("path");
  if (!rawPath) {
    return new NextResponse("Parámetro 'path' requerido", { status: 400 });
  }

  const storagePath = normalizePath(rawPath);
  if (!storagePath) {
    return new NextResponse("Ruta de archivo inválida", { status: 400 });
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) {
    console.error("[slides/html-preview] Storage download error:", error);
    return new NextResponse("Archivo no encontrado", { status: 404 });
  }

  const html = await data.text();

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "inline",
      // Evita que el navegador reinterprete el tipo MIME
      "X-Content-Type-Options": "nosniff",
      // Cache corto: el HTML puede regenerarse pero no con frecuencia alta
      "Cache-Control": "private, max-age=300",
    },
  });
}
