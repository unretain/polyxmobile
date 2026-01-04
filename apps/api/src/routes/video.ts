import { Router } from "express";
import ffmpeg from "fluent-ffmpeg";
import { createWriteStream, mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import multer from "multer";

export const videoRoutes = Router();

// Configure multer for file uploads (max 50MB video)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Temp directory for processing
const TEMP_DIR = join(tmpdir(), "polyx-video");
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// Clean up old temp files (older than 10 minutes)
function cleanupTempFiles() {
  try {
    const fs = require("fs");
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupTempFiles, 5 * 60 * 1000);

interface PnLCardData {
  periodLabel: string;
  pnlValue: string;
  pnlIsPositive: boolean;
  statsText: string;
  dateText: string;
}

// POST /api/video/pnl-card - Generate PnL card video with overlay
videoRoutes.post("/pnl-card", upload.single("video"), async (req, res) => {
  const jobId = randomUUID();
  let inputPath: string | null = null;
  let outputPath: string | null = null;

  try {
    // Parse the overlay data from the request
    const data: PnLCardData = JSON.parse(req.body.data || "{}");
    const { periodLabel, pnlValue, pnlIsPositive, statsText, dateText } = data;

    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    if (!periodLabel || !pnlValue) {
      return res.status(400).json({ error: "Missing required overlay data" });
    }

    console.log(`[video] Processing PnL card ${jobId}...`);

    // Save uploaded video to temp file
    inputPath = join(TEMP_DIR, `input-${jobId}.mp4`);
    outputPath = join(TEMP_DIR, `output-${jobId}.mp4`);

    const writeStream = createWriteStream(inputPath);
    writeStream.write(req.file.buffer);
    writeStream.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Build FFmpeg drawtext filters for the overlay
    const pnlColor = pnlIsPositive ? "0x4ade80" : "0xf87171"; // Green or red

    // Escape special characters for FFmpeg
    const escapeText = (text: string) =>
      text.replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\\/g, "\\\\");

    // Build complex filter with multiple text overlays
    const filters = [
      // Semi-transparent dark overlay
      "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.3:t=fill",

      // Logo top-left: [polyx]
      `drawtext=text='[poly':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=h/15:fontcolor=white:x=w*0.04:y=h*0.06`,
      `drawtext=text='x':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=h/15:fontcolor=0xFF6B4A:x=w*0.04+tw*1.1:y=h*0.06`,
      `drawtext=text=']':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=h/15:fontcolor=white:x=w*0.04+tw*1.35:y=h*0.06`,

      // Period label (centered, top-middle area)
      `drawtext=text='${escapeText(periodLabel)} PnL':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=h/22:fontcolor=white@0.8:x=(w-text_w)/2:y=h*0.38`,

      // Main PnL value (centered, large)
      `drawtext=text='${escapeText(pnlValue)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=h/8:fontcolor=${pnlColor}:x=(w-text_w)/2:y=h*0.48`,

      // Stats text (centered, below PnL)
      `drawtext=text='${escapeText(statsText)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=h/28:fontcolor=white@0.6:x=(w-text_w)/2:y=h*0.62`,

      // Date bottom-left
      `drawtext=text='${escapeText(dateText)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=h/30:fontcolor=white@0.6:x=w*0.04:y=h*0.92`,

      // Website bottom-right
      `drawtext=text='polyx.trade':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=h/30:fontcolor=white@0.6:x=w*0.96-text_w:y=h*0.92`,
    ];

    // Process video with FFmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath!)
        .videoFilters(filters.join(","))
        .outputOptions([
          "-c:v libx264",
          "-preset fast",
          "-crf 23",
          "-c:a aac",
          "-b:a 128k",
          "-movflags +faststart",
          "-pix_fmt yuv420p",
        ])
        .output(outputPath!)
        .on("start", (cmd) => {
          console.log(`[video] FFmpeg started: ${cmd.substring(0, 100)}...`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(`[video] Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          console.log(`[video] Processing complete for ${jobId}`);
          resolve();
        })
        .on("error", (err) => {
          console.error(`[video] FFmpeg error:`, err.message);
          reject(err);
        })
        .run();
    });

    // Read the output file and send it
    const outputBuffer = readFileSync(outputPath);

    // Clean up temp files
    if (inputPath && existsSync(inputPath)) unlinkSync(inputPath);
    if (outputPath && existsSync(outputPath)) unlinkSync(outputPath);

    // Send the processed video
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="polyx-pnl-${Date.now()}.mp4"`
    );
    res.send(outputBuffer);

    console.log(`[video] Sent processed video ${jobId} (${outputBuffer.length} bytes)`);
  } catch (error) {
    console.error(`[video] Error processing ${jobId}:`, error);

    // Clean up on error
    try {
      if (inputPath && existsSync(inputPath)) unlinkSync(inputPath);
      if (outputPath && existsSync(outputPath)) unlinkSync(outputPath);
    } catch {}

    res.status(500).json({
      error: "Video processing failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/video/health - Check if FFmpeg is available
videoRoutes.get("/health", async (req, res) => {
  try {
    const ffmpegPath = await new Promise<string>((resolve, reject) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) reject(err);
        else resolve("FFmpeg available");
      });
    });

    res.json({
      status: "ok",
      ffmpeg: ffmpegPath,
      tempDir: TEMP_DIR,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : "FFmpeg not available",
    });
  }
});
