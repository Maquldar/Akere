import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing, isAppLocale } from './i18n/routing';

const intl = createMiddleware(routing);

/** Paths (after the locale prefix) reachable without a staff session. */
const PUBLIC_PATHS = ['/login', '/reset', '/portal'];
const SESSION_COOKIE = 'akere_session';

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const [, maybeLocale, ...rest] = pathname.split('/');
  if (isAppLocale(maybeLocale)) {
    const sub = `/${rest.join('/')}`;
    const isPublic = PUBLIC_PATHS.some((p) => sub === p || sub.startsWith(`${p}/`));
    // Fast path: no session cookie at all → go straight to login. The API is still the
    // source of truth (an expired cookie is caught client-side by the 401 handler).
    if (!isPublic && !req.cookies.has(SESSION_COOKIE)) {
      const url = req.nextUrl.clone();
      url.pathname = `/${maybeLocale}/login`;
      url.search = sub === '/' ? '' : `?next=${encodeURIComponent(sub + search)}`;
      return NextResponse.redirect(url);
    }
  }
  return intl(req);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
