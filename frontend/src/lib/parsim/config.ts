/** The Parsim backend, as the frontend's server reaches it. */
export function apiUrl(): string {
  return (process.env.PARSIM_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

/**
 * The proxy URL agents should use, shown in the setup snippets. Defaults to
 * the backend URL, which serves the proxy endpoints too.
 */
export function proxyUrl(): string {
  return (process.env.PARSIM_PROXY_URL || apiUrl()).replace(/\/+$/, '');
}

/** The cookie holding the project the dashboard shows. */
export const PROJECT_COOKIE = 'parsim_project';
