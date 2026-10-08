"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { useTheme, sans, mono, FONT_LINK, Icon } from "../../theme";

const DEMOS = [["ageRange", "Age range"], ["gender", "Gender"], ["ethnicity", "Ethnicity"], ["profession", "Profession"]];
const SENTIMENT_ORDER = ["very_positive", "positive", "neutral", "negative", "very_negative"];
const SENTIMENT_LABEL = { very_positive: "Very positive", positive: "Positive", neutral: "Neutral", negative: "Negative", very_negative: "Very negative" };
const CHOICE = ["single_select", "multi_select"];

function fmtShare(count, total) {
  if (total <= 0) return "—";
  if (total <= 2) return `${count} of ${total} respondent${total === 1 ? "" : "s"}`;
  return `${Math.round((count / total) * 1000) / 10}% (${count} of ${total})`;
}

// ── Tablet question helpers: options are counted by their stable IDs, so answers
//    given in different languages (e.g. "Curious" and "Neugierig") add up together.
function L(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || Object.values(field)[0] || "";
}
function norm(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}
function buildCatalog(field, dq, lang) {
  if (dq && Array.isArray(dq.options) && dq.options.length) {
    const cat = dq.options.map((o) => {
      const names = new Set([norm(o.id)]);
      if (o.label && typeof o.label === "object") Object.values(o.label).forEach((v) => names.add(norm(v)));
      else names.add(norm(o.label));
      return { id: o.id, label: L(o.label, lang) || o.id, names };
    });
    if (dq.allow_other) cat.push({ id: "other", label: "Other", names: new Set(["other", "other (please specify)"]) });
    if (dq.allow_prefer_not) cat.push({ id: "prefer_not", label: "Prefer not to say", names: new Set(["prefer_not", "prefer not to say"]) });
    return cat;
  }
  return (field && Array.isArray(field.options) ? field.options : []).map((o) => ({ id: norm(o), label: String(o), names: new Set([norm(o)]) }));
}
function choiceIds(e, catalog) {
  if (!e) return [];
  const ids = [];
  if (e.option_id) ids.push(String(e.option_id));
  if (Array.isArray(e.option_ids)) e.option_ids.forEach((x) => ids.push(String(x)));
  if (!ids.length) {
    const vals = Array.isArray(e.value) ? e.value : [e.value];
    vals.forEach((v) => {
      if (v == null || v === "") return;
      const c = catalog.find((o) => o.names.has(norm(v)));
      ids.push(c ? c.id : norm(v));
    });
  }
  return Array.from(new Set(ids));
}

function Disclaimer({ groups, T }) {
  const small = groups.some((n) => n > 0 && n < 5);
  if (!small) return null;
  return (
    <div style={{ marginTop: "14px", padding: "12px 14px", borderRadius: "10px", background: T.warnBg, border: `1.5px solid ${T.warnBorder}`, fontSize: "12.5px", color: T.warnText, lineHeight: "1.6" }}>
      <strong>Small sample.</strong> One or more groups below contains fewer than 5 respondents. Figures from very small groups describe those individuals only and should not be generalized to a wider population.
    </div>
  );
}

