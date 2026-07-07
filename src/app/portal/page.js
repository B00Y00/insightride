"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function PortalPlaceholder() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) window.location.href = "/login";
      else setEmail(data.user.email || "");
    });
  }, []);
  async function signOut() { await supabase.auth.signOut(); window.location.href = "/login"; }
  return (
    <div style={{ minHeight: "100vh", background: "#EEF1EC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit', sans-serif", padding: "24px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", border: "1.5px solid #D9DED7", borderRadius: "14px", padding: "36px", maxWidth: "440px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Young Serif', serif", fontSize: "24px", color: "#0F1F18", marginBottom: "10px" }}>You're signed in</div>
        <p style={{ fontSize: "14px", color: "#63705F", lineHeight: "1.7" }}>{email}<br />Your client portal is being built — your contracts, videos, and reports will appear here.</p>
        <button onClick={signOut} style={{ marginTop: "18px", padding: "11px 22px", borderRadius: "9px", border: "1.5px solid #D9DED7", background: "#FBFCFA", color: "#1A241E", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Sign out</button>
      </div>
    </div>
  );
}
