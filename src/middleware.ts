import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SITE_ACCESS_COOKIE, getSiteAccessPassword, siteAccessCookieValue } from "@/lib/site-access";

export async function middleware(request: NextRequest) {
  const password = getSiteAccessPassword();
  if (!password) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/site-lock") ||
    pathname.startsWith("/api/site-access") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/~offline"
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value;
  const expected = await siteAccessCookieValue(password);

  if (cookie && cookie === expected) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/site-lock";
  url.searchParams.set("from", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
