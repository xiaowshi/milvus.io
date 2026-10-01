import { NextRequest, NextResponse } from 'next/server';

const localeSegment = '(?:zh-hant|zh|ja|ko|fr|de|es|it|pt|ru|id|ar)';
const sizingRoute = new RegExp(
  `^/(?:${localeSegment}(?:/tools/sizing(?:-v250)?)?|tools/sizing(?:-v250)?)?$`
);
const publicAssetPrefixes = ['/assets/', '/fonts/', '/images/'];
const publicAssetFiles = new Set([
  '/favicon.ico',
  '/favicon-32x32.png',
  '/robots.txt',
  '/sitemap.xml',
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next/') ||
    publicAssetPrefixes.some(prefix => pathname.startsWith(prefix)) ||
    publicAssetFiles.has(pathname) ||
    sizingRoute.test(pathname)
  ) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: '/:path*',
};
