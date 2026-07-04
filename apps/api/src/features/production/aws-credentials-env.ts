const AWS_ACCESS_KEY_ALIASES = [
  'SOFLIA_AWS_ACCESS_KEY_ID',
  'COURSEFORGE_AWS_ACCESS_KEY_ID',
];

const AWS_SECRET_KEY_ALIASES = [
  'SOFLIA_AWS_SECRET_ACCESS_KEY',
  'COURSEFORGE_AWS_SECRET_ACCESS_KEY',
];

const AWS_SESSION_TOKEN_ALIASES = [
  'SOFLIA_AWS_SESSION_TOKEN',
  'COURSEFORGE_AWS_SESSION_TOKEN',
];

function firstConfiguredEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function ensureAwsCredentialsEnv(): void {
  if (!process.env.AWS_ACCESS_KEY_ID?.trim()) {
    const accessKeyId = firstConfiguredEnv(AWS_ACCESS_KEY_ALIASES);
    if (accessKeyId) {
      process.env.AWS_ACCESS_KEY_ID = accessKeyId;
    }
  }

  if (!process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
    const secretAccessKey = firstConfiguredEnv(AWS_SECRET_KEY_ALIASES);
    if (secretAccessKey) {
      process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
    }
  }

  if (!process.env.AWS_SESSION_TOKEN?.trim()) {
    const sessionToken = firstConfiguredEnv(AWS_SESSION_TOKEN_ALIASES);
    if (sessionToken) {
      process.env.AWS_SESSION_TOKEN = sessionToken;
    }
  }
}
