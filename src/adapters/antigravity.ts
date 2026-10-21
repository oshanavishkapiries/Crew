import fs from 'node:fs';
import path from 'node:path';

/** D17: presence detection only. Never launch an unconfirmed headless interface. */
export class AntigravityAdapter {
  readonly id = 'antigravity' as const;
  async detect(): Promise<{ installed: boolean; version?: string; headless: boolean }> {
    const installed = (process.env.PATH || '').split(path.delimiter).some(dir => {
      try {
        const file = path.join(dir, 'antigravity');
        if (!fs.statSync(file).isFile()) return false;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
      }
      catch { return false; }
    });
    return { installed, headless: false };
  }
}
