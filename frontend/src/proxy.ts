import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiUrl } from '@/lib/parsim/config';
import { devAutoLoginEnabled, devLogin, TOKEN_COOKIE } from '@/lib/parsim/dev-auth';

/**
 * Development auto-login (DEV_AUTO_LOGIN=true): when there is no backend
 * token yet, or it expired, sign in as the seeded admin and keep the token
 * in an httpOnly cookie. Refuses to run with NODE_ENV=production. Step 18
 * replaces this with real sign-in.
 */
export async function proxy(req: NextRequest) {
  if (req.cookies.get(TOKEN_COOKIE)) return NextResponse.next();

  let enabled: boolean;
  try {
    enabled = devAutoLoginEnabled(process.env);
  } catch (error) {
    return new NextResponse((error as Error).message, { status: 500 });
  }
  if (!enabled) return NextResponse.next();

  try {
    const { token, maxAgeSeconds } = await devLogin(apiUrl(), process.env);
    // Pass the token to this request's server components too.
    req.cookies.set(TOKEN_COOKIE, token);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: maxAgeSeconds
    });
    return res;
  } catch (error) {
    console.error(`Development auto-login failed: ${(error as Error).message}`);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/parsim/:path*']
};
