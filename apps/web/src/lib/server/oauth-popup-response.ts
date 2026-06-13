import { NextResponse } from "next/server";
import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";

interface OAuthPopupResponseParams {
  provider: CloudStorageProvider;
  status: "success" | "error";
  message?: string;
  redirectPath?: string;
}

export function oauthPopupResponse({
  provider,
  status,
  message,
  redirectPath = "/admin/profile",
}: OAuthPopupResponseParams) {
  const safeProvider = JSON.stringify(provider);
  const safeStatus = JSON.stringify(status);
  const safeMessage = JSON.stringify(message || "");
  const safeRedirectPath = JSON.stringify(redirectPath);
  const visibleMessage = message
    ? message.replace(/[<>&"]/g, (char) => {
        const entities: Record<string, string> = {
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
        };
        return entities[char] || char;
      })
    : "";

  return new NextResponse(
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Courseforge OAuth</title>
    <style>
      body {
        align-items: center;
        background: #0f1419;
        color: #e9ecef;
        display: flex;
        font-family: Arial, sans-serif;
        height: 100vh;
        justify-content: center;
        margin: 0;
      }
      main {
        max-width: 420px;
        padding: 24px;
        text-align: center;
      }
      a {
        color: #00d4b3;
      }
      code {
        background: rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        display: block;
        margin-top: 16px;
        padding: 12px;
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${status === "success" ? "Conexion completada" : "No se pudo completar la conexion"}</h1>
      <p>${status === "success" ? "Esta ventana se cerrara automaticamente." : "Corrige la configuracion y vuelve a intentarlo desde Courseforge."}</p>
      ${visibleMessage ? `<code>${visibleMessage}</code>` : ""}
      <p><a href="${redirectPath}">Volver a Courseforge</a></p>
    </main>
    <script>
      const payload = {
        type: "courseforge:cloud-storage-oauth",
        provider: ${safeProvider},
        status: ${safeStatus},
        message: ${safeMessage}
      };

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
        if (${safeStatus} === "success") {
          window.setTimeout(() => window.close(), 250);
        }
      } else {
        if (${safeStatus} === "success") {
          window.location.replace(${safeRedirectPath});
        }
      }
    </script>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}
