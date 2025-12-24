import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  const inputPath = join(tmpdir(), `input-${Date.now()}.webm`);
  const outputPath = join(tmpdir(), `output-${Date.now()}.mp4`);

  try {
    // Get WebM blob from request
    const formData = await req.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json({ error: "No video file" }, { status: 400 });
    }

    // Write input file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Convert with FFmpeg - Discord-compatible settings
    const ffmpegCmd = `ffmpeg -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outputPath}"`;

    await execAsync(ffmpegCmd, { timeout: 30000 });

    // Read output file
    const outputBuffer = await readFile(outputPath);

    // Cleanup
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    // Return MP4
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="polyx-pnl.mp4"`,
      },
    });
  } catch (error) {
    console.error("FFmpeg conversion failed:", error);

    // Cleanup on error
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});

    return NextResponse.json(
      { error: "Conversion failed" },
      { status: 500 }
    );
  }
}
