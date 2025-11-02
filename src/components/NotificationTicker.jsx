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

/* ===== Marquee Row (mobile spacing + no-overlap) ===== */
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
