// NotificationTicker.jsx — auto-scrolling Kerala PSC notifications (2025 only)
// MOBILE FIX: tighter gaps on small screens, no-wrap pills, flex-none to prevent shrink.
// - Works with your existing <NotificationTicker limit={40} /> in App.jsx.

import { useEffect, useMemo, useRef, useState } from "react";

const SRC = "https://r.jina.ai/http://www.keralapsc.gov.in/notifications"; // CORS-friendly
const CACHE_KEY = "kpsc_notifs_2025_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function parseItemsFromText(raw) {
  const text = String(raw || "");
  const items = [];
  const reBlock =
    /EXTRA ORDINARY GAZETTE DATE\s+(\d{2}\/\d{2}\/\d{4})([\s\S]*?)(?=EXTRA ORDINARY GAZETTE DATE|\n##|$)/gi;

  let m;
  while ((m = reBlock.exec(text))) {
    const date = m[1];
    if (!/\/2025$/.test(date)) continue; // Only 2025
    const block = m[2] || "";

    const catMatch = block.match(/CAT\.?\s*NO\s*:?\s*([^\n]+)/i);
    const cats = catMatch ? catMatch[1].trim() : "";

    const lastMatch = block.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    const lastDate = lastMatch ? lastMatch[1] : "";

    const slug = date.replace(/\D/g, "");
    const url = `https://www.keralapsc.gov.in/extra-ordinary-gazette-date-${slug}`;

    items.push({
      title: `Extra Ordinary Gazette ${date}`,
      date,
      cats,
      lastDate,
      url,
    });
  }

  // Fallback finder if structure changes
  if (items.length === 0) {
    const lineRe = /EXTRA ORDINARY GAZETTE DATE\s+(\d{2}\/\d{2}\/\d{4})/gi;
    const lines = text.split(/\n+/);
    for (let i = 0; i < lines.length; i++) {
      let l;
      while ((l = lineRe.exec(lines[i]))) {
        const date = l[1];
        if (!/\/2025$/.test(date)) continue;
        const lookahead = lines.slice(i, i + 6).join(" ");
        const cat = (lookahead.match(/CAT\.?\s*NO\s*:?\s*([^\n]+)/i) || [,""])[1].trim();
        const last = (lookahead.match(/\b(\d{2}-\d{2}-\d{4})\b/) || [,""])[1];
        const slug = date.replace(/\D/g, "");
        items.push({
          title: `Extra Ordinary Gazette ${date}`,
          date,
          cats: cat,
          lastDate: last,
          url: `https://www.keralapsc.gov.in/extra-ordinary-gazette-date-${slug}`,
        });
      }
    }
  }

  items.sort((a, b) => {
    const [da, ma, ya] = a.date.split("/").map(Number);
    const [db, mb, yb] = b.date.split("/").map(Number);
    return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
  });
  return items;
}

async function fetchNotifications() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
      return cached.items || [];
    }
  } catch {}

  const res = await fetch(SRC, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const items = parseItemsFromText(text);

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items }));
  } catch {}
  return items;
}

export default function NotificationTicker({ limit = 40, speed = 48 }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const data = await fetchNotifications();
        if (!on) return;
        setItems(data);
      } catch (e) {
        if (!on) return;
        setErr(e?.message || "Failed to load");
      }
    })();
    return () => { on = false; };
  }, []);

  const shown = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.slice(0, Math.max(1, limit));
  }, [items, limit]);

  const marqueeContent = useMemo(() => (
    <>
      <MarqueeRow items={shown} />
      <MarqueeRow items={shown} />
    </>
  ), [shown]);

  // Inject keyframes once
  useEffect(() => {
    if (!wrapRef.current) return;
    const id = "kpsc-ticker-anim";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @keyframes kpsc-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div
      ref={wrapRef}
      className="rounded-2xl border border-emerald-100 bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-emerald-50 border-b border-emerald-100 text-emerald-800 dark:bg-slate-700 dark:border-slate-600 dark:text-emerald-200">
        <span>📢</span>
        <span>Kerala PSC — Latest Notifications (2025)</span>
        <a
          className="ml-auto text-emerald-700 underline dark:text-emerald-300"
          href="https://www.keralapsc.gov.in/notifications"
          target="_blank"
          rel="noreferrer"
          title="Open official notifications page"
        >
          Open site
        </a>
      </div>

      {/* Body */}
      <div className="relative">
        {!items && !err && (
          <div className="px-3 py-3 text-sm text-slate-600 dark:text-slate-300">
            Loading latest 2025 notifications…
          </div>
        )}
        {err && (
          <div className="px-3 py-3 text-sm text-red-600 dark:text-red-400">
            Failed to load notifications. Please try again later.
          </div>
        )}

        {shown.length > 0 && (
          <div className="overflow-hidden group">
            <div
              className="flex whitespace-nowrap"
              style={{
                width: "200%",
                animation: `kpsc-marquee ${Math.max(18, Math.min(120, speed))}s linear infinite`,
                animationPlayState: "running",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = "paused")}
              onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = "running")}
            >
              {marqueeContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Mobile spacing & no-overlap row ===== */
function MarqueeRow({ items }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4 md:gap-6 px-2 sm:px-3 py-2 min-w-[50%] flex-none">
      {items.map((n, idx) => (
        <a
          key={idx}
          href={n.url}
          target="_blank"
          rel="noreferrer"
          title={n.title}
          /* MOBILE FIXES:
             - whitespace-nowrap: keep each pill on one line
             - flex-none: prevent shrinking/overlap
             - text-xs on mobile for tighter layout
             - leading-[1.25]: consistent line height
          */
          className="whitespace-nowrap flex-none inline-flex items-center gap-2 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-100 hover:bg-emerald-100 dark:bg-slate-700 dark:text-emerald-200 dark:border-slate-600 text-xs sm:text-sm leading-[1.25]"
        >
          <span className="font-semibold">{n.title}</span>
          {n.cats && <span className="opacity-80">• {n.cats}</span>}
          {n.lastDate && <span className="opacity-80">• Last date: {n.lastDate}</span>}
        </a>
      ))}
    </div>
  );
}
