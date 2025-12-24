import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  const tempDir = join(tmpdir(), "polyx-convert");
  const inputPath = join(tempDir, `input-${Date.now()}.webm`);
  const outputPath = join(tempDir, `output-${Date.now()}.mp4`);

  try {
    // Create temp directory
    await mkdir(tempDir, { recursive: true });

    // Get the uploaded file
    const formData = await request.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    // Write input file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Convert with FFmpeg
    await execAsync(
      `ffmpeg -i "${inputPath}" -c:v libx264 -preset ultrafast -c:a aac -movflags +faststart -y "${outputPath}"`
    );

    // Read output file
    const mp4Buffer = await readFile(outputPath);

    // Cleanup
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    return new NextResponse(mp4Buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="video.mp4"',
      },
    });
  } catch (error) {
    console.error("Video conversion error:", error);

    // Cleanup on error
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    return NextResponse.json(
      { error: "Video conversion failed. FFmpeg may not be installed on the server." },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
