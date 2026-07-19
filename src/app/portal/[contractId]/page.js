"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { useTheme, sans, mono, FONT_LINK, Icon } from "../theme";

const BUCKET = "interview-videos";

function FolderCard({ T, icon, title, note, onClick, active }) {
  return (
    <button onClick={onClick} style={{ background: active ? T.pineSoft : T.card, border: `1.5px solid ${active ? T.pine : T.line}`, borderRadius: "14px", padding: "18px 20px", textAlign: "left", cursor: "pointer", fontFamily: sans, display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ color: T.pine }}><Icon name={icon} size={22} /></span>
      <div style={{ fontSize: "15px", fontWeight: 600, color: T.text, letterSpacing: "-0.01em" }}>{title}</div>
      {note && <div style={{ fontSize: "12.5px", color: T.faint }}>{note}</div>}
    </button>
  );
}

export default function ContractFolder() {
  const { contractId } = useParams();
  const [T] = useTheme();
  const [state, setState] = useState("loading");
  const [contract, setContract] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [report, setReport] = useState(null);
  const [canDownload, setCanDownload] = useState(true);
  const [folder, setFolder] = useState("videos");
  const [openTranscript, setOpenTranscript] = useState(null);
  const [player, setPlayer] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: prof } = await supabase.from("profiles").select("allow_downloads").eq("id", user.id).single();
      if (prof) setCanDownload(prof.allow_downloads !== false);

      const { data: c } = await supabase.from("contracts")
        .select("id, client, topic, type, estimated_minutes, interviews_total, interviews_remaining")
        .eq("id", contractId).single();
      if (!c) { setState("denied"); return; }
      setContract(c);

      const { data: ivs } = await supabase.from("completed_interviews")
        .select("id, interview_number, video_url, transcript, ai_summary, status")
        .eq("contract_id", contractId)
        .order("interview_number", { ascending: true });
      setInterviews(ivs || []);

      const { data: reps } = await supabase.from("reports")
        .select("content, generated_at, interviews_included")
        .eq("contract_id", contractId).eq("approved", true)
        .order("generated_at", { ascending: false }).limit(1);
      if (reps && reps[0]) setReport(reps[0]);

      setState("ok");
    })();
  }, [contractId]);

  async function playVideo(iv) {
    setNotice("");
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(iv.video_url, 3600);
    if (error || !data?.signedUrl) { setNotice("Couldn't load this video. Please try again."); return; }
    setPlayer({ number: iv.interview_number, url: data.signedUrl });
  }

  async function downloadVideo(iv) {
    setNotice("");
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(iv.video_url, 3600, { download: `interview-${iv.interview_number}.mp4` });
    if (error || !data?.signedUrl) { setNotice("Couldn't prepare the download. Please try again."); return; }
    window.location.href = data.signedUrl;
  }

  function downloadPdf() {
    if (!report) return;
    const w = window.open("", "_blank");
    if (!w) { setNotice("Your browser blocked the report window — allow pop-ups for this site and try again."); return; }
    const safe = (report.content || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(`<!DOCTYPE html><html><head><title>InsightRide Report — ${contract.topic.replace(/</g, "")}</title>
      <style>
        body { font-family: 'Segoe UI', -apple-system, sans-serif; color: #1A241E; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.75; }
        .brand { font-size: 13px; letter-spacing: 0.12em; color: #1B6B4A; text-transform: uppercase; margin-bottom: 6px; font-weight: 600; }
        h1 { font-size: 24px; margin: 0 0 4px; }
        .meta { font-size: 12px; color: #63705F; margin-bottom: 28px; border-bottom: 1px solid #D9DED7; padding-bottom: 14px; }
        pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; }
        @media print { body { margin: 12mm; } }
      </style></head><body>
      <div class="brand">InsightRide Research</div>
      <h1>${contract.topic.replace(/</g, "&lt;")}</h1>
      <div class="meta">Report generated ${new Date(report.generated_at).toLocaleDateString()} · based on ${report.interviews_included} interviews</div>
      <pre>${safe}</pre>
      <script>window.onload = function(){ window.print(); };</script>
      </body></html>`);
    w.document.close();
  }

  if (state === "loading") return <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontFamily: sans, fontSize: "14px" }}>Opening contract…</div>;

  if (state === "denied") return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: sans, padding: "24px", textAlign: "center" }}>
      <div style={{ fontSize: "19px", fontWeight: 700, color: T.text, marginBottom: "8px" }}>Contract not available</div>
      <div style={{ fontSize: "14px", color: T.faint, marginBottom: "18px" }}>This contract isn't assigned to your account.</div>
      <a href="/portal" style={{ padding: "11px 20px", borderRadius: "9px", background: T.pine, color: "#fff", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>Back to your portal</a>
    </div>
  );

  const withVideo = interviews.filter((iv) => iv.video_url);
  const withTranscript = interviews.filter((iv) => iv.transcript);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans, paddingBottom: "60px" }}>
      <link href={FONT_LINK} rel="stylesheet" />

      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <a href="/portal/settings" title="Settings" style={{ display: "flex", alignItems: "center", color: "#B9C6BB", textDecoration: "none" }}><Icon name="settings" size={18} /></a>
          <a href="/portal" style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← All contracts</a>
        </div>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "8px" }}>{(contract.type || "RESEARCH").toUpperCase()}</div>
        <h1 style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text, margin: "0 0 24px", lineHeight: "1.35" }}>{contract.topic}</h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px", marginBottom: "28px" }}>
          <FolderCard T={T} icon="video" title="Videos" note={`${withVideo.length} item${withVideo.length === 1 ? "" : "s"}`} onClick={() => setFolder("videos")} active={folder === "videos"} />
          <FolderCard T={T} icon="transcript" title="Transcripts" note={`${withTranscript.length} item${withTranscript.length === 1 ? "" : "s"}`} onClick={() => setFolder("transcripts")} active={folder === "transcripts"} />
          <FolderCard T={T} icon="report" title="Report" note={report ? "Ready to read" : "In preparation"} onClick={() => setFolder("report")} active={folder === "report"} />
          <FolderCard T={T} icon="stats" title="Statistics" onClick={() => { window.location.href = `/portal/${contractId}/stats`; }} active={false} />
          <FolderCard T={T} icon="chat" title="Interview HelpBot" note="This HelpBot can answer questions regarding data from the interview" onClick={() => { window.location.href = `/portal/${contractId}/chat`; }} active={false} />
        </div>

        {notice && <div style={{ padding: "11px 14px", borderRadius: "9px", background: T.errBg, color: T.errText, fontSize: "13px", marginBottom: "16px" }}>{notice}</div>}

        {folder === "videos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {withVideo.length === 0 && <div style={{ color: T.faint, fontSize: "14px" }}>No interview videos yet.</div>}
            {withVideo.map((iv) => (
              <div key={iv.id} style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "12px", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ fontSize: "14.5px", fontWeight: 600, color: T.text }}>Interview {iv.interview_number}</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => playVideo(iv)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 16px", borderRadius: "8px", border: "none", background: T.pine, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                    <Icon name="video" size={14} /> Play
                  </button>
                  {canDownload && (
                    <button onClick={() => downloadVideo(iv)} style={{ padding: "9px 16px", borderRadius: "8px", border: `1.5px solid ${T.line}`, background: T.inputBg, color: T.text, fontSize: "13px", cursor: "pointer", fontFamily: sans }}>Download</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {folder === "transcripts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {withTranscript.length === 0 && <div style={{ color: T.faint, fontSize: "14px" }}>Transcripts appear here once interviews are processed.</div>}
            {withTranscript.map((iv) => (
              <div key={iv.id} style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "12px", padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ fontSize: "14.5px", fontWeight: 600, color: T.text }}>Interview {iv.interview_number}</div>
                  <button onClick={() => setOpenTranscript(openTranscript === iv.id ? null : iv.id)} style={{ padding: "8px 14px", borderRadius: "8px", border: `1.5px solid ${T.line}`, background: T.inputBg, color: T.text, fontSize: "13px", cursor: "pointer", fontFamily: sans }}>
                    {openTranscript === iv.id ? "Close" : "Read"}
                  </button>
                </div>
                {openTranscript === iv.id && (
                  <div style={{ marginTop: "14px" }}>
                    {iv.ai_summary && (
                      <div style={{ background: T.pineSoft, border: `1px solid ${T.line}`, borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
                        <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "6px" }}>SUMMARY</div>
                        <div style={{ fontSize: "14px", color: T.text, lineHeight: "1.7" }}>{iv.ai_summary}</div>
                      </div>
                    )}
                    <div style={{ fontFamily: mono, fontSize: "10px", color: T.faint, letterSpacing: "0.1em", marginBottom: "6px" }}>FULL TRANSCRIPT</div>
                    <div style={{ fontSize: "13.5px", color: T.text, lineHeight: "1.8", whiteSpace: "pre-wrap", maxHeight: "420px", overflowY: "auto", paddingRight: "6px" }}>{iv.transcript}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {folder === "report" && !report && (
          <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "34px", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", color: T.pine }}><Icon name="report" size={30} /></div>
            <div style={{ fontSize: "17px", fontWeight: 700, color: T.text, marginBottom: "8px" }}>Your report is being prepared</div>
            <div style={{ fontSize: "14px", color: T.faint, lineHeight: "1.7", maxWidth: "420px", margin: "0 auto" }}>
              Once enough interviews are completed and the findings are reviewed, your full report will appear here.
            </div>
          </div>
        )}

        {folder === "report" && report && (
          <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "18px", borderBottom: `1px solid ${T.line}`, paddingBottom: "16px" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "6px" }}>FINAL REPORT</div>
                <div style={{ fontSize: "12.5px", color: T.faint }}>Generated {new Date(report.generated_at).toLocaleDateString()} · based on {report.interviews_included} interviews</div>
              </div>
              <button onClick={downloadPdf} style={{ padding: "10px 18px", borderRadius: "9px", border: "none", background: T.pine, color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: sans }}>
                Download PDF
              </button>
            </div>
            <div style={{ fontSize: "14.5px", color: T.text, lineHeight: "1.85", whiteSpace: "pre-wrap" }}>{report.content}</div>
          </div>
        )}
      </div>

      {player && (
        <div onClick={() => setPlayer(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,16,12,0.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.ink, borderRadius: "14px", padding: "16px", width: "100%", maxWidth: "760px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#EEF1EC" }}>Interview {player.number}</span>
              <button onClick={() => setPlayer(null)} style={{ background: "none", border: "none", color: "#B9C6BB", fontSize: "14px", cursor: "pointer", fontFamily: sans }}>Close ✕</button>
            </div>
            <video src={player.url} controls autoPlay style={{ width: "100%", borderRadius: "8px", background: "#000" }} />
          </div>
        </div>
      )}
    </div>
  );
}
