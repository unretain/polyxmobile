import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// Use Node.js runtime for middleware (needed for auth which uses crypto/bcrypt)
export const runtime = "nodejs";

// Routes that require authentication
const protectedRoutes = ["/dashboard", "/pulse", "/markets", "/token"];

// Routes that are always public
const publicRoutes = ["/", "/solutions", "/tos", "/privacy", "/embed", "/api"];

export default auth((request) => {
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
    // Auth.js v5 attaches auth info to request
    const session = request.auth;
    console.log(`[Middleware] Session: ${session ? `exists (user: ${session.user?.id})` : 'null'}`);

    // If not authenticated, redirect to landing page
    if (!session?.user) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || request.url;
      const url = new URL("/", baseUrl);
      url.searchParams.set("redirect", pathname);
      console.log(`[Middleware] Redirecting unauthenticated user to: ${url.toString()}`);
      return NextResponse.redirect(url);
    }

    console.log(`[Middleware] Authenticated user accessing: ${pathname}`);
  }

  return NextResponse.next();
});

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
