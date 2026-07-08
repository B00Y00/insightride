"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AdminGuard({ children }) {
  const [state, setState] = useState("checking"); // checking | ok | denied

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile && profile.role === "admin") setState("ok");
      else setState("denied");
    })();
  }, []);

  if (state === "checking") {
    return (
      <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#888880", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
        Checking access…
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#E8E8E4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>Admin access only</div>
        <div style={{ fontSize: "14px", color: "#888880", marginBottom: "20px" }}>You need to be signed in as an administrator to view this page.</div>
        <a href="/login" style={{ padding: "12px 22px", borderRadius: "9px", background: "#D4A017", color: "#0E0E0C", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>Go to sign in</a>
      </div>
    );
  }
  return children;
}
