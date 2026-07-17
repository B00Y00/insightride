"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", porcelain = "#EEF1EC", card = "#FFFFFF",
  line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";
const BUCKET = "interview-videos";

function ProgressBar({ done }) {
  const [pct, setPct] = useState(4);
  useEffect(() => {
    if (done) { setPct(100); return; }
    const t = setInterval(() => {
      setPct((p) => {
        if (p >= 90) return p;
        const step = Math.random() < 0.25 ? 0 : Math.random() * 9; // stutters
        return Math.min(90, p + step);
      });
    }, 450);
    return () => clearInterval(t);
  }, [done]);
  return (
    <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "16px 18px", maxWidth: "85%" }}>
      <div style={{ fontSize: "13.5px", color: text, marginBottom: "10px" }}>Analyzing your interviews, this may take a moment…</div>
      <div style={{ height: "8px", background: "#E9EDE7", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pine, borderRadius: "4px", transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { contractId } = useParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const [counter, setCounter] = useState(null);
  const [paused, setPaused] = useState(false);
  const [atLimit, setAtLimit] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [videos, setVideos] = useState({}); // interview_number -> video_url
  const [player, setPlayer] = useState(null); // { number, url, seek }
  const bottomRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      // Upfront counter + pause state
      const [{ data: link }, { count: used }, { data: logs }, { data: ivs }, { data: reqs }] = await Promise.all([
        supabase.from("client_contracts").select("prompt_allowance, chat_paused").eq("client_id", user.id).eq("contract_id", contractId).maybeSingle(),
        supabase.from("chat_logs").select("id", { count: "exact", head: true }).eq("client_id", user.id).eq("contract_id", contractId).eq("status", "answered"),
        supabase.from("chat_logs").select("question, answer, status, evidence").eq("contract_id", contractId).eq("client_id", user.id).order("created_at", { ascending: true }).limit(60),
        supabase.from("completed_interviews").select("interview_number, video_url").eq("contract_id", contractId),
        supabase.from("prompt_requests").select("id").eq("client_id", user.id).eq("contract_id", contractId).eq("status", "pending"),
      ]);
      if (link) {
        const allowance = link.prompt_allowance ?? 50;
        setCounter({ used: used || 0, allowance });
        setPaused(!!link.chat_paused);
        setAtLimit((used || 0) >= allowance);
      }
      if (reqs && reqs.length) setRequestSent(true);
      const map = {};
      (ivs || []).forEach((iv) => { if (iv.video_url) map[iv.interview_number] = iv.video_url; });
      setVideos(map);
      const restored = [];
      (logs || []).forEach((l) => {
        restored.push({ role: "user", text: l.question });
        if (l.answer) restored.push({ role: "ai", text: l.answer, evidence: l.evidence || [] });
        else if (l.status === "flagged") restored.push({ role: "ai", text: "That question wasn't related to this research, so it didn't use a prompt." });
      });
      setMessages(restored);
    })();
  }, [contractId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function watchEvidence(e) {
    const path = videos[e.interview_number];
    if (!path) return;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) setPlayer({ number: e.interview_number, url: data.signedUrl, seek: Math.max(0, (e.timestamp || 0) - 2) });
  }

  async function requestMore() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("prompt_requests").insert([{ client_id: user.id, contract_id: contractId }]);
    if (!error) setRequestSent(true);
  }

  async function send() {
    const q = input.trim();
    if (!q || busy || paused || atLimit) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true); setJustDone(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/portal/chat", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ contractId, question: q }),
      });
      const data = await res.json();
      setJustDone(true);
      await new Promise((r) => setTimeout(r, 550)); // let the bar hit 100%
      if (data.paused) { setPaused(true); setMessages((m) => [...m, { role: "ai", text: data.answer }]); }
      else if (data.limitReached) { setAtLimit(true); setCounter({ used: data.used, allowance: data.allowance }); setMessages((m) => [...m, { role: "ai", text: `You've used all ${data.allowance} questions for this contract.` }]); }
      else if (data.error) { setMessages((m) => [...m, { role: "ai", text: data.error }]); }
      else {
        if (data.used != null) { setCounter({ used: data.used, allowance: data.allowance }); setAtLimit(data.used >= data.allowance); }
        setMessages((m) => [...m, { role: "ai", text: data.answer, evidence: data.evidence || [] }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Connection problem — that didn't use one of your prompts. Please try again." }]);
    } finally { setBusy(false); setJustDone(false); }
  }

  const inputDisabled = busy || paused || atLimit;

  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: ink, padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: serif, fontSize: "22px", color: porcelain }}>InsightRide</div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {counter && <span style={{ fontFamily: mono, fontSize: "11px", color: counter.used >= counter.allowance ? "#E0A090" : "#7FA893" }}>{counter.used} / {counter.allowance} QUESTIONS USED</span>}
          <a href={`/portal/${contractId}`} style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to contract</a>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: "760px", width: "100%", margin: "0 auto", padding: "28px 24px 150px", boxSizing: "border-box" }}>
        {messages.length === 0 && (
          <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "24px", fontSize: "14px", color: faint, lineHeight: "1.8" }}>
            <div style={{ fontFamily: serif, fontSize: "17px", color: ink, marginBottom: "8px" }}>Ask your research data</div>
            Ask about your respondents and findings — for example: <em>"What percent of respondents said distance was a barrier?"</em> or <em>"What did people say about the fees?"</em> Every number is an exact count of your interviews, and answers show the evidence behind them.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: "14px" }}>
            <div style={{ maxWidth: "85%", background: m.role === "user" ? pine : card, color: m.role === "user" ? "#fff" : text, border: m.role === "user" ? "none" : `1.5px solid ${line}`, borderRadius: "14px", padding: "13px 16px", fontSize: "14px", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
              {m.text}
              {m.evidence && m.evidence.length > 0 && (
                <div style={{ marginTop: "12px", borderTop: `1px solid ${line}`, paddingTop: "10px" }}>
                  <div style={{ fontFamily: mono, fontSize: "10px", color: pine, letterSpacing: "0.1em", marginBottom: "6px" }}>EVIDENCE</div>
                  {m.evidence.map((e, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "7px" }}>
                      <div style={{ flex: 1, fontSize: "13px", color: faint }}>Interview {e.interview_number}: “{e.quote}”</div>
                      {videos[e.interview_number] ? (
                        <button onClick={() => watchEvidence(e)} style={{ padding: "5px 11px", borderRadius: "7px", border: "none", background: pine, color: "#fff", fontSize: "11.5px", fontWeight: "600", cursor: "pointer", fontFamily: sans, whiteSpace: "nowrap" }}>▶ Watch</button>
                      ) : (
                        <span style={{ fontSize: "10.5px", color: "#A8B2A6", whiteSpace: "nowrap", paddingTop: "3px" }}>video unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <ProgressBar done={justDone} />}
        {atLimit && !paused && (
          <div style={{ background: "#FDF6E7", border: "1.5px solid #EAD9A8", borderRadius: "12px", padding: "16px", marginTop: "8px" }}>
            <div style={{ fontSize: "13.5px", color: "#7A6320", marginBottom: "10px" }}>You've used all your questions for this contract.</div>
            {requestSent ? (
              <div style={{ fontSize: "13px", color: "#7A6320", fontWeight: "600" }}>✓ Request sent — InsightRide has been notified.</div>
            ) : (
              <button onClick={requestMore} style={{ padding: "10px 16px", borderRadius: "9px", border: "none", background: pine, color: "#fff", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: sans }}>Request extra prompts</button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: `linear-gradient(transparent, ${porcelain} 30%)`, padding: "30px 24px 22px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", gap: "10px" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={inputDisabled}
            placeholder={paused ? "Questions paused — contact InsightRide" : atLimit ? "Question limit reached" : "Ask a question about this research…"}
            style={{ flex: 1, padding: "15px 18px", borderRadius: "12px", border: `1.5px solid ${line}`, background: inputDisabled ? "#F0F2EE" : card, fontSize: "14.5px", fontFamily: sans, color: text, outline: "none" }} />
          <button onClick={send} disabled={inputDisabled || !input.trim()} style={{ padding: "0 24px", borderRadius: "12px", border: "none", background: inputDisabled || !input.trim() ? "#B9C6BB" : pine, color: "#fff", fontSize: "14.5px", fontWeight: "600", cursor: inputDisabled || !input.trim() ? "not-allowed" : "pointer", fontFamily: sans }}>Ask</button>
        </div>
      </div>

      {player && (
        <div onClick={() => setPlayer(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,31,24,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: ink, borderRadius: "14px", padding: "16px", width: "100%", maxWidth: "760px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontFamily: serif, fontSize: "15px", color: porcelain }}>Interview {player.number} — jumping to the quoted moment</span>
              <button onClick={() => setPlayer(null)} style={{ background: "none", border: "none", color: "#B9C6BB", fontSize: "14px", cursor: "pointer", fontFamily: sans }}>Close ✕</button>
            </div>
            <video src={player.url} controls autoPlay onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = player.seek; } catch {} }} style={{ width: "100%", borderRadius: "8px", background: "#000" }} />
          </div>
        </div>
      )}
    </div>
  );
}
