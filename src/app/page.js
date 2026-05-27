"use client";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)", padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "500", marginBottom: "8px" }}>InsightRide</div>
      <h1 style={{ fontSize: "32px", fontWeight: "700", color: "#E8E8E4", marginBottom: "8px", fontFamily: "var(--font-display)" }}>Mobile Market Research Platform</h1>
      <p style={{ fontSize: "16px", color: "#888880", marginBottom: "48px", maxWidth: "400px", lineHeight: "1.6" }}>Select a view to get started. Open the admin on your computer and the interviewer view on your phone.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "360px" }}>
        <a href="/admin" style={{ display: "block", padding: "20px", borderRadius: "14px", background: "#1A1A18", border: "1px solid #2A2A28", textDecoration: "none", transition: "all 0.2s" }}>
          <div style={{ fontSize: "18px", fontWeight: "600", color: "#D4A017", marginBottom: "4px" }}>Admin Dashboard</div>
          <div style={{ fontSize: "14px", color: "#888880" }}>Create contracts, monitor interviewers, view analytics</div>
        </a>
        <a href="/interviewer" style={{ display: "block", padding: "20px", borderRadius: "14px", background: "#1A1A18", border: "1px solid #2A2A28", textDecoration: "none", transition: "all 0.2s" }}>
          <div style={{ fontSize: "18px", fontWeight: "600", color: "#6EC4A7", marginBottom: "4px" }}>Interviewer App</div>
          <div style={{ fontSize: "14px", color: "#888880" }}>View contracts, match interviewees, conduct interviews</div>
        </a>
      </div>
    </div>
  );
}
