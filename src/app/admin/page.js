"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";

const AGE_OPTIONS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const GENDER_OPTIONS = ["Any", "Male", "Female", "Non-binary"];
const ETHNICITY_OPTIONS = ["Any", "White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other"];
const PROFESSION_OPTIONS = ["Any", "Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired"];
const INTERVIEW_TYPES = ["Open-ended", "Semi-structured", "Structured survey"];

// ── Quota sampling: dimensions a quota group can constrain on ──
const QUOTA_DIMENSIONS = [
  { key: "ageRange", label: "Age", options: AGE_OPTIONS },
  { key: "gender", label: "Gender", options: ["Male", "Female", "Non-binary"] },
  { key: "ethnicity", label: "Ethnicity", options: ETHNICITY_OPTIONS.filter((o) => o !== "Any") },
  { key: "profession", label: "Profession", options: PROFESSION_OPTIONS.filter((o) => o !== "Any") },
];

// Stable unique id for each quota group (used later to count completed interviews per group)
function makeCellId() {
  return "cell_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Human-readable label built from whichever dimensions are constrained
function cellLabel(constraints) {
  const parts = QUOTA_DIMENSIONS.map((d) => constraints[d.key]).filter(Boolean);
  return parts.length ? parts.join(" · ") : "Anyone";
}

function LiveMap({ interviewers }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;

    // Dynamic import so Leaflet never runs on the server
    import("leaflet").then((L) => {
      if (!mapInstanceRef.current && mapRef.current) {
        mapInstanceRef.current = L.map(mapRef.current).setView([43.7, -79.4], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "\u00a9 OpenStreetMap contributors",
        }).addTo(mapInstanceRef.current);
        setMapReady(true);
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update markers when interviewers change
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      // Clear old markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Add new markers
      interviewers.forEach((iv) => {
        if (iv.latitude && iv.longitude) {
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${iv.status === "interviewing" ? "#D4A017" : "#6EC4A7"};border:2px solid #0E0E0C;box-shadow:0 0 8px ${iv.status === "interviewing" ? "#D4A017" : "#6EC4A7"}44;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          const marker = L.marker([iv.latitude, iv.longitude], { icon })
            .addTo(mapInstanceRef.current)
            .bindPopup(`<b>${iv.name}</b><br>${iv.status === "interviewing" ? "\ud83c\udf99\ufe0f Interviewing" : "\ud83d\udfe2 Available"}`);
          markersRef.current.push(marker);
        }
      });
    });
  }, [interviewers, mapReady]);

  return <div ref={mapRef} style={{ height: "360px", borderRadius: "12px", border: "1px solid #2A2A28" }} />;
}

