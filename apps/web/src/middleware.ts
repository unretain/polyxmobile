import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Mobile app: No server-side auth middleware
// Authentication is handled client-side via wallet stored in localStorage
// All routes are accessible - wallet check happens in components

export function middleware(request: NextRequest) {
  // Allow all requests through
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
