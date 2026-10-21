import { generatePerStartSecret, hashToken } from './security.js';

/** Browser credentials live only for this server instance; none are persisted. */
export class BrowserSessions {
  private pendingKeys = new Set<string>();
  private sessions = new Set<string>();

  issueKey(): string {
    const key = generatePerStartSecret();
    this.pendingKeys.add(hashToken(key));
    return key;
  }

  exchange(key: unknown): string | undefined {
    if (typeof key !== 'string' || !this.pendingKeys.delete(hashToken(key))) return;
    const session = generatePerStartSecret();
    this.sessions.add(hashToken(session));
    return session;
  }

  valid(session: string | undefined): boolean {
    return !!session && this.sessions.has(hashToken(session));
  }

  revoke(session: string | undefined): void {
    if (session) this.sessions.delete(hashToken(session));
  }
}