function Bar({ label, count, total, color, T }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", gap: "12px" }}>
        <span style={{ fontSize: "13px", color: T.text }}>{label}</span>
        <span style={{ fontSize: "12.5px", color: T.faint, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtShare(count, total)}</span>
      </div>
      <div style={{ height: "10px", background: T.track, borderRadius: "5px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color || T.pine, borderRadius: "5px", transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function Panel({ title, children, T }) {
  return (
    <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: "14px", padding: "22px", marginBottom: "16px" }}>
      <div style={{ fontSize: "15.5px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text, marginBottom: "16px" }}>{title}</div>
      {children}
    </div>
  );
}

export default function StatsPage() {
  const { contractId } = useParams();
  const [T] = useTheme();
  const [state, setState] = useState("loading");
  const [contract, setContract] = useState(null);
  const [rows, setRows] = useState([]);
  const [view, setView] = useState("distribution");
  const [fieldKey, setFieldKey] = useState("");
  const [demoKey, setDemoKey] = useState("ageRange");
  const [segA, setSegA] = useState({ demo: "gender", value: "" });
  const [segB, setSegB] = useState({ demo: "gender", value: "" });
  const [questions, setQuestions] = useState([]); // tablet deck questions (from /api/portal/deck)
  const [deckLang, setDeckLang] = useState("en");
  const [target, setTarget] = useState(""); // option id (choice) or minimum rating (scale) for the group views

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: c } = await supabase.from("contracts").select("id, topic, extraction_schema").eq("id", contractId).single();
      if (!c) { setState("denied"); return; }
      setContract(c);
      const { data: ivs } = await supabase.from("completed_interviews")
        .select("interview_number, demographics, structured_data, city, neighbourhood")
        .eq("contract_id", contractId).eq("status", "summarized").eq("voided", false);
      const usable = (ivs || []).filter((r) => r.structured_data && !(r.structured_data.quality?.flagged_for_exclusion));
      setRows(usable);

      // Tablet question catalog (option names in every language; private notes never included)
      try {
        const { data: s } = await supabase.auth.getSession();
        const token = s && s.session ? s.session.access_token : null;
        if (token) {
          const r = await fetch("/api/portal/deck?contractId=" + encodeURIComponent(contractId), { headers: { Authorization: "Bearer " + token } });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.ok && Array.isArray(j.questions)) {
            setQuestions(j.questions);
            setDeckLang(j.default_language || "en");
          }
        }
      } catch (e) {}

      const schema = Array.isArray(c.extraction_schema) ? c.extraction_schema : [];
      const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("field") : null;
      if (wanted && schema.find((f) => f.key === wanted)) setFieldKey(wanted);
      else if (schema.length) setFieldKey((schema.find((f) => f.type !== "ordered_list") || schema[0]).key);
      setState("ok");
    })();
  }, [contractId]);

  const schema = useMemo(() => (Array.isArray(contract?.extraction_schema) ? contract.extraction_schema : []), [contract]);
  const field = schema.find((f) => f.key === fieldKey);
  const dq = questions.find((q) => q.id === fieldKey) || null;
  const catalog = useMemo(() => buildCatalog(field, dq, deckLang), [field, dq, deckLang]);
  const scale = (dq && dq.scale) || (field && field.scale) || null;
  const isTablet = !!(field && (field.source === "deck" || dq));
  const NA = isTablet ? "Not answered" : "Not mentioned";
  const N = rows.length;

  // Default "hit" for the group views whenever the field changes
  useEffect(() => {
    if (!field) return;
    if (CHOICE.includes(field.type)) setTarget(catalog[0] ? catalog[0].id : "");
    else if (field.type === "scale") {
      const lo = scale && typeof scale.min === "number" ? scale.min : 1;
      const hi = scale && typeof scale.max === "number" ? scale.max : 5;
      setTarget(String(hi - lo >= 2 ? hi - 1 : hi));
    } else setTarget("");
  }, [fieldKey, catalog.length, scale && scale.max]);

  const labelOf = (f) => {
    const q = questions.find((x) => x.id === f.key);
    return q ? L(q.prompt, deckLang) || f.label : f.label;
  };
  const demoValues = (key) => Array.from(new Set(rows.map((r) => (r.demographics || {})[key]).filter(Boolean)));
  const ef = (r) => ((r.structured_data?.extracted_fields || {})[fieldKey]);
  const answered = (r) => { const e = ef(r); return e && e.mentioned !== false && e.value !== null && e.value !== undefined && !(Array.isArray(e.value) && e.value.length === 0); };
  const optLabel = (id) => { const c = catalog.find((o) => o.id === id); return c ? c.label : id; };

  function distributionOf(subset) {
    if (!field) return [];
    if (field.type === "boolean") {
      const yes = subset.filter((r) => answered(r) && ef(r).value === true).length;
      const no = subset.filter((r) => answered(r) && ef(r).value === false).length;
      const nm = subset.length - yes - no;
      return [["Yes", yes], ["No", no], [NA, nm]];
    }
    if (field.type === "sentiment") {
      const counts = {};
      subset.forEach((r) => { if (answered(r)) counts[ef(r).value] = (counts[ef(r).value] || 0) + 1; });
      const nm = subset.length - subset.filter(answered).length;
      const out = SENTIMENT_ORDER.filter((s) => counts[s]).map((s) => [SENTIMENT_LABEL[s], counts[s]]);
      if (nm > 0) out.push([NA, nm]);
      return out;
    }
    if (field.type === "numeric") {
      const nums = subset.filter(answered).map((r) => Number(ef(r).value)).filter((x) => !isNaN(x));
      return nums.length ? [["__numeric__", nums]] : [];
    }
    if (CHOICE.includes(field.type)) {
      const counts = {};
      const ans = subset.filter(answered);
      ans.forEach((r) => choiceIds(ef(r), catalog).forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
      const known = catalog.map((o) => o.id);
      const out = catalog.map((o) => [o.label, counts[o.id] || 0]);
      Object.keys(counts).filter((id) => !known.includes(id)).forEach((id) => out.push([id, counts[id]]));
      const nm = subset.length - ans.length;
      if (nm > 0) out.push([NA, nm]);
      return out;
    }
    if (field.type === "scale") {
      const lo = scale && typeof scale.min === "number" ? scale.min : null;
      const hi = scale && typeof scale.max === "number" ? scale.max : null;
      const vals = subset.filter(answered).map((r) => Number(ef(r).value)).filter((x) => !isNaN(x));
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const points = lo != null && hi != null && hi - lo <= 11 ? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) : Object.keys(counts).map(Number).sort((a, b) => a - b);
      const out = points.map((v) => {
        let lbl = String(v);
        if (dq && dq.scale && v === dq.scale.min && L(dq.scale.min_label, deckLang)) lbl += " — " + L(dq.scale.min_label, deckLang);
        if (dq && dq.scale && v === dq.scale.max && L(dq.scale.max_label, deckLang)) lbl += " — " + L(dq.scale.max_label, deckLang);
        return [lbl, counts[v] || 0];
      });
      const nm = subset.length - vals.length;
      if (nm > 0) out.push([NA, nm]);
      return out;
    }
    const m = subset.filter(answered).length;
    return [[isTablet ? "Answered" : "Mentioned", m], [NA, subset.length - m]];
  }

  // What counts as a "hit" in the demographic / compare / location views
  function isHit(r) {
    if (!field || !answered(r)) return false;
    const v = ef(r).value;
    if (field.type === "boolean") return v === true;
    if (field.type === "sentiment") return ["positive", "very_positive"].includes(v);
    if (CHOICE.includes(field.type)) return !!target && choiceIds(ef(r), catalog).includes(target);
    if (field.type === "scale") return target !== "" && Number(v) >= Number(target);
    return true;
  }
  const hitCount = (sub) => sub.filter(isHit).length;
  const hitLabel = !field ? "" : field.type === "boolean" ? "answered yes" : field.type === "sentiment" ? "positive" : CHOICE.includes(field.type) ? `chose “${optLabel(target)}”` : field.type === "scale" ? `rated ${target} or higher` : isTablet ? "answered" : "mentioned it";

  const selStyle = { padding: "10px 12px", borderRadius: "9px", border: `1.5px solid ${T.line}`, background: T.inputBg, color: T.text, fontSize: "13.5px", fontFamily: sans, outline: "none", cursor: "pointer", maxWidth: "100%" };

  function targetPicker() {
    if (!field) return null;
    if (CHOICE.includes(field.type) && catalog.length) {
      return (
        <select style={selStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
          {catalog.map((o) => <option key={o.id} value={o.id}>Share who chose: {o.label}</option>)}
        </select>
      );
    }
    if (field.type === "scale") {
      const lo = scale && typeof scale.min === "number" ? scale.min : 1;
      const hi = scale && typeof scale.max === "number" ? scale.max : 5;
      const opts = [];
      for (let v = lo + 1; v <= hi; v++) opts.push(v);
      return (
        <select style={selStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
          {opts.map((v) => <option key={v} value={String(v)}>Share who rated {v} or higher</option>)}
        </select>
      );
    }
    return null;
  }

  if (state === "loading") return <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontFamily: sans, fontSize: "14px" }}>Computing statistics…</div>;
  if (state === "denied") return <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontFamily: sans, fontSize: "14px" }}>This contract isn't assigned to your account.</div>;

  const listFields = schema.filter((f) => f.type === "ordered_list");
  const statFields = schema.filter((f) => f.type !== "ordered_list");
  const views = [["distribution", "Answers"], ["crosstab", "By demographic"], ["compare", "Compare groups"], ["geo", "By location"], ["sentiment", "Sentiment"], ["ranked", "Rankings"]];
  const fieldSelect = (style) => (
    <select style={{ ...selStyle, ...(style || {}) }} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
      {statFields.map((f) => <option key={f.key} value={f.key}>{labelOf(f)}</option>)}
    </select>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: sans, paddingBottom: "60px" }}>
      <link href={FONT_LINK} rel="stylesheet" />
      <div style={{ background: T.ink, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: "19px", color: "#EEF1EC" }}>InsightRide</div>
        <a href={`/portal/${contractId}`} style={{ fontSize: "13px", color: "#B9C6BB", textDecoration: "none" }}>← Back to contract</a>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", color: T.pine }}>
          <Icon name="stats" size={22} />
          <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.01em", color: T.text }}>Statistics</span>
        </div>
        <p style={{ fontSize: "13px", color: T.faint, margin: "0 0 4px", fontWeight: 500 }}>{contract.topic}</p>
        <p style={{ fontSize: "13px", color: T.faint, margin: "0 0 22px" }}>Based on {N} completed interview{N === 1 ? "" : "s"}. Every figure shows the number of respondents behind it.</p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "22px" }}>
          {views.map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "9px 16px", borderRadius: "20px", border: view === v ? `2px solid ${T.pine}` : `1.5px solid ${T.line}`, background: view === v ? T.pineSoft : T.card, color: view === v ? T.pine : T.faint, fontSize: "13px", fontWeight: view === v ? 600 : 400, cursor: "pointer", fontFamily: sans }}>{lbl}</button>
          ))}
        </div>

        {N === 0 && <Panel T={T} title="No data yet">Statistics appear once interviews are processed.</Panel>}

        {N > 0 && view === "distribution" && (
          <Panel T={T} title="How respondents answered">
            {statFields.length === 0 ? <div style={{ fontSize: "13.5px", color: T.faint }}>This contract has no analysis fields configured.</div> : (
              <>
                {fieldSelect({ marginBottom: "18px" })}
                {isTablet && dq && <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", margin: "-8px 0 14px" }}>ANSWERED ON THE TABLET{dq.slide_title ? " · SLIDE: " + String(dq.slide_title).toUpperCase() : ""}</div>}
                {field && field.type === "numeric" ? (() => {
                  const d = distributionOf(rows);
                  if (!d.length) return <div style={{ fontSize: "13.5px", color: T.faint }}>No numeric answers yet.</div>;
                  const nums = d[0][1];
                  const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
                  return <div style={{ fontSize: "14px", color: T.text }}>Average: <strong>{avg}</strong> · lowest {Math.min(...nums)} · highest {Math.max(...nums)} · from {nums.length} of {N} respondents</div>;
                })() : (
                  <>
                    {field && field.type === "scale" && (() => {
                      const nums = rows.filter(answered).map((r) => Number(ef(r).value)).filter((x) => !isNaN(x));
                      if (!nums.length) return null;
                      const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
                      return <div style={{ fontSize: "14px", color: T.text, marginBottom: "16px" }}>Average: <strong>{avg}</strong>{scale ? ` on a ${scale.min}–${scale.max} scale` : ""} · from {nums.length} of {N} respondents</div>;
                    })()}
                    {distributionOf(rows).map(([lbl, count], i) => <Bar key={lbl + i} T={T} label={lbl} count={count} total={N} color={lbl === NA ? T.line : undefined} />)}
                    {field && field.type === "multi_select" && <div style={{ fontSize: "12.5px", color: T.faint, marginTop: "6px" }}>Respondents could choose more than one answer, so the shares can add up to more than 100%.</div>}
                    <Disclaimer T={T} groups={[N]} />
                  </>
                )}
              </>
            )}
          </Panel>
        )}

        {N > 0 && view === "crosstab" && field && (
          <Panel T={T} title={`${labelOf(field)} — by demographic`}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "18px" }}>
              {fieldSelect()}
              {targetPicker()}
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
                  {names.map((g) => <Bar key={g} T={T} label={`${g} — ${hitLabel}`} count={hitCount(groups[g])} total={groups[g].length} />)}
                  <Disclaimer T={T} groups={names.map((g) => groups[g].length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "compare" && field && (
          <Panel T={T} title="Compare two groups">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "8px" }}>
              {[["Group A", segA, setSegA], ["Group B", segB, setSegB]].map(([lbl, seg, setSeg]) => (
                <div key={lbl}>
                  <div style={{ fontFamily: mono, fontSize: "10px", color: T.pine, letterSpacing: "0.1em", marginBottom: "6px" }}>{lbl.toUpperCase()}</div>
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
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", margin: "10px 0 18px" }}>
              {fieldSelect()}
              {targetPicker()}
            </div>
            {segA.value && segB.value ? (() => {
              const subA = rows.filter((r) => (r.demographics || {})[segA.demo] === segA.value);
              const subB = rows.filter((r) => (r.demographics || {})[segB.demo] === segB.value);
              return (
                <>
                  <Bar T={T} label={`${segA.value} — ${hitLabel}`} count={hitCount(subA)} total={subA.length} />
                  <Bar T={T} label={`${segB.value} — ${hitLabel}`} count={hitCount(subB)} total={subB.length} color="#7BAED4" />
                  <Disclaimer T={T} groups={[subA.length, subB.length]} />
                </>
              );
            })() : <div style={{ fontSize: "13.5px", color: T.faint }}>Pick a value for both groups to compare.</div>}
          </Panel>
        )}

        {N > 0 && view === "geo" && (
          <Panel T={T} title="Where respondents were interviewed">
            {(() => {
              const groups = {};
              rows.forEach((r) => { const g = r.neighbourhood || r.city || "Unknown"; (groups[g] = groups[g] || []).push(r); });
              const names = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
              return (
                <>
                  {names.map((g) => <Bar key={g} T={T} label={g} count={groups[g].length} total={N} />)}
                  {field && (
                    <div style={{ marginTop: "20px", borderTop: `1px solid ${T.line}`, paddingTop: "16px" }}>
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                        {fieldSelect()}
                        {targetPicker()}
                      </div>
                      <div style={{ fontSize: "13px", color: T.faint, marginBottom: "12px" }}>"{labelOf(field)}" by area — {hitLabel}:</div>
                      {names.map((g) => <Bar key={g} T={T} label={g} count={hitCount(groups[g])} total={groups[g].length} color="#7BAED4" />)}
                    </div>
                  )}
                  <Disclaimer T={T} groups={names.map((g) => groups[g].length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "sentiment" && (
          <Panel T={T} title="Overall sentiment">
            {(() => {
              const counts = {};
              rows.forEach((r) => { const s = r.structured_data?.sentiment?.overall; if (s) counts[s] = (counts[s] || 0) + 1; });
              const groups = {};
              rows.forEach((r) => { const g = (r.demographics || {})[demoKey] || "Unknown"; (groups[g] = groups[g] || []).push(r); });
              return (
                <>
                  {SENTIMENT_ORDER.filter((s) => counts[s]).map((s) => <Bar key={s} T={T} label={SENTIMENT_LABEL[s]} count={counts[s]} total={N} />)}
                  <div style={{ marginTop: "20px", borderTop: `1px solid ${T.line}`, paddingTop: "16px" }}>
                    <select style={{ ...selStyle, marginBottom: "14px" }} value={demoKey} onChange={(e) => setDemoKey(e.target.value)}>
                      {DEMOS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                    </select>
                    {Object.keys(groups).map((g) => {
                      const sub = groups[g];
                      const pos = sub.filter((r) => ["positive", "very_positive"].includes(r.structured_data?.sentiment?.overall)).length;
                      return <Bar key={g} T={T} label={`${g} — positive overall`} count={pos} total={sub.length} color="#7BAED4" />;
                    })}
                  </div>
                  <Disclaimer T={T} groups={Object.values(groups).map((g) => g.length)} />
                </>
              );
            })()}
          </Panel>
        )}

        {N > 0 && view === "ranked" && (
          <Panel T={T} title="Rankings — what came up most">
            {listFields.length === 0 ? <div style={{ fontSize: "13.5px", color: T.faint }}>This contract has no list-type fields (e.g. brands mentioned).</div> : (
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
                    <div style={{ fontSize: "13px", color: T.faint, marginBottom: "12px" }}>{f.label}</div>
                    {items.length === 0 ? <div style={{ fontSize: "13.5px", color: T.faint }}>Nothing recorded yet.</div> :
                      items.map((it) => (
                        <div key={it.item} style={{ marginBottom: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                            <span style={{ fontSize: "13px", color: T.text }}>{it.item}</span>
                            <span style={{ fontSize: "12.5px", color: T.faint, fontWeight: 600 }}>{fmtShare(it.count, N)} · avg. position {it.avg}</span>
                          </div>
                          <div style={{ height: "10px", background: T.track, borderRadius: "5px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(it.count / N) * 100}%`, background: T.pine, borderRadius: "5px" }} />
                          </div>
                        </div>
                      ))}
                    <Disclaimer T={T} groups={[N]} />
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
