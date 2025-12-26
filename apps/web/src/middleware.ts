import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Routes that require authentication
const protectedRoutes = ["/dashboard", "/pulse", "/markets", "/token"];

// Routes that are always public
const publicRoutes = ["/", "/solutions", "/tos", "/privacy", "/embed", "/api"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  console.log(`[Middleware] Request: ${pathname}`);

  // Check if this is a protected route
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Check if this is always public
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  console.log(`[Middleware] isProtected: ${isProtectedRoute}, isPublic: ${isPublicRoute}`);

  // If it's a public route, allow access
  if (isPublicRoute && !isProtectedRoute) {
    console.log(`[Middleware] Allowing public route: ${pathname}`);
    return NextResponse.next();
  }

  // If it's a protected route, check for authentication
  if (isProtectedRoute) {
    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
    const isSecure = process.env.NODE_ENV === "production" || request.url.startsWith("https");

    // Log all cookies to debug
    const allCookies = request.cookies.getAll();
    const cookieNames = allCookies.map(c => c.name).join(', ');
    console.log(`[Middleware] All cookies: ${cookieNames}`);

    // Try multiple cookie name formats (Auth.js v5 vs next-auth v4)
    const possibleCookieNames = isSecure
      ? ["__Secure-authjs.session-token", "__Secure-next-auth.session-token", "authjs.session-token", "next-auth.session-token"]
      : ["authjs.session-token", "next-auth.session-token"];

    let token = null;
    let usedCookieName = null;

    for (const cookieName of possibleCookieNames) {
      const hasCookie = request.cookies.has(cookieName);
      console.log(`[Middleware] Trying cookie ${cookieName}: ${hasCookie ? 'exists' : 'missing'}`);

      if (hasCookie) {
        token = await getToken({
          req: request,
          secret,
          cookieName,
        });
        if (token) {
          usedCookieName = cookieName;
          break;
        }
      }
    }

    console.log(`[Middleware] Token result: ${token ? `exists (id: ${token.id}, cookie: ${usedCookieName})` : 'null'}`);

    // If not authenticated, redirect to landing page
    if (!token) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || request.url;
      const url = new URL("/", baseUrl);
      url.searchParams.set("redirect", pathname);
      console.log(`[Middleware] Redirecting unauthenticated user to: ${url.toString()}`);
      return NextResponse.redirect(url);
    }

    console.log(`[Middleware] Authenticated user accessing: ${pathname}`);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
