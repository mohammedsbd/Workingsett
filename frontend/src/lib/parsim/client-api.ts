/**
 * Calls the Parsim backend from the browser through the frontend's
 * /api/parsim route, which adds the httpOnly token. `path` is the backend
 * path under /api/v1, for example "/projects/<id>/sessions".
 */
export async function parsimFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/parsim${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: unknown; errors?: unknown };
      if (body.errors) message = JSON.stringify(body.errors);
      else if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the status message.
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A query string from the defined values, for example "?page=2&sort=x". */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
