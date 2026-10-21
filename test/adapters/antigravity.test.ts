import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { AntigravityAdapter } from '../../src/adapters/antigravity.js';
it('detects PATH presence only, never executes Antigravity and always reports headless false', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-antigravity-'));
  try {
    vi.stubEnv('PATH', dir);
    const adapter = new AntigravityAdapter();
    expect(await adapter.detect()).toEqual({ installed: false, headless: false });
    const sentinel = path.join(dir, 'executed');
    fs.writeFileSync(path.join(dir, 'antigravity'), `#!/bin/sh\ntouch '${sentinel}'\n`, { mode: 0o755 });
    expect(await adapter.detect()).toEqual({ installed: true, headless: false });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect('buildSpawn' in adapter).toBe(false);
  } finally { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); }
});
