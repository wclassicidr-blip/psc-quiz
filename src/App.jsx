// === src/App.jsx ===
// Loads categories + questions from Google Sheets using /spreadsheets/d/{FILE_ID}/gviz/tq.
// Home shows 6 categories; “See all” page with search; auto-advance on option click.
// Header detection is tolerant (works even if GViz gives "A,B,C" or blank labels).

import { useEffect, useState } from "react";

/* ───────────────────────── 1) CONFIG ───────────────────────── */
const GS_FILE_ID = "PUT_YOUR_FILE_ID_HERE"; // e.g. "16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o"
const TAB_CATEGORIES = "Categories"; // has display name + tab name (or gid)
const TAB_QUESTIONS = "Questions";   // optional single-sheet schema

/* ───────────────────────── 2) UTILITIES ────────────────────── */
const cx = (...xs) => xs.filter(Boolean).join(" ");
const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();
const strip = (s) => lower(s).replace(/[^a-z0-9]+/g, "");

function parseGViz(text) {
  const t = String(text || "");
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error("GViz parse error");
}

async function gvizFetch(sheetName, tq = "select *") {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`);
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("tq", tq);
  url.searchParams.set("tqx", "out:json");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`GViz HTTP ${res.status}`);
  const raw = await res.text();
  const json = parseGViz(raw);

  // If header labels are missing, c.label will be "" and id may be "A", "B", ...
  let cols = (json.table?.cols || []).map((c, i) => lower(c?.label || c?.id || `col${i + 1}`));
  let rows = (json.table?.rows || []).map((r) => (r.c || []).map((c) => (c && c.v) != null ? String(c.v) : ""));

  // If GViz didn’t send real labels and the first row looks like headers, use first row as headers.
  const looksGeneric = cols.every((c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/.test(c));
  const firstRowLooksHeader = (rows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual|question|opta|optb|optc|optd|correct)/i.test(String(v || ""))
  );
  if (looksGeneric && firstRowLooksHeader) {
    cols = (rows[0] || []).map((v, i) => lower(v || `col${i + 1}`));
    rows = rows.slice(1);
  }

  return { cols, rows };
}

function findHeaderIndex(cols, candidates, fallbackIndex) {
  const candNorms = candidates.map((c) => strip(c));
  const colNorms = cols.map((c) => strip(c));
  for (const c of candNorms) {
    const i = colNorms.findIndex((cn) => cn === c || cn.includes(c));
    if (i !== -1) return i;
  }
  return typeof fallbackIndex === "number" ? fallbackIndex : -1;
}

function mapQuestionRows(cols, rows, defaultCategory = "General") {
  const idxQ   = findHeaderIndex(cols, ["question", "q", "title"]);
  const idxAns = findHeaderIndex(cols, ["answer", "ans", "correcttext"]);
  const idxA   = findHeaderIndex(cols, ["optA", "a", "option a", "1"]);
  const idxB   = findHeaderIndex(cols, ["optB", "b", "option b", "2"]);
  const idxC   = findHeaderIndex(cols, ["optC", "c", "option c", "3"]);
  const idxD   = findHeaderIndex(cols, ["optD", "d", "option d", "4"]);
  const idxCor = findHeaderIndex(cols, ["correct", "answerindex", "correct option"], -1);
  const idxCat = findHeaderIndex(cols, ["category", "subject", "topic", "cat"], -1);

  const items = [];
  for (const r of rows) {
    const text = norm(r[idxQ]);
    const optA = norm(r[idxA]), optB = norm(r[idxB]), optC = norm(r[idxC]), optD = norm(r[idxD]);
    const options = [optA, optB, optC, optD].filter(Boolean);
    if (!text || options.length < 2) continue;

    let answerIndex = -1;
    const correctRaw = norm(r[idxCor]);
    const answerText = norm(r[idxAns]);

    if (correctRaw) {
      const v = correctRaw.toUpperCase();
      if ("ABCD".includes(v)) answerIndex = v.charCodeAt(0) - 65;
      else {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= options.length) answerIndex = n - 1;
      }
    }
    if (answerIndex < 0 && answerText) {
      const i = options.findIndex((o) => strip(o) === strip(answerText));
      if (i >= 0) answerIndex = i;
    }
    if (answerIndex < 0) answerIndex = 0;

    items.push({
      cat: idxCat >= 0 ? norm(r[idxCat]) || defaultCategory : defaultCategory,
      text,
      options,
      answerIndex,
    });
  }
  return items;
}

function toBank(items) {
  const bank = {};
  for (const it of items) {
    bank[it.cat] ??= [];
    bank[it.cat].push({
      id: bank[it.cat].length + 1,
      text: it.text,
      options: it.options,
      answerIndex: it.answerIndex,
    });
  }
  return bank;
}

/* ───────────────────────── 3) DATA LOADER ──────────────────── */
async function loadQuestionBank() {
  // Try one-sheet schema first
  try {
    const { cols, rows } = await gvizFetch(TAB_QUESTIONS);
    if (rows.length) {
      const items = mapQuestionRows(cols, rows);
      const bank = toBank(items);
      if (Object.keys(bank).length) return bank;
    }
  } catch { /* ignore */ }

  // Fallback: Categories + each tab listed there
  const { cols: cCols0, rows: cRows0 } = await gvizFetch(TAB_CATEGORIES);

  // Detect headers robustly; if GViz gave A/B/C, try first row as header.
  let cCols = cCols0, cRows = cRows0;
  const generic = cCols.every((c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/.test(c));
  const firstLooksHeader = (cRows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual)/i.test(String(v || ""))
  );
  if (generic && firstLooksHeader) {
    cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`));
    cRows = cRows.slice(1);
  }

  // Try to find indices by names; if not, fall back to common positions (B,C)
  let idxDisplay = findHeaderIndex(cCols, ["name (display)", "display", "title", "name"]);
  let idxTab     = findHeaderIndex(cCols, ["text (actual tab name)", "actual tab name", "tab", "sheet", "sheet name", "sheetname"]);

  if (idxDisplay === -1 || idxTab === -1) {
    // Heuristic: ignore an "id" column, then pick the next two columns as display+tab.
    const idIdx = cCols.findIndex((x) => strip(x) === "id");
    const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx);
    if (idxDisplay === -1 && indices.length) idxDisplay = indices[0];
    if (idxTab === -1 && indices.length > 1) idxTab = indices[1];
  }
  if (idxDisplay === -1 || idxTab === -1) {
    // Final fallback: assume B=display, C=tab
    idxDisplay = idxDisplay === -1 ? 1 : idxDisplay;
    idxTab = idxTab === -1 ? 2 : idxTab;
  }

  const mappings = cRows
    .map((r) => ({ display: norm(r[idxDisplay]), tab: norm(r[idxTab]) }))
    .filter((m) => m.display && m.tab);

  const bank = {};
  for (const m of mappings) {
    try {
      // If "tab" cell looks like a numeric gid, GViz supports gid=<n>
      let cols, rows;
      if (/^\d+$/.test(m.tab)) {
        const url = new URL(`https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`);
        url.searchParams.set("gid", m.tab);
        url.searchParams.set("tqx", "out:json");
        const res = await fetch(url.toString(), { cache: "no-store" });
        const raw = await res.text();
        const json = parseGViz(raw);
        cols = (json.table?.cols || []).map((c, i) => lower(c?.label || c?.id || `col${i + 1}`));
        rows = (json.table?.rows || []).map((r) => (r.c || []).map((c) => (c && c.v) != null ? String(c.v) : ""));
      } else {
        ({ cols, rows } = await gvizFetch(m.tab));
      }

      const items = mapQuestionRows(cols, rows, m.display);
      bank[m.display] = items.map((q, i) => ({
        id: i + 1,
        text: q.text,
        options: q.options,
        answerIndex: q.answerIndex,
      }));
    } catch (e) {
      console.warn("Failed loading tab", m.tab, e);
      bank[m.display] = [];
    }
  }
  return bank;
}

