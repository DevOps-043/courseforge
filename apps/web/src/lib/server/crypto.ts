import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKeyHex() {
  return process.env.OAUTH_TOKEN_CRYPTO_SECRET || process.env.GOOGLE_OAUTH_CRYPTO_SECRET;
}

function getEncryptionKey() {
  const keyHex = getKeyHex();
  if (!keyHex) {
    throw new Error("OAUTH_TOKEN_CRYPTO_SECRET no esta configurada en las variables de entorno");
  }

  if (keyHex.length !== 64) {
    throw new Error("OAUTH_TOKEN_CRYPTO_SECRET debe ser una clave hexadecimal de 32 bytes (64 caracteres)");
  }

  return Buffer.from(keyHex, "hex");
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  const [ivHex, authTagHex, encryptedText] = encryptedData.split(":");
  if (!ivHex || !authTagHex || !encryptedText) {
    throw new Error("Formato de token cifrado invalido");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
