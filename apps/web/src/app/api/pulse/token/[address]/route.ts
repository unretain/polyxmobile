import { NextResponse } from "next/server";

// Return 404 - API service not available
// TODO: Re-enable when apps/api is deployed
export async function GET() {
  return NextResponse.json({ error: "Token not found" }, { status: 404 });
}