/* ───────────────────────── 4) UI PIECES ────────────────────── */
const Card = ({ children, className = "" }) => (
  <div className={cx("rounded-2xl bg-white shadow-sm border border-violet-100", className)}>{children}</div>
);
function LinearProgress({ value, max }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-violet-100 rounded-full overflow-hidden">
      <div className="h-full bg-violet-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  return (
    <div className="relative w-10 h-10">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={R} className="fill-none stroke-violet-100" strokeWidth="6" />
        <circle cx="22" cy="22" r={R} className="fill-none stroke-violet-600 transition-[stroke-dasharray] duration-200"
                strokeLinecap="round" strokeWidth="6" strokeDasharray={`${C * p} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-violet-700">
        0{Math.max(0, secondsLeft).toString().padStart(2, "0")}
      </div>
    </div>
  );
}
function OptionButton({ label, isSelected, onClick, letter, disabled }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "w-full text-left rounded-xl border-2 px-4 py-3 mb-3 transition-all bg-white/80",
        isSelected ? "border-violet-600 ring-2 ring-violet-200" : "border-transparent hover:border-violet-200"
      )}
    >
      <span className="inline-flex items-center gap-3">
        <span className="grid place-items-center w-6 h-6 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">{letter}</span>
        <span className="text-[15px] text-slate-800">{label}</span>
      </span>
    </button>
  );
}
function Splash({ label = "Loading…" }) {
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin mx-auto mb-3" />
        <div className="text-violet-700 font-semibold">{label}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── 5) VIEWS ────────────────────────── */
function Home({ bank, onStartCategory, onSeeAll }) {
  const cats = Object.keys(bank);
  const preview = cats.slice(0, 6);
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-24 pt-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-200 grid place-items-center">
              <span className="text-violet-700 text-sm font-semibold">K</span>
            </div>
            <div><p className="text-[13px] text-slate-500">Hi, Kenzy</p><p className="text-[15px] font-semibold text-slate-900">Ready to play</p></div>
          </div>
          <div className="flex items-center gap-1 text-violet-700 font-semibold">★ 200</div>
        </div>

        <div className="mb-5">
          <div className="flex items-center gap-2 bg-white/80 border border-violet-100 rounded-xl px-3 py-2">
            <span className="text-slate-400">🔎</span>
            <input className="w-full text-[14px] outline-none placeholder:text-slate-400" placeholder="Search for a quiz" readOnly />
          </div>
        </div>

        <Card className="p-4 mb-6 bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <div><p className="text-sm/5 opacity-90">Play and Win</p><p className="text-xs/5 opacity-80">Start a quiz now and enjoy</p></div>
            <button onClick={() => onStartCategory(preview[0] || cats[0])} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Get Started</button>
          </div>
        </Card>

        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-slate-900">Categories</h3>
          <button onClick={onSeeAll} className="text-[13px] text-violet-700">See all</button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-7">
          {preview.map((c) => (
            <button key={c} onClick={() => onStartCategory(c)} className="rounded-2xl p-3 bg-white border border-violet-100 hover:border-violet-200">
              <div className="w-10 h-10 mb-2 rounded-xl bg-violet-50 grid place-items-center text-violet-700">＋</div>
              <div className="text-[13px] font-medium text-slate-800">{c}</div>
              <div className="text-[11px] text-slate-500">{(bank[c] || []).length} questions</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AllCategories({ bank, onStartCategory, onBack }) {
  const [q, setQ] = useState("");
  const cats = Object.keys(bank).filter((n) => n.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-20 pt-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-slate-600">←</button>
          <div className="text-[15px] font-semibold">All Categories</div>
          <span />
        </div>
        <div className="mb-4">
          <div className="flex items-center gap-2 bg-white/80 border border-violet-100 rounded-xl px-3 py-2">
            <span className="text-slate-400">🔎</span>
            <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search categories" className="w-full text-[14px] outline-none placeholder:text-slate-400" autoFocus />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {cats.map((c) => (
            <button key={c} onClick={() => onStartCategory(c)} className="rounded-2xl p-3 bg-white border border-violet-100 hover:border-violet-200">
              <div className="w-10 h-10 mb-2 rounded-xl bg-violet-50 grid place-items-center text-violet-700">＋</div>
              <div className="text-[12px] font-medium text-slate-800 text-left">{c}</div>
              <div className="text-[11px] text-slate-500 text-left">{(bank[c] || []).length} questions</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Quiz({ category, bank, onFinish }) {
  const qs = bank[category] || [];
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(25);
  const [advancing, setAdvancing] = useState(false);

  const q = qs[i];

  useEffect(() => {
    setSecondsLeft(25);
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [i]);

  useEffect(() => {
    if (secondsLeft <= 0 && !advancing) handleNext();
  }, [secondsLeft, advancing]);

  function handleNext(chosen = sel) {
    if (!q) return onFinish({ score, total: qs.length });
    const correct = chosen === q.answerIndex ? 1 : 0;
    const newScore = score + correct;
    if (i + 1 >= qs.length) return onFinish({ score: newScore, total: qs.length });
    setScore(newScore);
    setI(i + 1);
    setSel(null);
  }

  const letters = ["a","b","c","d","e","f"];

  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-8 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => onFinish({ score, total: qs.length, aborted: true })} className="text-slate-600">←</button>
          <div className="text-[15px] font-semibold">{category}</div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={25} />
        </div>
        <div className="text-[12px] text-slate-500 mb-2">Question <span className="font-semibold">{Math.min(i+1, qs.length)}/{qs.length || 0}</span></div>
        <LinearProgress value={Math.min(i+1, qs.length)} max={Math.max(1, qs.length)} />

        {!q ? (
          <Card className="p-4 mt-4 bg-white/90"><div className="text-[14px] text-slate-700">No questions found for this category.</div></Card>
        ) : (
          <>
            <Card className="p-4 mt-4 mb-3 bg-white/90"><div className="text-[14px] font-semibold text-slate-800">{q.text}</div></Card>
            <div className="mt-2">
              {q.options.map((opt, idx) => (
                <OptionButton
                  key={idx}
                  letter={letters[idx]}
                  label={opt}
                  isSelected={sel === idx}
                  disabled={secondsLeft <= 0}
                  onClick={() => {
                    if (advancing) return;
                    setSel(idx);
                    setAdvancing(true);
                    setTimeout(() => { handleNext(idx); setAdvancing(false); }, 350);
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-sm px-4">
            <button
              onClick={() => handleNext()}
              disabled={(sel == null && secondsLeft > 0) || advancing}
              className={cx("w-full py-3 rounded-xl text-white font-semibold",
                sel == null && secondsLeft > 0 ? "bg-violet-300" : "bg-violet-600 hover:bg-violet-700")}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Result({ score, total, onBack }) {
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-16 pt-10 text-center">
        <div className="w-36 h-36 rounded-full mx-auto mb-6 grid place-items-center bg-gradient-to-br from-fuchsia-100 to-indigo-100 border border-violet-100">
          <div className="w-16 h-16 rounded-full bg-violet-200 text-violet-700 font-bold grid place-items-center">★</div>
        </div>
        <div className="text-slate-500 text-sm">Your Score</div>
        <div className="text-4xl font-extrabold text-slate-900 mt-1">{score}/{total}</div>
        <div className="text-xl font-semibold text-slate-900 mt-4">Congratulations!</div>
        <p className="text-slate-500 text-sm mt-1">Great job, Kenzy! You have done well</p>
        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 text-sm font-semibold">★ 200 Points</div>
        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-sm px-4 grid gap-3">
            <button onClick={onBack} className="w-full py-3 rounded-xl text-white font-semibold bg-violet-600 hover:bg-violet-700">Back to Home</button>
            <button onClick={onBack} className="w-full py-3 rounded-xl font-semibold border border-violet-200 bg-white text-violet-700">Try another quiz</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 6) APP ──────────────────────────── */
export default function App() {
  const [view, setView] = useState("home"); // home | categories | quiz | result
  const [category, setCategory] = useState("");
  const [bank, setBank] = useState({});
  const [result, setResult] = useState({ score: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!GS_FILE_ID || GS_FILE_ID.includes("PUT_YOUR_FILE_ID_HERE")) {
          throw new Error("Missing GS_FILE_ID. Set the Spreadsheet file id.");
        }
        const b = await loadQuestionBank();
        if (alive) setBank(b);
      } catch (e) {
        console.error(e);
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const startCategory = (c) => { setCategory(c); setView("quiz"); };

  if (loading) return <Splash label="Loading from Google Sheets…" />;

  if (err) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
        <div className="max-w-sm px-4">
          <Card className="p-4">
            <div className="text-[15px] font-semibold">Couldn't load Google Sheet</div>
            <p className="text-sm text-slate-600 mt-2">{err}</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {view === "home" && <Home bank={bank} onStartCategory={startCategory} onSeeAll={() => setView("categories")} />}
      {view === "categories" && <AllCategories bank={bank} onStartCategory={startCategory} onBack={() => setView("home")} />}
      {view === "quiz" && <Quiz category={category} bank={bank} onFinish={(r)=>{ setResult(r); setView("result"); }} />}
      {view === "result" && <Result score={result.score} total={result.total} onBack={()=>setView("home")} />}
    </div>
  );
}
