// src/components/NotificationTicker.jsx
import { useEffect, useMemo, useRef, useState } from "react";

export default function NotificationTicker({ limit = 40, className = "" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const rowRef = useRef(null);
  const [rowH, setRowH] = useState(48);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/kpsc-notifications?limit=${limit}`);
        const j = await r.json();
        if (alive && Array.isArray(j.items)) setItems(j.items);
      } catch (e) {
        console.error("Ticker fetch failed", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [limit]);

  useEffect(() => {
    // Measure a row for smooth scroll speed
    const el = rowRef.current;
    if (el) {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setRowH(h);
    }
  }, [items]);

  const doubled = useMemo(() => items.concat(items), [items]);
  const duration = Math.max(20, items.length * 2); // seconds

  return (
    <section
      className={`kpsc-ticker ${className}`}
      aria-label="Latest Kerala PSC Notifications 2025"
      style={{ ["--row-h"]: `${rowH}px`, ["--anim-dur"]: `${duration}s` }}
    >
      <div className="kpsc-ticker__head">
        <span className="kpsc-badge">Notifications</span>
        <a className="kpsc-viewall" href="https://www.keralapsc.gov.in/notifications" target="_blank" rel="noopener noreferrer">
          View all
        </a>
      </div>

      <div className={`kpsc-ticker__rail ${loading ? "is-loading" : ""}`} role="list" aria-live="polite">
        {loading ? (
          <div className="kpsc-skel">Loading latest 2025 notifications…</div>
        ) : items.length === 0 ? (
          <div className="kpsc-empty">
            No 2025 notifications found. Check{" "}
            <a href="https://www.keralapsc.gov.in/notifications" target="_blank" rel="noopener noreferrer">KPSC site</a>.
          </div>
        ) : (
          <ul className="kpsc-loop">
            {doubled.map((it, i) => (
              <li key={i} className="kpsc-row" role="listitem" ref={i === 0 ? rowRef : undefined}>
                <a href={it.pdfUrl} target="_blank" rel="noopener noreferrer" className="kpsc-link" title={it.title}>
                  <span className="kpsc-title">{it.title}</span>
                </a>
                <span className="kpsc-meta">
                  {it.catNo ? `Cat.No. ${it.catNo}` : ""}
                  {it.gazetteDate ? ` • Gazette: ${it.gazetteDate}` : ""}
                  {it.lastDate ? ` • Last Date: ${it.lastDate}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Minimal, scoped styles */}
      <style>{`
        .kpsc-ticker{--row-h:48px; --anim-dur:40s; border:1px solid var(--kpsc-br,#dbe7df); background:var(--kpsc-bg,#f5fbf7); border-radius:16px; padding:8px 12px; overflow:hidden}
        .kpsc-ticker__head{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 2px 8px}
        .kpsc-badge{font-weight:600; font-size:14px; padding:4px 8px; border-radius:999px; background:var(--kpsc-badge,#e6f3ec)}
        .kpsc-viewall{font-size:13px; text-decoration:none; opacity:.8}
        .kpsc-ticker__rail{position:relative; height:calc(var(--row-h) * 2.5); mask-image:linear-gradient(transparent,black 12%,black 88%,transparent)}
        .kpsc-loop{list-style:none; margin:0; padding:0; position:absolute; inset:0 auto auto 0; width:100%;
          animation: kpsc-up var(--anim-dur) linear infinite;}
        .kpsc-ticker__rail:hover .kpsc-loop{animation-play-state:paused}
        .kpsc-row{display:flex; flex-direction:column; gap:2px; height:var(--row-h); align-items:flex-start; justify-content:center; padding:4px 0}
        .kpsc-link{font-size:15px; line-height:1.25; font-weight:600; text-decoration:none}
        .kpsc-meta{font-size:12px; opacity:.8}
        .kpsc-skel, .kpsc-empty{height:calc(var(--row-h)*2.5); display:grid; place-items:center; font-size:14px; opacity:.8}
        @keyframes kpsc-up {
          0% { transform: translateY(0); }
          100% { transform: translateY(calc(-1 * var(--row-h) * ${Math.max(1, /* will be replaced at runtime visually */ 40)})); }
        }
        /* Dark mode friendly */
        @media (prefers-color-scheme: dark){
          .kpsc-ticker{--kpsc-bg:#0f1a15; --kpsc-br:#24352c; --kpsc-badge:#183026}
          .kpsc-link{color:#e7fff3}
          .kpsc-viewall{color:#d0e7dc}
        }
      `}</style>
    </section>
  );
}
