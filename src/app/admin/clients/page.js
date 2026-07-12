"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import AdminGuard from "../AdminGuard";

const F = "var(--font-sans), 'DM Sans', sans-serif";
const input = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #3A3A38", background: "#0E0E0C", color: "#E8E8E4", fontSize: "13px", fontFamily: F, boxSizing: "border-box", outline: "none" };
const label = { fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: "6px" };

export default function AdminClientsPage() {
  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [links, setLinks] = useState([]);
  const [form, setForm] = useState({ email: "", fullName: "", tempPassword: "" });
  const [assign, setAssign] = useState({}); // clientId -> contractId chosen in dropdown
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadAll(); }, []);
  async function loadAll() {
    const [{ data: c }, { data: k }, { data: l }] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "client").order("created_at", { ascending: false }),
      supabase.from("contracts").select("id, client, topic").order("created_at", { ascending: false }),
      supabase.from("client_contracts").select("*"),
    ]);
    if (c) setClients(c);
    if (k) setContracts(k);
    if (l) setLinks(l);
  }

  async function createClientAccount() {
    setMessage(""); setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your admin session expired — sign in again at /login.");
      const res = await fetch("/api/admin/create-client", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: form.email, tempPassword: form.tempPassword, fullName: form.fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      setMessage(`Client created. Give them: email "${form.email}" and the temporary password. They'll be asked to set their own password on first sign-in.`);
      setForm({ email: "", fullName: "", tempPassword: "" });
      loadAll();
    } catch (e) { setMessage("Error: " + (e.message || String(e))); }
    finally { setBusy(false); }
  }

  async function assignContract(clientId) {
    const contractId = assign[clientId];
    if (!contractId) { setMessage("Error: pick a contract to assign first."); return; }
    setMessage("");
    const existing = links.find((l) => l.client_id === clientId && l.contract_id === contractId);
    if (existing) {
      if (existing.access_revoked) {
        await supabase.from("client_contracts").update({ access_revoked: false }).eq("id", existing.id);
        setMessage("Access restored.");
      } else { setMessage("That contract is already assigned to this client."); }
    } else {
      const { error } = await supabase.from("client_contracts").insert([{ client_id: clientId, contract_id: contractId }]);
      setMessage(error ? "Error: " + error.message : "Contract assigned. It now appears in the client's portal.");
    }
    loadAll();
  }

  async function toggleRevoke(link) {
    await supabase.from("client_contracts").update({ access_revoked: !link.access_revoked }).eq("id", link.id);
    setMessage(link.access_revoked ? "Access restored." : "Access revoked — the contract no longer appears in the client's portal.");
    loadAll();
  }

  const contractName = (id) => { const c = contracts.find((x) => x.id === id); return c ? `${c.client}: ${c.topic}` : "(deleted contract)"; };

  return (
    <AdminGuard>
      <div style={{ minHeight: "100vh", background: "#0E0E0C", fontFamily: F, paddingBottom: "60px" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1A1A18" }}>
          <a href="/admin" style={{ fontSize: "13px", color: "#D4A017", textDecoration: "none" }}>← Back to admin</a>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#E8E8E4", marginTop: "6px" }}>Client accounts</div>
          <div style={{ fontSize: "13px", color: "#888880", marginTop: "4px" }}>Create client logins and assign contracts to them. Clients see only their assigned contracts.</div>
        </div>

        <div style={{ padding: "20px 24px", maxWidth: "760px" }}>
          {message && <div style={{ padding: "12px 14px", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", background: message.startsWith("Error") ? "#3A2020" : "#1A2A20", color: message.startsWith("Error") ? "#E06050" : "#6EC4A7", lineHeight: "1.5" }}>{message}</div>}

          <div style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#D4A017", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Create a client account</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div><label style={label}>Client email</label><input style={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="client@company.com" /></div>
              <div><label style={label}>Name (optional)</label><input style={input} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="e.g. Maple Eats — Sarah" /></div>
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={label}>Temporary password (min 8 characters — you give this to the client)</label>
              <input style={input} value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} placeholder="e.g. Maple2026Start" />
            </div>
            <button onClick={createClientAccount} disabled={busy || !form.email || form.tempPassword.length < 8} style={{ padding: "12px 20px", borderRadius: "10px", border: "none", background: busy || !form.email || form.tempPassword.length < 8 ? "#3A3A38" : "#D4A017", color: busy || !form.email || form.tempPassword.length < 8 ? "#888880" : "#0E0E0C", fontSize: "14px", fontWeight: "700", cursor: "pointer", fontFamily: F }}>
              {busy ? "Creating…" : "Create client account"}
            </button>
          </div>

          <div style={{ fontSize: "12px", fontWeight: "600", color: "#888880", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "12px" }}>Clients ({clients.length})</div>
          {clients.length === 0 && <div style={{ fontSize: "13px", color: "#888880" }}>No client accounts yet.</div>}
          {clients.map((cl) => {
            const clientLinks = links.filter((l) => l.client_id === cl.id);
            return (
              <div key={cl.id} style={{ background: "#1A1A18", border: "1px solid #2A2A28", borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", color: "#E8E8E4", fontWeight: "600" }}>{cl.full_name || cl.email}</div>
                <div style={{ fontSize: "12px", color: "#888880", marginBottom: "10px" }}>{cl.email}{cl.must_change_password ? " · hasn't signed in yet (temporary password active)" : ""}</div>

                {clientLinks.length > 0 && (
                  <div style={{ marginBottom: "10px" }}>
                    {clientLinks.map((l) => (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#0E0E0C", border: "1px solid #2A2A28", borderRadius: "8px", marginBottom: "6px" }}>
                        <span style={{ fontSize: "13px", color: l.access_revoked ? "#888880" : "#C8C8C4", textDecoration: l.access_revoked ? "line-through" : "none" }}>{contractName(l.contract_id)}</span>
                        <button onClick={() => toggleRevoke(l)} style={{ padding: "5px 10px", borderRadius: "7px", border: "none", background: l.access_revoked ? "#1A2A20" : "#3A2020", color: l.access_revoked ? "#6EC4A7" : "#E06050", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: F }}>
                          {l.access_revoked ? "Restore access" : "Revoke access"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: "8px" }}>
                  <select style={{ ...input, flex: 1, cursor: "pointer" }} value={assign[cl.id] || ""} onChange={(e) => setAssign({ ...assign, [cl.id]: e.target.value })}>
                    <option value="">— Assign a contract —</option>
                    {contracts.map((c) => <option key={c.id} value={c.id}>{c.client}: {c.topic}</option>)}
                  </select>
                  <button onClick={() => assignContract(cl.id)} style={{ padding: "0 16px", borderRadius: "10px", border: "none", background: "#6EC4A7", color: "#0E0E0C", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>Assign</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AdminGuard>
  );
}
