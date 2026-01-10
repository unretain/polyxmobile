export default function LogoPage() {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "#000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <div style={{
        width: "500px",
        height: "500px",
        backgroundColor: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0
      }}>
        <h1 style={{ fontSize: "120px", fontWeight: "bold", fontFamily: "Inter, sans-serif", letterSpacing: "-0.02em", lineHeight: 1, userSelect: "none" }}>
          <span style={{ color: "#000" }}>[poly</span>
          <span style={{ color: "#FF6B4A" }}>x</span>
          <span style={{ color: "#000" }}>]</span>
        </h1>
      </div>
    </div>
  );
}
