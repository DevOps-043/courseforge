import { NextResponse } from "next/server";
import { completeAuthBridgeLogin } from "@/app/login/auth-bridge";

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

    const result = await completeAuthBridgeLogin(
      identifier || "",
      password || "",
      Boolean(rememberMe),
    );

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "Ocurrió un error inesperado" ? 500 : 400 },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Login API route error:", error);
    return NextResponse.json(
      { error: "Ocurrió un error inesperado" },
      { status: 500 },
    );
  }
}
