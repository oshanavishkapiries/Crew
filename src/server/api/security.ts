import * as crypto from 'node:crypto';
import type { Context, Next } from 'hono';

// D13: agents authenticate with their own token, the Board and human CLI with the per-start secret
export const AGENT_TOKEN_HEADER = 'x-crew-agent-token';
export const SECRET_HEADER = 'x-crew-secret';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generatePerStartSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateAgentToken(): string {
  return 'crew_agent_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Constant-time comparison, so response timing doesn't leak how much of a secret matched
 */
export function secretsMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Strip the port from a Host header value. IPv6 hosts come bracketed, e.g. [::1]:4000
 */
function hostnameOf(hostHeader: string): string {
  const host = hostHeader.toLowerCase().trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  return host.split(':')[0];
}

export function isLocalhostHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
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
