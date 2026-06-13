import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";

const COOKIE_PREFIX = "courseforge_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

interface OAuthStatePayload {
  nonce: string;
  provider: CloudStorageProvider;
  userId: string;
}

function getCookieName(provider: CloudStorageProvider) {
  return `${COOKIE_PREFIX}_${provider}`;
}

function encodeState(payload: OAuthStatePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    if (
      typeof parsed?.nonce === "string" &&
      typeof parsed?.provider === "string" &&
      typeof parsed?.userId === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function createOAuthState(params: {
  provider: CloudStorageProvider;
  response: NextResponse;
  userId: string;
}) {
  const payload: OAuthStatePayload = {
    nonce: crypto.randomBytes(24).toString("base64url"),
    provider: params.provider,
    userId: params.userId,
  };
  const state = encodeState(payload);

  params.response.cookies.set(getCookieName(params.provider), state, {
    httpOnly: true,
    maxAge: STATE_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return state;
}

export async function validateOAuthState(params: {
  expectedProvider: CloudStorageProvider;
  state: string | null;
}) {
  if (!params.state) return null;

  const payload = decodeState(params.state);
  if (!payload || payload.provider !== params.expectedProvider) return null;

  const cookieStore = await cookies();
  const cookieName = getCookieName(params.expectedProvider);
  const cookieState = cookieStore.get(cookieName)?.value;
  cookieStore.delete(cookieName);

  if (!cookieState || cookieState !== params.state) return null;

  return payload;
}
