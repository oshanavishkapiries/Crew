import * as crypto from 'node:crypto';
import type { Context, Next } from 'hono';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generatePerStartSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateAgentToken(): string {
  return 'crew_agent_' + crypto.randomBytes(24).toString('hex');
}

export function isLocalhostHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // Handle port suffixes like localhost:4000, 127.0.0.1:4000, [::1]:4000
  const host = hostHeader.toLowerCase().trim();
  const hostname = host.split(':')[0];

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function hostHeaderMiddleware() {
  return async (c: Context, next: Next) => {
    const host = c.req.header('host');
    if (!isLocalhostHost(host)) {
      return c.json(
        { error: 'Forbidden: Request Host header must be localhost (D13 DNS-rebinding protection)' },
        403,
      );
    }
    await next();
  };
}
