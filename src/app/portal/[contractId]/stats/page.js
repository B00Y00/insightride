"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

const ink = "#0F1F18", pine = "#1B6B4A", porcelain = "#EEF1EC", card = "#FFFFFF",
  line = "#D9DED7", text = "#1A241E", faint = "#63705F";
const serif = "'Young Serif', Georgia, serif";
const sans = "'Outfit', sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, monospace";

const DEMOS = [["ageRange", "Age range"], ["gender", "Gender"], ["ethnicity", "Ethnicity"], ["profession", "Profession"]];
const SENTIMENT_ORDER = ["very_positive", "positive", "neutral", "negative", "very_negative"];
const SENTIMENT_LABEL = { very_positive: "Very positive", positive: "Positive", neutral: "Neutral", negative: "Negative", very_negative: "Very negative" };

// The agreed percentage rules, in one place
function fmtShare(count, total) {
  if (total <= 0) return "—";
  if (total <= 2) return `${count} of ${total} respondent${total === 1 ? "" : "s"}`;
  return `${Math.round((count / total) * 1000) / 10}% (${count} of ${total})`;
}

function Disclaimer({ groups }) {
  const small = groups.some((n) => n > 0 && n < 5);
  if (!small) return null;
  return (
    <div style={{ marginTop: "14px", padding: "12px 14px", borderRadius: "10px", background: "#FDF6E7", border: "1.5px solid #EAD9A8", fontSize: "12.5px", color: "#7A6320", lineHeight: "1.6" }}>
      <strong>Small sample.</strong> One or more groups below contains fewer than 5 respondents. Figures from very small groups describe those individuals only and should not be generalized to a wider population.
    </div>
  );
}

function Bar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", color: text }}>{label}</span>
        <span style={{ fontSize: "12.5px", color: faint, fontWeight: "600" }}>{fmtShare(count, total)}</span>
      </div>
      <div style={{ height: "10px", background: "#E9EDE7", borderRadius: "5px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color || pine, borderRadius: "5px", transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: card, border: `1.5px solid ${line}`, borderRadius: "14px", padding: "22px", marginBottom: "16px" }}>
      <div style={{ fontFamily: serif, fontSize: "16px", color: ink, marginBottom: "16px" }}>{title}</div>
      {children}
    </div>
  );
}

const selStyle = { padding: "10px 12px", borderRadius: "9px", border: `1.5px solid ${line}`, background: "#FBFCFA", color: text, fontSize: "13.5px", fontFamily: sans, outline: "none", cursor: "pointer" };

