import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "@/lib/config";

// POST /api/video/pnl-card - Proxy to internal API for video processing
export async function POST(req: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await req.formData();

    // Forward to internal API
    const response = await fetchInternalApi("/api/video/pnl-card", {
      method: "POST",
      body: formData,
      // Don't set Content-Type header - let fetch handle multipart/form-data boundary
      headers: {},
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      return NextResponse.json(error, { status: response.status });
    }

    // Get the video buffer from the response
    const videoBuffer = await response.arrayBuffer();

    // Return the video with proper headers
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="polyx-pnl-${Date.now()}.mp4"`,
      },
    });
  } catch (error) {
    console.error("[video/pnl-card] Error:", error);
    return NextResponse.json(
      { error: "Video processing failed" },
      { status: 500 }
    );
  }
}

// Increase body size limit for video uploads
export const config = {
  api: {
    bodyParser: false,
  },
};
