import type { CorsOptions } from 'cors';

const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8888',
  'http://127.0.0.1:8888',
];

function parseAllowedOrigins(rawValue: string | undefined): string[] {
  if (!rawValue?.trim()) {
    return [];
  }

  return rawValue
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function getAllowedOrigins(): string[] {
  const configuredOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ALLOWED_ORIGINS is required in production. Configure the Netlify production/staging origins explicitly.',
    );
  }

  return LOCAL_DEVELOPMENT_ORIGINS;
}

export function getCorsOptions(): CorsOptions {
  const allowedOrigins = new Set(getAllowedOrigins());

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/+$/, '');
      if (allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${normalizedOrigin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  };
}
