export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getSupabaseServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;

  const keys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    const key = parsed.default || Object.values(parsed)[0];
    if (key?.trim()) return key.trim();
  }
  throw new Error("Missing Supabase service-role/secret key.");
}

export function getEncryptionKeyHex(): string {
  return requireEnv("OAUTH_TOKEN_CRYPTO_SECRET");
}

