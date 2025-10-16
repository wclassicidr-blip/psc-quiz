// === src/App.jsx ===
// Loads categories + questions from Google Sheets using GViz with /spreadsheets/d/{FILE_ID}.
// Home shows 6 categories; “See all” page with search; auto-advance on option click.

import { useEffect, useState } from "react";

/* ───────────────────────── 1) CONFIG ───────────────────────── */
const GS_FILE_ID = "16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o"; // <-- put your FILE ID here
const TAB_CATEGORIES = "Categories"; // columns: "Name (display)", "text (actual tab name)"
const TAB_QUESTIONS  = "Questions";  // optional single sheet (Category, Question, optA..optD, correct)

/* ───────────────────────── 2) UTILITIES ────────────────────── */
const cx = (...xs) => xs.filter(Boolean).join(" ");
const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();

function pick(obj, names) {
  const keys = Object.keys(obj);
  for (const n of names) {
    const want = lower(n);
    let k = keys.find((kk) => lower(kk) === want);
    if (k) return obj[k];
  }
  for (const n of names) {
    const want = lower(n);
    let k = keys.find((kk) => lower(kk).includes(want));
    if (k) return obj[k];
  }
  return undefined;
}

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
  const cols = (json.table?.cols || []).map((c) => lower(c?.label || c?.id || ""));
  const rows = (json.table?.rows || []).map((r) =>
    (r.c || []).map((c) => (c && c.v) != null ? String(c.v) : "")
  );
  return { cols, rows };
}

function mapQuestionRows(cols, rows, defaultCategory = "General") {
  const h = (n) => cols.findIndex((c) => c === lower(n));
  const idxQ  = h("question");
  const idxA  = h("answer");
  const idxA1 = h("opta"), idxB1 = h("optb"), idxC1 = h("optc"), idxD1 = h("optd");
  const idxCat = h("category");

  const items = [];
  for (const r of rows) {
    const q = norm(r[idxQ]);
    const ansText = norm(r[idxA]);
    const opts = [r[idxA1], r[idxB1], r[idxC1], r[idxD1]].map(norm).filter(Boolean);
    if (!q || opts.length < 2) continue;

    // correct can be in "correct" or derived from "answer"
    let correctIdx = -1;
    const idxCorrect = h("correct");
    const correctRaw = norm(r[idxCorrect]);
    if (correctRaw) {
      const v = correctRaw.toUpperCase();
      if ("ABCD".includes(v) && opts[v.charCodeAt(0) - 65]) correctIdx = v.charCodeAt(0) - 65;
      else {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= opts.length) correctIdx = n - 1;
      }
    }
    if (correctIdx < 0 && ansText) {
      const i = opts.findIndex((o) => lower(o) === lower(ansText));
      if (i >= 0) correctIdx = i;
    }
    if (correctIdx < 0) correctIdx = 0;

    items.push({
      cat: norm(r[idxCat]) || defaultCategory,
      text: q,
      options: opts,
      answerIndex: correctIdx,
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
  } catch {}

  // Fallback: Categories + each tab listed there
  const { cols: cCols, rows: cRows } = await gvizFetch(TAB_CATEGORIES);
  const idxDisplay = cCols.findIndex((c) => /(name.*display|display|title|name)/.test(c));
  const idxTab     = cCols.findIndex((c) => /(text.*actual|tab|sheet)/.test(c));
  if (idxDisplay < 0 || idxTab < 0) throw new Error("Categories sheet missing required columns");

  const mappings = cRows
    .map((r) => ({ display: norm(r[idxDisplay]), tab: norm(r[idxTab]) }))
    .filter((m) => m.display && m.tab);

  const bank = {};
  for (const m of mappings) {
    try {
      const { cols, rows } = await gvizFetch(m.tab);
      const items = mapQuestionRows(cols, rows, m.display);
      bank[m.display] = items.map((q, i) => ({
        id: i + 1,
        text: q.text,
        options: q.options,
        answerIndex: q.answerIndex,
      }));
    } catch (e) {
      console.warn("Failed loading", m.tab, e);
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

  // timer per question
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
            <div className="text-[15px] font-semibold">Couldn’t load Google Sheet</div>
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
