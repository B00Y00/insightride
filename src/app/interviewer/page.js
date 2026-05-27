"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";

const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const GENDERS = ["Male", "Female", "Non-binary"];
const ETHNICITIES = ["White", "South Asian", "East Asian", "Southeast Asian", "Black", "Middle Eastern", "Latin American", "Indigenous", "Mixed/Other"];
const PROFESSIONS = ["Any / Not specified", "Healthcare", "Medical", "Technology", "Finance", "Legal", "Education", "Retail / Service", "Trades / Construction", "Executive", "Student", "Retired"];

function matchScore(contract, filters) {
  const { ageRange, gender, ethnicity, profession } = filters;
  const demo = contract.demographics || {};
  let score = 0, matches = true;
  if (ageRange) { if ((demo.ageRanges || []).includes(ageRange) || (demo.ageRanges || []).includes("Any")) { score += 2; } else { matches = false; } }
  if (gender) { if ((demo.genders || []).includes(gender) || (demo.genders || []).includes("Any")) { score += 1; } else { matches = false; } }
  if (ethnicity) { if ((demo.ethnicities || []).includes(ethnicity) || (demo.ethnicities || []).includes("Any")) { score += 2; } else { matches = false; } }
  if (profession && profession !== "Any / Not specified") { if ((demo.professions || []).includes(profession) || (demo.professions || []).includes("Any")) { score += 3; } else { matches = false; } }
  return { matches, score };
}

const F = "'DM Sans', sans-serif";

