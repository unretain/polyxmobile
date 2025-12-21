import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Routes that require authentication
const protectedRoutes = ["/dashboard", "/pulse", "/markets", "/token"];

// Routes that are always public
const publicRoutes = ["/", "/solutions", "/tos", "/privacy", "/embed", "/api"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  console.log(`[middleware] Path: ${pathname}`);

  // Check if this is a protected route
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Check if this is always public
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  console.log(`[middleware] isProtected: ${isProtectedRoute}, isPublic: ${isPublicRoute}`);

  // If it's a public route, allow access
  if (isPublicRoute && !isProtectedRoute) {
    return NextResponse.next();
  }

  // If it's a protected route, check for authentication
  if (isProtectedRoute) {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    console.log(`[middleware] Auth secret exists: ${!!secret}`);

    const token = await getToken({
      req: request,
      secret,
    });

    console.log(`[middleware] Token exists: ${!!token}, userId: ${token?.id || 'none'}`);

    // If not authenticated, redirect to landing page
    if (!token) {
      const url = new URL("/", request.url);
      url.searchParams.set("redirect", pathname);
      console.log(`[middleware] Redirecting to: ${url.toString()}`);
      return NextResponse.redirect(url);
    }
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
