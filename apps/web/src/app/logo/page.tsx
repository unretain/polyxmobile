// Brand marks for iOS: the logo tile, the app icon, and the launch screen.
// The canonical source for the generated native assets is apps/web/assets/logo.svg —
// edit both together, or the app and the site drift apart.

const ORANGE = "#FF6B4A";

// The white tile. `size` is the tile edge in px; type scales with it.
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
          fontSize: size * 0.24,
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
  children,
}: {
  label: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      {children}
      <div style={{ textAlign: "center", fontFamily: "Inter, sans-serif" }}>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{spec}</div>
      </div>
    </div>
  );
}

export default function LogoPage() {
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
        <Mark size={320} />
      </Panel>

      {/* The squircle previews iOS masking only — the exported PNG must be a hard
          square with no alpha and no rounded corners, or App Store upload rejects it. */}
      <Panel label="App icon" spec="1024×1024 · no alpha · square">
        <div style={{ borderRadius: "22.37%", overflow: "hidden", display: "flex" }}>
          <Mark size={320} />
        </div>
      </Panel>

      {/* Launch screen: the tile centered on black, matching splashBackgroundColor. */}
      <Panel label="Launch screen" spec="2732×2732 · tile on #000">
        <div
          style={{
            width: 320,
            height: 320,
            backgroundColor: "#000",
            border: "1px solid #222",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Mark size={140} />
        </div>
      </Panel>
    </div>
  );
}
