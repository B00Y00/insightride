"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export const sans = "'Inter', -apple-system, 'Segoe UI', sans-serif";
export const mono = "'IBM Plex Mono', ui-monospace, monospace";
export const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap";

export const LIGHT = {
  name: "light", bg: "#EEF1EC", card: "#FFFFFF", line: "#D9DED7", text: "#1A241E",
  faint: "#63705F", ink: "#0F1F18", pine: "#1B6B4A", pineSoft: "#E4EFE8",
  headerText: "#EEF1EC", headerFaint: "#B9C6BB", warnBg: "#FDF6E7", warnBorder: "#EAD9A8",
  warnText: "#7A6320", errBg: "#F7E9E6", errText: "#8C3A2B", inputBg: "#FBFCFA", track: "#E9EDE7",
};
export const DARK = {
  name: "dark", bg: "#101512", card: "#181F1A", line: "#2A342C", text: "#E4EAE4",
  faint: "#8FA091", ink: "#0B100D", pine: "#3E9C72", pineSoft: "#1C2E24",
  headerText: "#E4EAE4", headerFaint: "#8FA091", warnBg: "#2A2416", warnBorder: "#4A3F1E",
  warnText: "#D8C070", errBg: "#2E1B17", errText: "#E09A88", inputBg: "#131A15", track: "#232C25",
};

export function useTheme() {
  const [themeName, setThemeName] = useState("light");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        supabase.from("profiles").select("theme").eq("id", data.user.id).single()
          .then(({ data: p }) => { if (p?.theme === "dark") setThemeName("dark"); });
      }
    });
  }, []);
  return [themeName === "dark" ? DARK : LIGHT, themeName, setThemeName];
}

const PATHS = {
  video: <><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></>,
  transcript: <><path d="M6 2.5h9l4 4v15H6z" /><path d="M15 2.5v4h4" /><path d="M9 12h7M9 15.5h7" /></>,
  report: <><path d="M4 20V9M10 20V4M16 20v-8M21 20H3" /></>,
  stats: <><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></>,
  chat: <><path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z" /><path d="M9 11.5h6" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" /></>,
};

export function Icon({ name, size = 22, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] || null}
    </svg>
  );
}
