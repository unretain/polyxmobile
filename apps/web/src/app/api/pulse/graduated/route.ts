import { NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// Proxy to internal API - protects Moralis API key
export async function GET() {
  try {
    const response = await fetchInternalApi("/api/pulse/graduated");

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch graduated pairs" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=5",
      },
    });
  } catch (error) {
    console.error("[pulse/graduated] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
