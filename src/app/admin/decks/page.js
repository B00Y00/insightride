"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";

// ============================================================
// InsightRide — Admin: Decks index
// File location in repo: src/app/admin/decks/page.js
// Open at: /admin/decks  (admin sign-in required)
// Lists every contract with its deck status; opens the builder.
// ============================================================

const F = "'DM Sans', sans-serif";
const C = { bg: "#0E0E0C", card: "#1A1A18", card2: "#222220", border: "#2A2A28", gold: "#D4A017", text: "#E8E8E4", muted: "#888880", soft: "#A8A8A4", green: "#6EC4A7", amber: "#D4A76A" };

export default function AdminDecksIndex() {
  const [ready, setReady] = useState(false);
  const [contracts, setContracts] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data && data.session;
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
      if (!p || p.role !== "admin") {
        window.location.href = "/login";
        return;
      }
      setReady(true);
      const { data: rows } = await supabase.from("contracts").select("id, client, topic, deck, deck_version, deck_updated_at, regions, interviews_total, interviews_remaining, created_at").order("created_at", { ascending: false });
      setContracts(rows || []);
    })();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: F, paddingBottom: 60 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid " + C.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <a href="/admin" style={{ fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, textDecoration: "none" }}>
            InsightRide · Admin
          </a>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>Slide decks</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>One deck per contract. Saving a deck bumps its version; tablets re-sync automatically.</div>
        </div>
        <a href="/admin/tablet" style={{ padding: "10px 14px", borderRadius: 10, background: C.card2, color: C.soft, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          Tablet interviews
        </a>
      </div>
      <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
        {!ready && <div style={{ color: C.muted }}>Checking sign-in...</div>}
        {ready && contracts.length === 0 && <div style={{ color: C.muted }}>No contracts yet. Create one on the admin dashboard first.</div>}
        {contracts.map((c) => {
          const hasDeck = !!(c.deck && Array.isArray(c.deck.slides) && c.deck.slides.length > 0);
          const langs = hasDeck ? Object.keys(c.deck.languages || { [c.deck.default_language || "en"]: [] }) : [];
          const slides = hasDeck ? c.deck.slides.length : 0;
          const questions = hasDeck ? c.deck.slides.filter((s) => s.interactions && s.interactions[0]).length : 0;
          return (
            <div key={c.id} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: C.muted, letterSpacing: "0.05em", textTransform: "uppercase" }}>{c.client}</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{c.topic}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", fontSize: 11 }}>
                  {hasDeck ? (
                    <>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#1A2A20", color: C.green }}>deck v{c.deck_version}</span>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.soft }}>{slides} slides · {questions} questions</span>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.soft }}>{langs.join(", ").toUpperCase()}</span>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.soft }}>{(c.regions || []).length ? c.regions.join(", ") : "all regions"}</span>
                    </>
                  ) : (
                    <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.amber }}>no deck (script-only contract)</span>
                  )}
                  <span style={{ padding: "3px 8px", borderRadius: 6, background: C.card2, color: C.soft }}>{c.interviews_remaining}/{c.interviews_total} remaining</span>
                </div>
              </div>
              <a href={"/admin/decks/" + c.id} style={{ padding: "12px 16px", borderRadius: 10, background: C.gold, color: "#0E0E0C", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                {hasDeck ? "Edit deck" : "Create deck"}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
