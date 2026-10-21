import { execa } from 'execa';
import { getServerInfo } from '../client.js';
import { SECRET_HEADER } from '../../server/api/security.js';

export async function handleOpen(): Promise<void> {
  const { url, secret } = getServerInfo(true);
  let key: string;
  try {
    const response = await fetch(`${url}/api/session/key`, { method: 'POST', headers: { [SECRET_HEADER]: secret } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { key?: unknown };
    if (typeof body.key !== 'string' || !/^[a-f0-9]{64}$/.test(body.key)) throw new Error('Invalid login response');
    key = body.key;
  } catch {
    console.error('Cannot reach the Crew server. Run crew start, then crew open again.');
    process.exitCode = 1;
    return;
  }
  const loginUrl = `${url}/#key=${key}`;
  console.log(loginUrl);
  try {
    // Argument arrays keep URLs out of the shell. BROWSER may name an executable.
    await execa(process.env.BROWSER || (process.platform === 'darwin' ? 'open' : 'xdg-open'), [loginUrl], { stdio: 'ignore', timeout: 10_000 });
  } catch {
    console.error('Could not open a browser. Paste the URL above into your browser.');
  }
}