export default function InterviewerApp() {
  const [contracts, setContracts] = useState([]);
  const [view, setView] = useState("home");
  const [selectedContract, setSelectedContract] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [filters, setFilters] = useState({ ageRange: null, gender: null, ethnicity: null, profession: null });
  const [locationStatus, setLocationStatus] = useState("off"); // off | requesting | active | error
  const [interviewerName] = useState("Interviewer-" + Math.random().toString(36).substr(2, 4));
  const [locationId, setLocationId] = useState(null);

  // Load contracts from Supabase with real-time sync
  useEffect(() => {
    loadContracts();
    const sub = supabase
      .channel("interviewer-contracts")
      .on("postgres_changes", { event: "*", schema: "public", table: "contracts" }, () => { loadContracts(); })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  async function loadContracts() {
    const { data } = await supabase.from("contracts").select("*").gt("interviews_remaining", 0).order("interviewer_payout", { ascending: false });
    if (data) setContracts(data);
  }

  // GPS location broadcasting
  useEffect(() => {
    if (locationStatus !== "active") return;
    let watchId;
    let locRecordId = locationId;

    async function updateLocation(lat, lng) {
      if (locRecordId) {
        await supabase.from("interviewer_locations").update({ latitude: lat, longitude: lng, updated_at: new Date().toISOString() }).eq("id", locRecordId);
      } else {
        const { data } = await supabase.from("interviewer_locations").insert([{ name: interviewerName, latitude: lat, longitude: lng, status: "available" }]).select();
        if (data && data[0]) { locRecordId = data[0].id; setLocationId(data[0].id); }
      }
    }

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => { updateLocation(pos.coords.latitude, pos.coords.longitude); },
        (err) => { console.error("GPS error:", err); setLocationStatus("error"); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
      );
    }

    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [locationStatus]);

  function startLocationBroadcast() {
    setLocationStatus("requesting");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => { setLocationStatus("active"); },
        () => { setLocationStatus("error"); }
      );
    } else {
      setLocationStatus("error");
    }
  }

  const hasFilters = Object.values(filters).some((v) => v !== null);

  const filteredContracts = useMemo(() => {
    if (!hasFilters) return contracts;
    return contracts.map((c) => ({ ...c, ...matchScore(c, filters) })).filter((c) => c.matches).sort((a, b) => { if (b.score !== a.score) return b.score - a.score; return b.interviewer_payout - a.interviewer_payout; });
  }, [contracts, filters, hasFilters]);

  // Contract detail view
  if (view === "detail" && selectedContract) {
    const c = selectedContract;
    const g = c.guide || {};
    const progress = ((c.interviews_total - c.interviews_remaining) / c.interviews_total) * 100;
    const typeColor = c.type === "Open-ended" ? "#6EC4A7" : c.type === "Semi-structured" ? "#7BAED4" : "#D4A76A";

    return (
      <div style={{ minHeight: "100vh", background: "#0E0E0C", paddingBottom: "100px", fontFamily: F }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2A28", display: "flex", alignItems: "center" }}>
          <button onClick={() => { setView(hasFilters ? "match" : "home"); setSelectedContract(null); setDetailTab("overview"); }} style={{ background: "none", border: "none", color: "#D4A017", fontSize: "14px", cursor: "pointer", fontFamily: F }}>← Back</button>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ fontSize: "12px", color: "#D4A017", fontWeight: "600", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" }}>{c.client}</div>
          <div style={{ fontSize: "20px", color: "#E8E8E4", fontWeight: "600", lineHeight: "1.35", marginBottom: "16px" }}>{c.topic}</div>

          <div style={{ background: "#1A1F1C", border: "1px solid #2A3A2E", borderRadius: "14px", padding: "16px", display: "flex", justifyContent: "space-around", marginBottom: "16px" }}>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: "28px", fontWeight: "700", color: "#D4A017" }}>${c.interviewer_payout}</div><div style={{ fontSize: "11px", color: "#888880" }}>You earn</div></div>
            <div style={{ width: "1px", background: "#2A3A2E" }} />
            <div style={{ textAlign: "center" }}><div style={{ fontSize: "28px", fontWeight: "700", color: "#6EC4A7" }}>${c.interviewee_incentive}</div><div style={{ fontSize: "11px", color: "#888880" }}>Interviewee earns</div></div>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px", background: typeColor + "18", color: typeColor, fontWeight: "500" }}>{c.type}</span>
            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px", background: "#2A2A28", color: "#A8A8A4" }}>~{c.estimated_minutes} min</span>
            <span style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px", background: c.interviews_remaining < 10 ? "#3A2020" : "#2A2A28", color: c.interviews_remaining < 10 ? "#E06050" : "#A8A8A4" }}>{c.interviews_remaining} remaining</span>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #2A2A28", marginBottom: "16px" }}>
            {[["overview", "Overview"], ["script", "Interview Script"], ["tips", "Quality Tips"]].map(([v, label]) => (
              <button key={v} onClick={() => setDetailTab(v)} style={{ flex: 1, padding: "10px 0", background: "none", border: "none", borderBottom: detailTab === v ? "2px solid #D4A017" : "2px solid transparent", color: detailTab === v ? "#D4A017" : "#888880", fontSize: "13px", fontWeight: detailTab === v ? "600" : "400", cursor: "pointer", fontFamily: F }}>{label}</button>
            ))}
          </div>

          {detailTab === "overview" && (
            <div>
              {g.objective && (
                <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "6px" }}>Research objective</div>
                  <div style={{ fontSize: "13px", color: "#C8C8C4", lineHeight: "1.6" }}>{g.objective}</div>
                </div>
              )}
              <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "10px" }}>Required demographics</div>
                {[["Age", (c.demographics?.ageRanges || []).join(", ")], ["Gender", (c.demographics?.genders || []).join(", ")], ["Ethnicity", (c.demographics?.ethnicities || []).join(", ")], ["Profession", (c.demographics?.professions || []).join(", ")]].map(([label, value], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid #222220" : "none" }}>
                    <span style={{ fontSize: "13px", color: "#888880" }}>{label}</span>
                    <span style={{ fontSize: "13px", color: "#A8A8A4", textAlign: "right" }}>{value || "Any"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detailTab === "script" && (
            <div>
              {(g.questions || []).map((q, i) => (
                <div key={i} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "6px", fontWeight: "600", background: q.type === "opener" ? "#2A2520" : q.type === "core" ? "#1A2A20" : "#1A1A2A", color: q.type === "opener" ? "#D4A76A" : q.type === "core" ? "#6EC4A7" : "#7BAED4" }}>
                      {q.type === "opener" ? "Warm-up" : q.type === "core" ? "Core question" : q.type === "projective" ? "Projective" : "Screening"}
                    </span>
                  </div>
                  <div style={{ fontSize: "15px", color: "#E8E8E4", fontWeight: "500", lineHeight: "1.5", marginBottom: "10px" }}>"{q.question}"</div>
                  {(q.follow_ups || []).filter(f => f.trim()).length > 0 && (
                    <div style={{ borderLeft: "2px solid #2A3A2E", paddingLeft: "12px" }}>
                      <div style={{ fontSize: "11px", color: "#6EC4A7", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}>Follow-up probes</div>
                      {q.follow_ups.filter(f => f.trim()).map((fu, j) => (
                        <div key={j} style={{ fontSize: "13px", color: "#A8A8A4", lineHeight: "1.5", marginBottom: "4px" }}>→ "{fu}"</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {detailTab === "tips" && (
            <div>
              {(g.tips || []).filter(t => t.trim()).map((tip, i) => (
                <div key={i} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "8px", display: "flex", gap: "12px" }}>
                  <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#2A2520", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "12px", fontWeight: "700", color: "#D4A017" }}>{i + 1}</div>
                  <div style={{ fontSize: "13px", color: "#C8C8C4", lineHeight: "1.6" }}>{tip}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px", background: "linear-gradient(transparent, #0E0E0C 30%)", paddingTop: "40px" }}>
          <button style={{ width: "100%", padding: "16px", borderRadius: "12px", border: "none", background: "#D4A017", color: "#0E0E0C", fontSize: "16px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>
            Start Interview — ${c.interviewer_payout + c.interviewee_incentive} total
          </button>
        </div>
      </div>
    );
  }

  // Main list view
  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "100px" }}>
      {/* Header */}
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1A1A18" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <a href="/" style={{ fontSize: "11px", color: "#888880", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "500", textDecoration: "none" }}>InsightRide</a>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#E8E8E4", marginTop: "2px" }}>Interviewer Dashboard</div>
          </div>
        </div>

        {/* Location status */}
        <div style={{ background: "#1A1A18", borderRadius: "10px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#888880", marginBottom: "2px" }}>GPS Location</div>
            <div style={{ fontSize: "13px", fontWeight: "500", color: locationStatus === "active" ? "#6EC4A7" : locationStatus === "error" ? "#E06050" : "#888880" }}>
              {locationStatus === "active" ? "Broadcasting — visible on admin map" : locationStatus === "error" ? "Location access denied" : locationStatus === "requesting" ? "Requesting access..." : "Not broadcasting"}
            </div>
          </div>
          {locationStatus !== "active" && (
            <button onClick={startLocationBroadcast} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "#1D9E75", color: "#fff", fontSize: "13px", fontWeight: "500", cursor: "pointer", fontFamily: F }}>
              Go Online
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", padding: "16px 20px 0", borderBottom: "1px solid #1A1A18" }}>
        {[["home", "All Contracts"], ["match", "Match Interviewee"]].map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); if (v === "home") setFilters({ ageRange: null, gender: null, ethnicity: null, profession: null }); }} style={{ flex: 1, padding: "10px 0", background: "none", border: "none", borderBottom: view === v ? "2px solid #D4A017" : "2px solid transparent", color: view === v ? "#D4A017" : "#888880", fontSize: "14px", fontWeight: view === v ? "600" : "400", cursor: "pointer", fontFamily: F }}>
            {label}
          </button>
        ))}
      </div>

      {/* Match filters */}
      {view === "match" && (
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1A1A18" }}>
          {[["Age Range", AGE_RANGES, "ageRange"], ["Gender", GENDERS, "gender"], ["Ethnicity", ETHNICITIES, "ethnicity"], ["Profession", PROFESSIONS, "profession"]].map(([label, options, key]) => (
            <div key={key}>
              <div style={{ fontSize: "12px", color: "#888880", fontWeight: "500", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "10px" }}>{label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                {options.map((o) => (
                  <button key={o} onClick={() => setFilters((f) => ({ ...f, [key]: f[key] === o ? null : o }))} style={{ padding: "8px 16px", borderRadius: "20px", border: filters[key] === o ? "2px solid #D4A017" : "1.5px solid #3A3A38", background: filters[key] === o ? "#2A2520" : "#1E1E1C", color: filters[key] === o ? "#F0D060" : "#A8A8A4", fontSize: "13px", fontWeight: filters[key] === o ? "600" : "400", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {hasFilters && <button onClick={() => setFilters({ ageRange: null, gender: null, ethnicity: null, profession: null })} style={{ background: "none", border: "none", color: "#E06050", fontSize: "13px", cursor: "pointer", fontFamily: F }}>Clear all filters</button>}
        </div>
      )}

      {/* Contract list */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ fontSize: "12px", color: "#888880", fontWeight: "500", letterSpacing: "0.05em", textTransform: "uppercase" }}>{hasFilters ? `${filteredContracts.length} matching` : `${filteredContracts.length} available`}</div>
          <div style={{ fontSize: "11px", color: "#888880" }}>Sorted by{hasFilters ? " match + " : " "}payout ↓</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {filteredContracts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#888880", fontSize: "14px" }}>
              {contracts.length === 0 ? "No contracts available yet. Waiting for admin to create one..." : "No contracts match this demographic profile."}
            </div>
          ) : (
            filteredContracts.map((contract, i) => {
              const progress = ((contract.interviews_total - contract.interviews_remaining) / contract.interviews_total) * 100;
              const typeColor = contract.type === "Open-ended" ? "#6EC4A7" : contract.type === "Semi-structured" ? "#7BAED4" : "#D4A76A";
              return (
                <div key={contract.id} onClick={() => { setSelectedContract(contract); setView("detail"); setDetailTab("overview"); }} style={{ background: hasFilters ? "#1A1F1C" : "#1A1A18", border: hasFilters ? "1px solid #2A3A2E" : "1px solid #2A2A28", borderRadius: "14px", padding: "16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "11px", color: "#888880", fontWeight: "500", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "3px" }}>{contract.client}</div>
                      <div style={{ fontSize: "14px", color: "#E8E8E4", fontWeight: "500", lineHeight: "1.4" }}>{contract.topic}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "16px" }}>
                      <div style={{ fontSize: "22px", fontWeight: "700", color: "#D4A017", lineHeight: "1" }}>${contract.interviewer_payout}</div>
                      <div style={{ fontSize: "11px", color: "#888880" }}>your cut</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {hasFilters && <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "6px", background: "#D4A017", color: "#0E0E0C", fontWeight: "700" }}>#{i + 1} match</span>}
                    <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: typeColor + "18", color: typeColor, fontWeight: "500" }}>{contract.type}</span>
                    <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>~{contract.estimated_minutes} min</span>
                    <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#2A2A28", color: "#A8A8A4" }}>Interviewee: ${contract.interviewee_incentive}</span>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", color: "#888880" }}>Interviews remaining</span>
                      <span style={{ fontSize: "11px", color: "#A8A8A4", fontWeight: "500" }}>{contract.interviews_remaining} / {contract.interviews_total}</span>
                    </div>
                    <div style={{ height: "4px", background: "#2A2A28", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, background: contract.interviews_remaining < 10 ? "#E06050" : "#4A8A6A", borderRadius: "2px" }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
