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

    // Auth.js v5 uses different cookie names than next-auth v4
    const cookieName = isSecure ? "__Secure-authjs.session-token" : "authjs.session-token";

    console.log(`[Middleware] Checking auth for protected route: ${pathname}, cookieName: ${cookieName}, isSecure: ${isSecure}`);

    const token = await getToken({
      req: request,
      secret,
      cookieName,
    });

    console.log(`[Middleware] Token: ${token ? `exists (id: ${token.id})` : 'null'}`);

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
