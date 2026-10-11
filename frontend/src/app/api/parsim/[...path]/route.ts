import { apiUrl } from '@/lib/parsim/config';
import { TOKEN_COOKIE } from '@/lib/parsim/dev-auth';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forwards the dashboard's browser requests to the backend's project API
 * with the user's token, which stays in an httpOnly cookie. Only
 * /projects paths are forwarded.
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== 'projects') {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

  const url = `${apiUrl()}/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();
  const res = await fetch(url, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body,
    cache: 'no-store'
  });
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' }
  });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
