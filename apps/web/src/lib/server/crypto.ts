import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX = process.env.GOOGLE_OAUTH_CRYPTO_SECRET;

export function encrypt(text: string): string {
  if (!KEY_HEX) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET no está configurada en las variables de entorno");
  }

  if (KEY_HEX.length !== 64) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET debe ser una clave hexadecimal de 32 bytes (64 caracteres)");
  }

  const iv = crypto.randomBytes(12);
  const key = Buffer.from(KEY_HEX, "hex");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  // Guardamos IV, Auth Tag y texto cifrado separados por dos puntos
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  if (!KEY_HEX) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET no está configurada en las variables de entorno");
  }

  if (KEY_HEX.length !== 64) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET debe ser una clave hexadecimal de 32 bytes (64 caracteres)");
  }

  const [ivHex, authTagHex, encryptedText] = encryptedData.split(":");
  if (!ivHex || !authTagHex || !encryptedText) {
    throw new Error("Formato de token cifrado inválido");
  }

  const key = Buffer.from(KEY_HEX, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
