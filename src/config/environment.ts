export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.DATABASE_URL !== 'string' || config.DATABASE_URL.length === 0) {
    throw new Error('DATABASE_URL is required.');
  }
  const tokenTtl = Number(config.JWT_EXPIRES_IN_SECONDS ?? 7200);
  if (!Number.isInteger(tokenTtl) || tokenTtl < 60) {
    throw new Error('JWT_EXPIRES_IN_SECONDS must be an integer of at least 60.');
  }
  const secret = config.JWT_SECRET;
  if (config.NODE_ENV === 'production' && (typeof secret !== 'string' || secret.length < 32)) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  }
  return { ...config, JWT_EXPIRES_IN_SECONDS: tokenTtl };
}
