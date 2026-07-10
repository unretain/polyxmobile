"use client";

// Brand marks for iOS: the logo tile, the app icon, and the launch screen.
// The canonical source for the generated native assets is apps/web/assets/logo.svg —
// edit both together, or the app and the site drift apart.

const ORANGE = "#FF6B4A";

// Native asset geometry. @capacitor/assets composites the logo onto a 2732px splash
// canvas at logoSplashTargetWidth px wide, so the tile covers SPLASH_TILE/SPLASH of it.
const ICON = 1024;
const SPLASH = 2732;
const SPLASH_TILE = 600;

// Fraction of the tile edge the wordmark spans, and the type size within it. These
// mirror textLength/font-size in assets/logo.svg — keep the two in step.
const MARK_WIDTH_RATIO = 780 / 1024;
const FONT_RATIO = 0.24;

const SEGMENTS: Array<[string, string]> = [
  ["[poly", "#000000"],
  ["x", ORANGE],
  ["]", "#000000"],
];

// Draws the white tile and the wordmark, horizontally scaled to a fixed width so the
// result does not shift when Inter is unavailable and a fallback font is substituted.
function drawTile(ctx: CanvasRenderingContext2D, tile: number, x: number, y: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, tile, tile);

  ctx.font = `bold ${tile * FONT_RATIO}px Inter, Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";

  const widths = SEGMENTS.map(([text]) => ctx.measureText(text).width);
  const natural = widths.reduce((a, b) => a + b, 0);
  const target = tile * MARK_WIDTH_RATIO;
  const squeeze = target / natural;

  // Center on the ink box rather than the baseline, matching the SVG.
  const m = ctx.measureText("[polyx]");
  const baseline = y + tile / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;

  let penX = x + tile / 2 - target / 2;
  SEGMENTS.forEach(([text, color], i) => {
    ctx.save();
    ctx.translate(penX, baseline);
    ctx.scale(squeeze, 1);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    penX += widths[i] * squeeze;
  });
}

async function download(name: string, size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  // Without this the first click rasterizes a fallback font.
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  paint(ctx);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

const downloadIcon = () => download(`icon-${ICON}.png`, ICON, (ctx) => drawTile(ctx, ICON, 0, 0));

const downloadSplash = () =>
  download(`splash-${SPLASH}.png`, SPLASH, (ctx) => {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, SPLASH, SPLASH);
    const offset = (SPLASH - SPLASH_TILE) / 2;
    drawTile(ctx, SPLASH_TILE, offset, offset);
  });

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "#111",
        color: "#fff",
        border: "1px solid #333",
        borderRadius: 6,
        padding: "8px 16px",
        fontSize: 13,
        fontFamily: "Inter, sans-serif",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// `size` is the tile edge in px; type scales with it.
function Mark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <h1
        style={{
          fontSize: size * FONT_RATIO,
          fontWeight: "bold",
          fontFamily: "Inter, sans-serif",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          userSelect: "none",
          margin: 0,
        }}
      >
        <span style={{ color: "#000" }}>[poly</span>
        <span style={{ color: ORANGE }}>x</span>
        <span style={{ color: "#000" }}>]</span>
      </h1>
    </div>
  );
}

function Panel({
  label,
  spec,
  action,
  children,
}: {
  label: string;
  spec: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      {children}
      <div style={{ textAlign: "center", fontFamily: "Inter, sans-serif" }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{spec}</div>
      </div>
      {action}
    </div>
  );
}

export default function LogoPage() {
  const previewFrame = 320;
  // Preview the splash at true scale, or it lies about how small the tile really is.
  const previewTile = previewFrame * (SPLASH_TILE / SPLASH);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 64,
        padding: 64,
      }}
    >
      <Panel label="Logo" spec="the mark">
        <Mark size={previewFrame} />
      </Panel>

      {/* The squircle previews iOS masking only — the exported PNG is a hard square. */}
      <Panel
        label="App icon"
        spec={`${ICON}×${ICON} · square · no rounded corners`}
        action={<Button onClick={downloadIcon}>Download icon</Button>}
      >
        <div style={{ borderRadius: "22.37%", overflow: "hidden", display: "flex" }}>
          <Mark size={previewFrame} />
        </div>
      </Panel>

      {/* Tile size here matches --logoSplashTargetWidth on a 2732 canvas. iOS aspect-fills
          this square into the screen and crops the sides, so the tile must stay centered. */}
      <Panel
        label="Launch screen"
        spec={`${SPLASH}×${SPLASH} · ${SPLASH_TILE}px tile on #000`}
        action={<Button onClick={downloadSplash}>Download splash</Button>}
      >
        <div
          style={{
            width: previewFrame,
            height: previewFrame,
            backgroundColor: "#000",
            border: "1px solid #222",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Mark size={previewTile} />
        </div>
      </Panel>
    </div>
  );
}
