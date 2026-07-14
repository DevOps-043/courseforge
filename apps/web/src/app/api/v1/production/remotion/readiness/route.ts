import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const provider = process.env.RENDER_PROVIDER || "desktop_worker";
  return NextResponse.json({
    ok: provider === "desktop_worker",
    provider,
    config: { provider },
    checks: [
      {
        name: "netlify_desktop_worker_control_plane",
        ok: provider === "desktop_worker",
        message:
          provider === "desktop_worker"
            ? "Netlify server-side control plane is enabled for desktop workers."
            : "Set RENDER_PROVIDER=desktop_worker to use local render workers.",
      },
    ],
  });
}

