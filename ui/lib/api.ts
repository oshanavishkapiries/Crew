/** All human API calls stay on the Board origin; secrets never enter this client. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = void>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('\\')) {
    throw new ApiError('Expected a same-origin /api/ path', 0);
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET') headers.set('X-Crew-Board', '1');
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach Crew. Check that crew start is running, then retry.', 0);
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const body: { error?: string } = JSON.parse(text);
      message = body.error ?? message;
    } catch { /* Hono may return plain text, including 404s. */ }
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('crew:unauthorized'));
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Crew returned an invalid JSON response.', response.status);
  }
}