export default function AdminDashboard() {
  const [tab, setTab] = useState("contracts"); // contracts | create | interviewers | map
  const [contracts, setContracts] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Contract creation form state
  const [form, setForm] = useState({
    client: "",
    topic: "",
    type: "Open-ended",
    estimated_minutes: 20,
    interviewer_payout: 50,
    interviewee_incentive: 35,
    interviews_total: 30,
    age_ranges: [],
    genders: ["Any"],
    ethnicities: ["Any"],
    professions: ["Any"],
    interviewee_demographics: [],
    quotas: [],
    questions: [{ question: "", type: "opener", follow_ups: [""] }],
    objective: "",
    tips: [""],
  });

  // Load contracts from Supabase
  useEffect(() => {
    loadContracts();
    loadInterviewers();

    // Real-time subscription for contracts
    const contractsSub = supabase
      .channel("contracts-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "contracts" }, () => {
        loadContracts();
      })
      .subscribe();

    // Real-time subscription for interviewer locations
    const interviewersSub = supabase
      .channel("interviewers-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "interviewer_locations" }, () => {
        loadInterviewers();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(contractsSub);
      supabase.removeChannel(interviewersSub);
    };
  }, []);

  async function loadContracts() {
    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setContracts(data);
    setLoading(false);
  }

  async function loadInterviewers() {
    const { data } = await supabase
      .from("interviewer_locations")
      .select("*")
      .gte("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()); // Last 10 min
    if (data) setInterviewers(data);
  }

  // ── Quota group handlers ──
  function addQuotaCell() {
    setForm((f) => ({
      ...f,
      quotas: [...f.quotas, { id: makeCellId(), constraints: { ageRange: null, gender: null, ethnicity: null, profession: null }, target: 10 }],
    }));
  }
  function updateQuotaConstraint(cellId, key, value) {
    setForm((f) => ({
      ...f,
      quotas: f.quotas.map((c) => (c.id === cellId ? { ...c, constraints: { ...c.constraints, [key]: value || null } } : c)),
    }));
  }
  function updateQuotaTarget(cellId, value) {
    setForm((f) => ({
      ...f,
      quotas: f.quotas.map((c) => (c.id === cellId ? { ...c, target: value } : c)),
    }));
  }
  function removeQuotaCell(cellId) {
    setForm((f) => ({ ...f, quotas: f.quotas.filter((c) => c.id !== cellId) }));
  }

  async function createContract() {
    setSaving(true);
    setSaveMessage("");

    // Clean quota groups: strip empty dimensions, attach a readable label, drop zero-target groups
    const cleanedQuotas = form.quotas
      .map((cell) => {
        const constraints = {};
        QUOTA_DIMENSIONS.forEach((d) => {
          if (cell.constraints[d.key]) constraints[d.key] = cell.constraints[d.key];
        });
        return { id: cell.id, label: cellLabel(cell.constraints), constraints, target: parseInt(cell.target) || 0 };
      })
      .filter((cell) => cell.target > 0);

    // If quotas are used, the contract total is the sum of group targets; otherwise the manual number
    const totalFromQuotas = cleanedQuotas.reduce((sum, c) => sum + c.target, 0);
    const effectiveTotal = cleanedQuotas.length > 0 ? totalFromQuotas : form.interviews_total;

    const contractData = {
      client: form.client,
      topic: form.topic,
      type: form.type,
      estimated_minutes: form.estimated_minutes,
      interviewer_payout: form.interviewer_payout,
      interviewee_incentive: form.interviewee_incentive,
      interviews_total: effectiveTotal,
      interviews_remaining: effectiveTotal,
      demographics: {
        ageRanges: form.age_ranges.length > 0 ? form.age_ranges : ["Any"],
        genders: form.genders,
        ethnicities: form.ethnicities,
        professions: form.professions,
      },
      interviewee_demographics: form.interviewee_demographics,
      quotas: cleanedQuotas,
      guide: {
        objective: form.objective,
        questions: form.questions.filter((q) => q.question.trim() !== ""),
        tips: form.tips.filter((t) => t.trim() !== ""),
      },
    };

    const { error } = await supabase.from("contracts").insert([contractData]);

    if (error) {
      setSaveMessage("Error: " + error.message);
    } else {
      setSaveMessage("Contract created! It will appear on all interviewer devices within seconds.");
      setForm({
        client: "", topic: "", type: "Open-ended", estimated_minutes: 20,
        interviewer_payout: 50, interviewee_incentive: 35, interviews_total: 30,
        age_ranges: [], genders: ["Any"], ethnicities: ["Any"], professions: ["Any"],
        interviewee_demographics: [], quotas: [], questions: [{ question: "", type: "opener", follow_ups: [""] }],
        objective: "", tips: [""],
      });
      setTab("contracts");
    }
    setSaving(false);
  }

  async function deleteContract(id) {
    if (confirm("Delete this contract? This cannot be undone.")) {
      await supabase.from("contracts").delete().eq("id", id);
      loadContracts();
    }
  }

  const F = "var(--font-sans)";
  const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#1A1A18", color: "#E8E8E4", fontSize: "14px", fontFamily: F, boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "6px", fontFamily: F };

  // Derived quota values for the form display
  const usingQuotas = form.quotas.length > 0;
  const quotaTotal = form.quotas.reduce((sum, c) => sum + (parseInt(c.target) || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <a href="/" style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "500", textDecoration: "none" }}>InsightRide</a>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "2px" }}>Admin Dashboard</div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ background: "#1A1A18", borderRadius: "10px", padding: "8px 14px", textAlign: "center" }}>
              <div style={{ fontSize: "18px", fontWeight: "600", color: "#D4A017" }}>{contracts.length}</div>
              <div style={{ fontSize: "11px", color: "#888880" }}>contracts</div>
            </div>
            <div style={{ background: "#1A1A18", borderRadius: "10px", padding: "8px 14px", textAlign: "center" }}>
              <div style={{ fontSize: "18px", fontWeight: "600", color: "#6EC4A7" }}>{interviewers.length}</div>
              <div style={{ fontSize: "11px", color: "#888880" }}>online</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "0 24px", borderBottom: "1px solid #1A1A18", overflowX: "auto" }}>
        {[["contracts", "Contracts"], ["create", "Create New"], ["map", "Live Map"]].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} style={{ padding: "14px 20px", background: "none", border: "none", borderBottom: tab === v ? "2px solid #D4A017" : "2px solid transparent", color: tab === v ? "#D4A017" : "#888880", fontSize: "14px", fontWeight: tab === v ? "600" : "400", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 24px", maxWidth: "800px" }}>

        {/* Contracts list */}
        {tab === "contracts" && (
          <div>
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#888880" }}>Loading contracts...</div>
            ) : contracts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px" }}>
                <div style={{ fontSize: "16px", color: "#888880", marginBottom: "12px" }}>No contracts yet</div>
                <button onClick={() => setTab("create")} style={{ padding: "12px 24px", borderRadius: "10px", border: "none", background: "#D4A017", color: "#0E0E0C", fontSize: "14px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>Create your first contract</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {contracts.map((c) => {
                  const progress = ((c.interviews_total - c.interviews_remaining) / c.interviews_total) * 100;
                  return (
                    <div key={c.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "14px", padding: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div>
                          <div style={{ fontSize: "11px", color: "#888880", fontWeight: "500", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "2px" }}>{c.client}</div>
                          <div style={{ fontSize: "15px", color: "#E8E8E4", fontWeight: "500", lineHeight: "1.4" }}>{c.topic}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "16px" }}>
                          <div style={{ fontSize: "18px", fontWeight: "700", color: "#D4A017" }}>${c.interviewer_payout}</div>
                          <div style={{ fontSize: "11px", color: "#888880" }}>per interview</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                        <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>{c.type}</span>
                        <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>~{c.estimated_minutes} min</span>
                        <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>Interviewee: ${c.interviewee_incentive}</span>
                        {Array.isArray(c.quotas) && c.quotas.length > 0 && (
                          <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#1A2A20", color: "#6EC4A7" }}>{c.quotas.length} quota groups</span>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", color: "#888880" }}>Progress</span>
                        <span style={{ fontSize: "11px", color: "#A8A8A4", fontWeight: "500" }}>{c.interviews_remaining} / {c.interviews_total} remaining</span>
                      </div>
                      <div style={{ height: "4px", background: "#2A2A28", borderRadius: "2px", overflow: "hidden", marginBottom: "10px" }}>
                        <div style={{ height: "100%", width: `${progress}%`, background: c.interviews_remaining < 10 ? "#E06050" : "#4A8A6A", borderRadius: "2px" }} />
                      </div>
                      <button onClick={() => deleteContract(c.id)} style={{ fontSize: "12px", color: "#E06050", background: "none", border: "none", cursor: "pointer", fontFamily: F, padding: "4px 0" }}>Delete contract</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Create contract */}
        {tab === "create" && (
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#E8E8E4", marginBottom: "20px" }}>Create new contract</h2>

            {/* Basic info */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Client name</label>
              <input style={inputStyle} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="e.g. Scotiabank" />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Research topic</label>
              <input style={inputStyle} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Mobile banking adoption barriers among newcomers" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div>
                <label style={labelStyle}>Interview type</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Duration (minutes)</label>
                <input type="number" style={inputStyle} value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: parseInt(e.target.value) || 0 })} />
              </div>
            </div>

            {/* Payouts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div>
                <label style={labelStyle}>Interviewer payout ($)</label>
                <input type="number" style={inputStyle} value={form.interviewer_payout} onChange={(e) => setForm({ ...form, interviewer_payout: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label style={labelStyle}>Interviewee incentive ($)</label>
                <input type="number" style={inputStyle} value={form.interviewee_incentive} onChange={(e) => setForm({ ...form, interviewee_incentive: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label style={labelStyle}>Total interviews needed</label>
                {usingQuotas ? (
                  <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: "#6EC4A7", background: "#141816", cursor: "not-allowed" }}>
                    {quotaTotal} (from quotas)
                  </div>
                ) : (
                  <input type="number" style={inputStyle} value={form.interviews_total} onChange={(e) => setForm({ ...form, interviews_total: parseInt(e.target.value) || 0 })} />
                )}
              </div>
            </div>

            {/* Demographics */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Required age ranges (click to select)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {AGE_OPTIONS.map((a) => (
                  <button key={a} onClick={() => setForm({ ...form, age_ranges: form.age_ranges.includes(a) ? form.age_ranges.filter((x) => x !== a) : [...form.age_ranges, a] })} style={{ padding: "8px 14px", borderRadius: "20px", border: form.age_ranges.includes(a) ? "2px solid #D4A017" : "1.5px solid #3A3A38", background: form.age_ranges.includes(a) ? "#2A2520" : "#1E1E1C", color: form.age_ranges.includes(a) ? "#F0D060" : "#A8A8A4", fontSize: "13px", fontWeight: form.age_ranges.includes(a) ? "600" : "400", cursor: "pointer", fontFamily: F }}>
                    {a}
                  </button>
                ))}
              </div>
              {form.age_ranges.length === 0 && <div style={{ fontSize: "11px", color: "#888880", marginTop: "4px" }}>No selection = accepts any age</div>}
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Required ethnicities</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {ETHNICITY_OPTIONS.map((e) => (
                  <button key={e} onClick={() => { if (e === "Any") { setForm({ ...form, ethnicities: ["Any"] }); } else { const current = form.ethnicities.filter((x) => x !== "Any"); setForm({ ...form, ethnicities: current.includes(e) ? current.filter((x) => x !== e) : [...current, e] }); } }} style={{ padding: "8px 14px", borderRadius: "20px", border: form.ethnicities.includes(e) ? "2px solid #D4A017" : "1.5px solid #3A3A38", background: form.ethnicities.includes(e) ? "#2A2520" : "#1E1E1C", color: form.ethnicities.includes(e) ? "#F0D060" : "#A8A8A4", fontSize: "13px", fontWeight: form.ethnicities.includes(e) ? "600" : "400", cursor: "pointer", fontFamily: F }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Required professions</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {PROFESSION_OPTIONS.map((p) => (
                  <button key={p} onClick={() => { if (p === "Any") { setForm({ ...form, professions: ["Any"] }); } else { const current = form.professions.filter((x) => x !== "Any"); setForm({ ...form, professions: current.includes(p) ? current.filter((x) => x !== p) : [...current, p] }); } }} style={{ padding: "8px 14px", borderRadius: "20px", border: form.professions.includes(p) ? "2px solid #D4A017" : "1.5px solid #3A3A38", background: form.professions.includes(p) ? "#2A2520" : "#1E1E1C", color: form.professions.includes(p) ? "#F0D060" : "#A8A8A4", fontSize: "13px", fontWeight: form.professions.includes(p) ? "600" : "400", cursor: "pointer", fontFamily: F }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Who collects demographic data */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Interviewee self-reports these demographics (rest handled by interviewer)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[["ageRange", "Age"], ["gender", "Gender"], ["ethnicity", "Ethnicity"], ["profession", "Profession"]].map(([key, label]) => (
                  <button key={key} onClick={() => setForm({ ...form, interviewee_demographics: form.interviewee_demographics.includes(key) ? form.interviewee_demographics.filter((x) => x !== key) : [...form.interviewee_demographics, key] })} style={{ padding: "8px 14px", borderRadius: "20px", border: form.interviewee_demographics.includes(key) ? "2px solid #6EC4A7" : "1.5px solid #3A3A38", background: form.interviewee_demographics.includes(key) ? "#1A2A20" : "#1E1E1C", color: form.interviewee_demographics.includes(key) ? "#6EC4A7" : "#A8A8A4", fontSize: "13px", fontWeight: form.interviewee_demographics.includes(key) ? "600" : "400", cursor: "pointer", fontFamily: F }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quota targets */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Quota targets (optional)</label>
              <p style={{ fontSize: "12px", color: "#888880", lineHeight: "1.5", margin: "0 0 12px" }}>
                Set how many interviews you need from each group. Add a group, choose the demographics that define it (leave a field on "Any" to not constrain it), and set a target. Leave this empty to just use one overall total.
              </p>

              {form.quotas.map((cell) => (
                <div key={cell.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "8px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                    {QUOTA_DIMENSIONS.map((d) => (
                      <div key={d.key}>
                        <div style={{ fontSize: "11px", color: "#888880", marginBottom: "4px" }}>{d.label}</div>
                        <select style={{ ...inputStyle, cursor: "pointer", fontSize: "13px" }} value={cell.constraints[d.key] || ""} onChange={(e) => updateQuotaConstraint(cell.id, d.key, e.target.value)}>
                          <option value="">Any</option>
                          {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "13px", color: "#888880" }}>Target</span>
                      <input type="number" min="1" style={{ ...inputStyle, width: "90px", fontSize: "13px" }} value={cell.target} onChange={(e) => updateQuotaTarget(cell.id, e.target.value)} />
                      <span style={{ fontSize: "13px", color: "#A8A8A4" }}>interviews</span>
                    </div>
                    <button onClick={() => removeQuotaCell(cell.id)} style={{ fontSize: "12px", color: "#E06050", background: "none", border: "none", cursor: "pointer", fontFamily: F }}>Remove</button>
                  </div>
                  <div style={{ fontSize: "11px", color: "#6EC4A7", marginTop: "10px", fontWeight: "500" }}>{cellLabel(cell.constraints)}</div>
                </div>
              ))}

              <button onClick={addQuotaCell} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px dashed #3A3A38", background: "none", color: "#888880", fontSize: "13px", cursor: "pointer", fontFamily: F, width: "100%" }}>+ Add quota group</button>

              {usingQuotas && (
                <div style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "#1A2A20", color: "#6EC4A7", fontSize: "13px" }}>
                  Total across all quota groups: <strong>{quotaTotal}</strong> interviews — this sets the contract's total automatically.
                </div>
              )}
            </div>

            {/* Research objective */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Research objective</label>
              <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="What does the client need to learn from this research?" />
            </div>

            {/* Questions */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Interview questions</label>
              {form.questions.map((q, qi) => (
                <div key={qi} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "8px" }}>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <select style={{ ...inputStyle, width: "140px", fontSize: "12px" }} value={q.type} onChange={(e) => { const qs = [...form.questions]; qs[qi].type = e.target.value; setForm({ ...form, questions: qs }); }}>
                      <option value="opener">Warm-up</option>
                      <option value="core">Core</option>
                      <option value="projective">Projective</option>
                      <option value="screening">Screening</option>
                    </select>
                    <input style={{ ...inputStyle, flex: 1 }} value={q.question} onChange={(e) => { const qs = [...form.questions]; qs[qi].question = e.target.value; setForm({ ...form, questions: qs }); }} placeholder="Enter your question..." />
                  </div>
                  {q.follow_ups.map((fu, fi) => (
                    <div key={fi} style={{ display: "flex", gap: "8px", marginBottom: "4px", paddingLeft: "20px" }}>
                      <span style={{ color: "#4A8A6A", fontSize: "12px", lineHeight: "40px" }}>→</span>
                      <input style={{ ...inputStyle, flex: 1, fontSize: "13px" }} value={fu} onChange={(e) => { const qs = [...form.questions]; qs[qi].follow_ups[fi] = e.target.value; setForm({ ...form, questions: qs }); }} placeholder="Follow-up probe..." />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px", paddingLeft: "20px" }}>
                    <button onClick={() => { const qs = [...form.questions]; qs[qi].follow_ups.push(""); setForm({ ...form, questions: qs }); }} style={{ fontSize: "12px", color: "#6EC4A7", background: "none", border: "none", cursor: "pointer", fontFamily: F }}>+ Add follow-up</button>
                    {form.questions.length > 1 && (
                      <button onClick={() => setForm({ ...form, questions: form.questions.filter((_, i) => i !== qi) })} style={{ fontSize: "12px", color: "#E06050", background: "none", border: "none", cursor: "pointer", fontFamily: F }}>Remove question</button>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={() => setForm({ ...form, questions: [...form.questions, { question: "", type: "core", follow_ups: [""] }] })} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px dashed #3A3A38", background: "none", color: "#888880", fontSize: "13px", cursor: "pointer", fontFamily: F, width: "100%" }}>+ Add another question</button>
            </div>

            {/* Tips */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Interviewer tips (tailored to this contract)</label>
              {form.tips.map((tip, ti) => (
                <div key={ti} style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={tip} onChange={(e) => { const ts = [...form.tips]; ts[ti] = e.target.value; setForm({ ...form, tips: ts }); }} placeholder="e.g. Let the interviewee tell stories — specific anecdotes are more valuable than general opinions" />
                  {form.tips.length > 1 && (
                    <button onClick={() => setForm({ ...form, tips: form.tips.filter((_, i) => i !== ti) })} style={{ fontSize: "14px", color: "#E06050", background: "none", border: "none", cursor: "pointer", padding: "0 8px" }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={() => setForm({ ...form, tips: [...form.tips, ""] })} style={{ padding: "8px 16px", borderRadius: "10px", border: "1px dashed #3A3A38", background: "none", color: "#888880", fontSize: "13px", cursor: "pointer", fontFamily: F }}>+ Add tip</button>
            </div>

            {/* Save */}
            {saveMessage && (
              <div style={{ padding: "12px 14px", borderRadius: "10px", background: saveMessage.startsWith("Error") ? "#3A2020" : "#1A2A20", color: saveMessage.startsWith("Error") ? "#E06050" : "#6EC4A7", fontSize: "13px", marginBottom: "16px" }}>{saveMessage}</div>
            )}
            <button onClick={createContract} disabled={saving || !form.client || !form.topic} style={{ width: "100%", padding: "16px", borderRadius: "12px", border: "none", background: (!form.client || !form.topic) ? "#3A3A38" : "#D4A017", color: (!form.client || !form.topic) ? "#888880" : "#0E0E0C", fontSize: "16px", fontWeight: "700", cursor: (!form.client || !form.topic) ? "not-allowed" : "pointer", fontFamily: F, marginBottom: "40px" }}>
              {saving ? "Creating..." : "Create Contract & Push to Interviewers"}
            </button>
          </div>
        )}

        {/* Live map */}
        {tab === "map" && (
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#E8E8E4", marginBottom: "6px" }}>Live interviewer map</h2>
            <p style={{ fontSize: "13px", color: "#888880", marginBottom: "16px" }}>Showing interviewers active in the last 10 minutes. Green = available, gold = interviewing.</p>
            {interviewers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#888880" }}>
                <div style={{ fontSize: "16px", marginBottom: "8px" }}>No interviewers online yet</div>
                <div style={{ fontSize: "13px" }}>Open the interviewer app on your phone to appear on the map</div>
              </div>
            ) : null}
            <LiveMap interviewers={interviewers} />
            <div style={{ marginTop: "16px" }}>
              {interviewers.map((iv) => (
                <div key={iv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#1A1A18", borderRadius: "10px", marginBottom: "6px" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "500", color: "#E8E8E4" }}>{iv.name}</div>
                    <div style={{ fontSize: "12px", color: "#888880" }}>{iv.latitude?.toFixed(4)}, {iv.longitude?.toFixed(4)}</div>
                  </div>
                  <div style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "6px", background: iv.status === "interviewing" ? "#2A2520" : "#1A2A20", color: iv.status === "interviewing" ? "#D4A017" : "#6EC4A7", fontWeight: "500" }}>
                    {iv.status === "interviewing" ? "Interviewing" : "Available"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
