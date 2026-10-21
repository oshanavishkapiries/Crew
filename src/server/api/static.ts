import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Context } from 'hono';
import { getMimeType } from 'hono/utils/mime';
import { findPackageRoot } from '../db/index.js';

const uiDirectory = path.join(findPackageRoot(), 'dist/ui');
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);

/** Resolve both lexical and real paths: an exported symlink must not expose Crew home. */
export async function serveBoard(c: Context): Promise<Response> {
  let pathname: string;
  try { pathname = decodeURIComponent(c.req.path); }
  catch { return c.text('Invalid path', 400); }
  if (pathname.includes('\0') || pathname.includes('\\')) return c.text('Invalid path', 400);
  const candidate = path.resolve(uiDirectory, '.' + pathname);
  if (!inside(uiDirectory, candidate)) return c.text('Forbidden path', 403);
  c.header('Cache-Control', 'no-cache');
  let root: string;
  try { root = await fs.realpath(uiDirectory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return c.html('<!doctype html><title>Crew Board</title><p>Build the Board with <code>npm run build:ui</code>, then reload this page.</p>');
  }
  const read = async (file: string): Promise<Response | undefined> => {
    try {
      const real = await fs.realpath(file);
      if (!inside(root, real)) return c.text('Forbidden path', 403);
      if (!(await fs.stat(real)).isFile()) return;
      const mime = getMimeType(file) ?? 'application/octet-stream';
      c.header('Content-Type', mime);
      // Next's immutable chunk/media files contain a content hash. HTML and plain assets revalidate.
      if (!mime.startsWith('text/html') && /\/_next\/static\//.test(file) && /(?:^|[-.])[a-f0-9]{8,}(?=[.-])/i.test(path.basename(file))) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return c.body(await fs.readFile(real));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
  };
  const direct = await read(candidate);
  if (direct) return direct;
  if (path.extname(pathname) || pathname.startsWith('/_next/')) return c.notFound();
  const exportedRoute = await read(path.join(candidate, 'index.html'))
    ?? (candidate !== uiDirectory ? await read(candidate + '.html') : undefined);
  if (exportedRoute) return exportedRoute;
  return await read(path.join(uiDirectory, 'index.html')) ?? c.text('Board export has no index.html. Run npm run build:ui and reload.', 503);
}
