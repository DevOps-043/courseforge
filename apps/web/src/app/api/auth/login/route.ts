import { NextResponse } from "next/server";
import { loginAction } from "@/app/login/actions";

/**
 * POST /api/auth/login
 *
 * Stable login endpoint for the client.
 * This avoids coupling the browser to a server-action build id,
 * which can break after a fresh deployment if the user still has
 * an older tab open.
 */
export async function POST(request: Request) {
  try {
    const { identifier, password, rememberMe } = await request.json();

    const formData = new FormData();
    formData.append("identifier", identifier || "");
    formData.append("password", password || "");
    formData.append("rememberMe", rememberMe ? "true" : "false");

    const result = await loginAction(null, formData);

    if (result?.error) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "OcurriÃ³ un error inesperado" ? 500 : 400 },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Login API route error:", error);
    return NextResponse.json(
      { error: "OcurriÃ³ un error inesperado" },
      { status: 500 },
    );
  }
}