export default function StatsPage() {
  const { contractId } = useParams();
  const [state, setState] = useState("loading");
  const [contract, setContract] = useState(null);
  const [rows, setRows] = useState([]);
  const [view, setView] = useState("distribution");
  const [fieldKey, setFieldKey] = useState("");
  const [demoKey, setDemoKey] = useState("ageRange");
  const [segA, setSegA] = useState({ demo: "gender", value: "" });
  const [segB, setSegB] = useState({ demo: "gender", value: "" });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: c } = await supabase.from("contracts").select("id, topic, extraction_schema").eq("id", contractId).single();
      if (!c) { setState("denied"); return; }
      setContract(c);
      const { data: ivs } = await supabase.from("completed_interviews")
        .select("interview_number, demographics, structured_data, city, neighbourhood")
        .eq("contract_id", contractId).eq("status", "summarized");
      const usable = (ivs || []).filter((r) => r.structured_data && !(r.structured_data.quality?.flagged_for_exclusion));
      setRows(usable);
      const schema = Array.isArray(c.extraction_schema) ? c.extraction_schema : [];
      if (schema.length) setFieldKey(schema[0].key);
      setState("ok");
    })();
  }, [contractId]);

  const schema = useMemo(() => (Array.isArray(contract?.extraction_schema) ? contract.extraction_schema : []), [contract]);
  const field = schema.find((f) => f.key === fieldKey);
  const N = rows.length;

  const demoValues = (key) => Array.from(new Set(rows.map((r) => (r.demographics || {})[key]).filter(Boolean)));
  const ef = (r) => ((r.structured_data?.extracted_fields || {})[fieldKey]);
  const answered = (r) => { const e = ef(r); return e && e.mentioned !== false && e.value !== null && e.value !== undefined; };

  function distributionOf(subset) {
    if (!field) return [];
    if (field.type === "boolean") {
      const yes = subset.filter((r) => answered(r) && ef(r).value === true).length;
      const no = subset.filter((r) => answered(r) && ef(r).value === false).length;
      const nm = subset.length - yes - no;
      return [["Yes", yes], ["No", no], ["Not mentioned", nm]];
    }
    if (field.type === "sentiment") {
      const counts = {};
      subset.forEach((r) => { if (answered(r)) counts[ef(r).value] = (counts[ef(r).value] || 0) + 1; });
      const nm = subset.length - subset.filter(answered).length;
      const out = SENTIMENT_ORDER.filter((s) => counts[s]).map((s) => [SENTIMENT_LABEL[s], counts[s]]);
      if (nm > 0) out.push(["Not mentioned", nm]);
      return out;
    }
    if (field.type === "numeric") {
      const nums = subset.filter(answered).map((r) => Number(ef(r).value)).filter((x) => !isNaN(x));
      return nums.length ? [["__numeric__", nums]] : [];
    }
    // free_text / other: mentioned vs not
    const m = subset.filter(answered).length;
    return [["Mentioned", m], ["Not mentioned", subset.length - m]];
  }

  if (state === "loading") return <div style={{ minHeight: "100vh", background: porcelain, display: "flex", alignItems: "center", justifyContent: "center", color: faint, fontFamily: sans, fontSize: "14px" }}>Computing statistics…</div>;
  if (state === "denied") return <div style={{ minHeight: "100vh", background: porcelain, display: "flex", alignItems: "center", justifyContent: "center", color: faint, fontFamily: sans, fontSize: "14px" }}>This contract isn't assigned to your account.</div>;

  const listFields = schema.filter((f) => f.type === "ordered_list");
  const statFields = schema.filter((f) => f.type !== "ordered_list");
  const views = [["distribution", "Answers"], ["crosstab", "By demographic"], ["compare", "Compare groups"], ["geo", "By location"], ["sentiment", "Sentiment"], ["ranked", "Rankings"]];

  return (
    <div style={{ minHeight: "100vh", background: porcelain, fontFamily: sans, paddingBottom: "60px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: ink, padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: serif, fontSize: "22px", color: porcelain }}>InsightRide</div>
        <a href={`/portal/${contractId}`} style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to contract</a>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ fontFamily: mono, fontSize: "10px", color: pine, letterSpacing: "0.1em", marginBottom: "8px" }}>INTERACTIVE STATISTICS</div>
        <h1 style={{ fontFamily: serif, fontSize: "22px", color: ink, margin: "0 0 6px", lineHeight: "1.35" }}>{contract.topic}</h1>
        <p style={{ fontSize: "13px", color: faint, margin: "0 0 22px" }}>Based on {N} completed interview{N === 1 ? "" : "s"}. Every figure shows the number of respondents behind it.</p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "22px" }}>
          {views.map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "9px 16px", borderRadius: "20px", border: view === v ? `2px solid ${pine}` : `1.5px solid ${line}`, background: view === v ? "#E4EFE8" : card, color: view === v ? pine : faint, fontSize: "13px", fontWeight: view === v ? "600" : "400", cursor: "pointer", fontFamily: sans }}>{lbl}</button>
          ))}
        </div>

        {N === 0 && <Panel title="No data yet">Statistics appear once interviews are processed.</Panel>}

        {N > 0 && view === "distribution" && (
          <Panel title="How respondents answered">
            {statFields.length === 0 ? <div style={{ fontSize: "13.5px", color: faint }}>This contract has no analysis fields configured.</div> : (
              <>
                <select style={{ ...selStyle, marginBottom: "18px" }} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
                  {statFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                {field && field.type === "numeric" ? (() => {
                  const d = distributionOf(rows);
                  if (!d.length) return <div style={{ fontSize: "13.5px", color: faint }}>No numeric answers yet.</div>;
                  const nums = d[0][1];
                  const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
                  return <div style={{ fontSize: "14px", color: text }}>Average: <strong>{avg}</strong> · lowest {Math.min(...nums)} · highest {Math.max(...nums)} · from {nums.length} of {N} respondents</div>;
                })() : (
                  <>
                    {distributionOf(rows).map(([lbl, count]) => <Bar key={lbl} label={lbl} count={count} total={N} color={lbl === "Not mentioned" ? "#B9C6BB" : undefined} />)}
                    <Disclaimer groups={[N]} />
                  </>
                )}
              </>
            )}
          </Panel>
        )}

        {N > 0 && view === "crosstab" && field && (
          <Panel title={`${field.label} — by demographic`}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "18px" }}>
              <select style={selStyle} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
                {statFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select style={selStyle} value={demoKey} onChange={(e) => setDemoKey(e.target.value)}>
                {DEMOS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </div>
            {(() => {
              const groups = {};
              rows.forEach((r) => { const g = (r.demographics || {})[demoKey] || "Unknown"; (groups[g] = groups[g] || []).push(r); });
              const names = Object.keys(groups);
              return (
                <>
                  {names.map((g) => {
                    const sub = groups[g];
                    let hit = 0, lbl = "";
                    if (field.type === "boolean") { hit = sub.filter((r) => answered(r) && ef(r).value === true).length; lbl = "answered yes"; }
                    else if (field.type === "sentiment") { hit = sub.filter((r) => answered(r) && ["positive", "very_positive"].includes(ef(r).value)).length; lbl = "positive"; }
                    else { hit = sub.filter(answered).length; lbl = "mentioned it"; }
                    return <Bar key={g} label={`${g} — ${lbl}`} count={hit} total={sub.length} />;
                  })}
                  <Disclaimer groups={names.map((g) => groups[g].length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "compare" && field && (
          <Panel title="Compare two groups">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "8px" }}>
              {[["Group A", segA, setSegA], ["Group B", segB, setSegB]].map(([lbl, seg, setSeg]) => (
                <div key={lbl}>
                  <div style={{ fontFamily: mono, fontSize: "10px", color: pine, letterSpacing: "0.1em", marginBottom: "6px" }}>{lbl.toUpperCase()}</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <select style={{ ...selStyle, flex: 1 }} value={seg.demo} onChange={(e) => setSeg({ demo: e.target.value, value: "" })}>
                      {DEMOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <select style={{ ...selStyle, flex: 1 }} value={seg.value} onChange={(e) => setSeg({ ...seg, value: e.target.value })}>
                      <option value="">— pick —</option>
                      {demoValues(seg.demo).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <select style={{ ...selStyle, margin: "10px 0 18px" }} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
              {statFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {segA.value && segB.value ? (() => {
              const subA = rows.filter((r) => (r.demographics || {})[segA.demo] === segA.value);
              const subB = rows.filter((r) => (r.demographics || {})[segB.demo] === segB.value);
              const hit = (sub) => field.type === "boolean" ? sub.filter((r) => answered(r) && ef(r).value === true).length
                : field.type === "sentiment" ? sub.filter((r) => answered(r) && ["positive", "very_positive"].includes(ef(r).value)).length
                : sub.filter(answered).length;
              const lbl = field.type === "boolean" ? "answered yes" : field.type === "sentiment" ? "positive" : "mentioned it";
              return (
                <>
                  <Bar label={`${segA.value} — ${lbl}`} count={hit(subA)} total={subA.length} />
                  <Bar label={`${segB.value} — ${lbl}`} count={hit(subB)} total={subB.length} color="#7BAED4" />
                  <Disclaimer groups={[subA.length, subB.length]} />
                </>
              );
            })() : <div style={{ fontSize: "13.5px", color: faint }}>Pick a value for both groups to compare.</div>}
          </Panel>
        )}

        {N > 0 && view === "geo" && (
          <Panel title="Where respondents were interviewed">
            {(() => {
              const groups = {};
              rows.forEach((r) => { const g = r.neighbourhood || r.city || "Unknown"; (groups[g] = groups[g] || []).push(r); });
              const names = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
              return (
                <>
                  {names.map((g) => <Bar key={g} label={g} count={groups[g].length} total={N} />)}
                  {field && (
                    <div style={{ marginTop: "20px", borderTop: `1px solid ${line}`, paddingTop: "16px" }}>
                      <div style={{ fontSize: "13px", color: faint, marginBottom: "12px" }}>"{field.label}" by area:</div>
                      {names.map((g) => {
                        const sub = groups[g];
                        const hit = field.type === "boolean" ? sub.filter((r) => answered(r) && ef(r).value === true).length
                          : field.type === "sentiment" ? sub.filter((r) => answered(r) && ["positive", "very_positive"].includes(ef(r).value)).length
                          : sub.filter(answered).length;
                        return <Bar key={g} label={g} count={hit} total={sub.length} color="#7BAED4" />;
                      })}
                    </div>
                  )}
                  <Disclaimer groups={names.map((g) => groups[g].length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "sentiment" && (
          <Panel title="Overall sentiment">
            {(() => {
              const counts = {};
              rows.forEach((r) => { const s = r.structured_data?.sentiment?.overall; if (s) counts[s] = (counts[s] || 0) + 1; });
              const groups = {};
              rows.forEach((r) => { const g = (r.demographics || {})[demoKey] || "Unknown"; (groups[g] = groups[g] || []).push(r); });
              return (
                <>
                  {SENTIMENT_ORDER.filter((s) => counts[s]).map((s) => <Bar key={s} label={SENTIMENT_LABEL[s]} count={counts[s]} total={N} />)}
                  <div style={{ marginTop: "20px", borderTop: `1px solid ${line}`, paddingTop: "16px" }}>
                    <select style={{ ...selStyle, marginBottom: "14px" }} value={demoKey} onChange={(e) => setDemoKey(e.target.value)}>
                      {DEMOS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                    </select>
                    {Object.keys(groups).map((g) => {
                      const sub = groups[g];
                      const pos = sub.filter((r) => ["positive", "very_positive"].includes(r.structured_data?.sentiment?.overall)).length;
                      return <Bar key={g} label={`${g} — positive overall`} count={pos} total={sub.length} color="#7BAED4" />;
                    })}
                  </div>
                  <Disclaimer groups={Object.values(groups).map((g) => g.length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "ranked" && (
          <Panel title="Rankings — what came up most">
            {listFields.length === 0 ? <div style={{ fontSize: "13.5px", color: faint }}>This contract has no list-type fields (e.g. brands mentioned).</div> : (
              listFields.map((f) => {
                const freq = {}, posSum = {};
                rows.forEach((r) => {
                  const e = (r.structured_data?.extracted_fields || {})[f.key];
                  const arr = e && Array.isArray(e.value) ? e.value : [];
                  arr.forEach((item, idx) => { freq[item] = (freq[item] || 0) + 1; posSum[item] = (posSum[item] || 0) + idx + 1; });
                });
                const items = Object.keys(freq).map((k) => ({ item: k, count: freq[k], avg: Math.round((posSum[k] / freq[k]) * 100) / 100 })).sort((a, b) => b.count - a.count);
                return (
                  <div key={f.key} style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "13px", color: faint, marginBottom: "12px" }}>{f.label}</div>
                    {items.length === 0 ? <div style={{ fontSize: "13.5px", color: faint }}>Nothing recorded yet.</div> :
                      items.map((it) => (
                        <div key={it.item} style={{ marginBottom: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                            <span style={{ fontSize: "13px", color: text }}>{it.item}</span>
                            <span style={{ fontSize: "12.5px", color: faint, fontWeight: "600" }}>{fmtShare(it.count, N)} · avg. position {it.avg}</span>
                          </div>
                          <div style={{ height: "10px", background: "#E9EDE7", borderRadius: "5px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(it.count / N) * 100}%`, background: pine, borderRadius: "5px" }} />
                          </div>
                        </div>
                      ))}
                    <Disclaimer groups={[N]} />
                  </div>
                );
              })
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
