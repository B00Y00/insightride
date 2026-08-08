"use client";

const ink = "#0F1F18", porcelain = "#EEF1EC", pine = "#1B6B4A", line = "#D9DED7",
  text = "#1A241E", faint = "#63705F";
const sans = "'Inter', -apple-system, 'Segoe UI', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

const PORTALS = [
  { label: "Admin Dashboard", desc: "Manage contracts, interviews, clients, and reports", href: "/login" },
  { label: "Interviewer App", desc: "View contracts, go online, and upload interviews", href: "/login" },
  { label: "Client Login", desc: "Access your research contracts, statistics, and reports", href: "/login" },
];

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: ink, padding: "16px 28px" }}>
        <div style={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: "20px", color: porcelain }}>InsightRide</div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: "460px" }}>
          <div style={{ fontFamily: mono, fontSize: "11px", color: pine, letterSpacing: "0.1em", marginBottom: "8px" }}>IN-PERSON MARKET RESEARCH</div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.01em", color: text, margin: "0 0 24px" }}>Choose your portal</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {PORTALS.map((p) => (
              <a key={p.label} href={p.href} style={{ background: "#FFFFFF", border: `1.5px solid ${line}`, borderRadius: "14px", padding: "20px 22px", textDecoration: "none", display: "block" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: text, letterSpacing: "-0.01em", marginBottom: "4px" }}>{p.label} →</div>
                <div style={{ fontSize: "13px", color: faint, lineHeight: "1.5" }}>{p.desc}</div>
              </a>
            ))}
          </div>
          <div style={{ fontSize: "12px", color: faint, marginTop: "18px", lineHeight: "1.6" }}>
            All portals use the same sign-in. Your account's role takes you to the right place automatically.
          </div>
        </div>
      </div>
    </div>
  );
}
