
// === src/App.jsx ===
// Quiz UI inspired by the provided mockups
// Stack: React + Tailwind (no external deps). Mobile-first, works on desktop.
// Loads Categories & Questions from your public Google Sheet.
// Supports TWO schemas:
//  1) Single "Questions" tab (Category, Question, A..D, Answer)
//  2) "Categories" tab (name(display), text(actual tab name)) + one tab per category.
// Your screenshot matches schema (2). This build fetches each category tab.

import { useEffect, useState } from "react";

// Google Sheets config (already set to your published link)
// https://docs.google.com/spreadsheets/d/e/2PACX-1vR4PuWTfq2838_kUaKcwmeWlKb5OtEmL6YqUX4DjPcrb6EaJfW-monSIqbZTiI3ZFrE6GBFHaP7k95A/pubhtml
const SHEET_PUBLISH_KEY =
  "2PACX-1vR4PuWTfq2838_kUaKcwmeWlKb5OtEmL6YqUX4DjPcrb6EaJfW-monSIqbZTiI3ZFrE6GBFHaP7k95A";

const TAB_CATEGORIES = "Categories"; // case-insensitive
const TAB_QUESTIONS = "Questions";   // optional, if you use schema (1)

// Demo fallback if Sheets fails
const DEMO_QS = [
  { id: 1, text: "Which 3 numbers have the same answer whether they're added or multiplied together?", options: ["6, 3 and 4", "1, 2 and 3", "2, 4 and 6", "1, 2 and 4"], answerIndex: 1 },
  { id: 2, text: "What is 12 × 12?", options: ["124", "122", "144", "164"], answerIndex: 2 },
  { id: 3, text: "The square root of 81 is…", options: ["7", "8", "9", "10"], answerIndex: 2 },
  { id: 4, text: "What is 3/5 as a percentage?", options: ["40%", "50%", "55%", "60%"], answerIndex: 3 },
];
const demoSet = (n = 8) => Array.from({ length: n }, (_, i) => ({ ...DEMO_QS[i % DEMO_QS.length], id: i + 1 }));
const FALLBACK_BANK = { Math: demoSet(8), Chemistry: demoSet(6), Physics: demoSet(6) };

// Helpers + tests
export function calcNewScore(prev, chosen, answerIndex) { return prev + (chosen === answerIndex ? 1 : 0); }

export function inferAnswerIndexFromValue(answerRaw, options) {
  if (answerRaw == null) return -1;
  const val = String(answerRaw).trim();
  const n = Number(val);
  if (Number.isFinite(n) && n >= 1 && n <= options.length) return n - 1; // numeric 1..N
  const L = val.toLowerCase();
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const li = letters.indexOf(L);
  if (li >= 0 && li < options.length) return li;
  const idx = options.findIndex((o) => String(o).trim().toLowerCase() === L);
  return idx >= 0 ? idx : -1;
}

const normKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function pick(obj, candidates) {
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    const want = normKey(cand);
    const k = keys.find((kk) => normKey(kk) === want);
    if (k) return obj[k];
  }
  for (const cand of candidates) {
    const want = normKey(cand);
    const k = keys.find((kk) => normKey(kk).includes(want));
    if (k) return obj[k];
  }
  return undefined;
}

// Minimal runtime tests (console-only)
(function __runTests() {
  try {
    console.assert(calcNewScore(0, 1, 1) === 1, "score +1 when correct from 0");
    console.assert(calcNewScore(2, 0, 1) === 2, "no change when wrong");
    console.assert(calcNewScore(5, 2, 2) === 6, "+1 from non-zero");

    console.assert(inferAnswerIndexFromValue(2, ["A","B"]) === 1, "numeric to index");
    console.assert(inferAnswerIndexFromValue("b", ["A","B"]) === 1, "letter to index");

    console.assert(pick({ ["Name (display)"]: "X" }, ["name(display)"]) === "X", "unicode key match");
  } catch (e) { console.error("Test failure:", e); }
})();

// Fetch utilities (GViz with CSV fallback)
const BASE_E = `https://docs.google.com/spreadsheets/d/e/${SHEET_PUBLISH_KEY}`;

const gvizUrl = (sheet, tq = "") => {
  const u = new URL(`${BASE_E}/gviz/tq`);
  u.searchParams.set("tqx", "out:json");
  u.searchParams.set("sheet", sheet);
  if (tq) u.searchParams.set("tq", tq);
  return u.toString();
};

export function parseGVizTextToJSON(text) {
  const t = String(text || "");
  const m = t.match(/setResponse\((.*)\)\s*;?\s*$/s);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const trimmed = t.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) { try { return JSON.parse(trimmed); } catch {} }
  const start = t.indexOf("{"); const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) { const body = t.slice(start, end + 1); try { return JSON.parse(body); } catch {} }
  const snippet = t.slice(0, 160).replace(/\s+/g, " ");
  throw new Error(`GViz parse error: unexpected response. Head: ${snippet}`);
}

function tableToObjects(table) {
  const cols = (table.cols || []).map((c, i) => (c?.label || c?.id || `col${i}`));
  return (table.rows || []).map((r) => {
    const obj = {};
    (r.c || []).forEach((cell, i) => (obj[cols[i]] = cell?.v ?? ""));
    return obj;
  });
}

export function parseCSV(csvText) {
  const rows = [];
  let i = 0, field = '', cur = [], inQuotes = false;
  const pushField = () => { cur.push(field); field = ''; };
  const pushRow = () => { rows.push(cur); cur = []; };
  const s = csvText.replace(/\r\n?/g, "\n");
  while (i < s.length) {
    const ch = s[i++];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += ch; }
    } else {
      if (ch === '"') inQuotes = True;
      else if (ch === ',') pushField();
      else if (ch === '\\n') { pushField(); pushRow(); }
      else field += ch;
    }
  }
  pushField(); pushRow();
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter(r => r.length && r.some(x=>x!==""))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

async function fetchCSVRows(sheetName) {
  const u = new URL(`${BASE_E}/pub`);
  u.searchParams.set("output", "csv");
  u.searchParams.set("sheet", sheetName);
  const res = await fetch(u.toString(), { mode: "cors" });
  const txt = await res.text();
  return parseCSV(txt);
}

async function fetchSheetRows(sheetName) {
  try {
    const url = gvizUrl(sheetName);
    const res = await fetch(url, { mode: "cors" });
    const txt = await res.text();
    const json = parseGVizTextToJSON(txt);
    if (json.status === "ok") return tableToObjects(json.table);
  } catch (e) {}
  try { return await fetchCSVRows(sheetName); } catch (e) {
    console.error("Both GViz and CSV failed for", sheetName, e);
    return [];
  }
}

// Parse per-category question rows
function parseQuestionRows(rows, defaultCategory = "General") {
  const bank = {};
  for (const r of rows) {
    const cat = pick(r, ["Category", "Subject", "Topic", "Cat"]) || defaultCategory;
    const text = pick(r, ["question", "Question", "Text", "Q", "Title"]);

    const A = pick(r, ["optA", "A", "Option A", "1"]) ?? "";
    const B = pick(r, ["optB", "B", "Option B", "2"]) ?? "";
    const C = pick(r, ["optC", "C", "Option C", "3"]) ?? "";
    const D = pick(r, ["optD", "D", "Option D", "4"]) ?? "";

    const answerRaw = pick(r, ["correct", "AnswerIndex", "Answer", "Correct", "Correct Option", "Ans"]);

    const options = [A, B, C, D].filter((x) => String(x).length > 0);
    if (!text || options.length < 2) continue;

    let answerIndex = inferAnswerIndexFromValue(answerRaw, options);
    if (answerIndex < 0) answerIndex = 0;

    if (!bank[cat]) bank[cat] = [];
    bank[cat].push({ id: bank[cat].length + 1, text, options, answerIndex });
  }
  return bank;
}

// Load for schema 2 (Categories + tabs) or schema 1
async function loadFromCategoryTabs() {
  const catRows = await fetchSheetRows(TAB_CATEGORIES);
  const mappings = catRows
    .map((r) => ({
      display: pick(r, ["name(display)", "displayname", "title", "name"]) || pick(r, ["Name (display)"]),
      tab: pick(r, ["text(actualtabname)", "text", "tab", "sheet", "sheetname", "actualtabname"]) || pick(r, ["text (actual tab name)"]),
    }))
    .filter((m) => m.display && m.tab);

  const results = await Promise.all(
    mappings.map(async (m) => {
      try {
        const rows = await fetchSheetRows(m.tab);
        const b = parseQuestionRows(rows, m.display);
        const list = b[m.display] || b[Object.keys(b)[0]] || [];
        return [m.display, list];
      } catch (e) {
        console.warn("Failed to load tab", m.tab, e);
        return [m.display, []];
      }
    })
  );

  const bank = {};
  for (const [name, list] of results) bank[name] = list;
  return bank;
}

async function loadQuestionBank() {
  const questionsRows = await fetchSheetRows(TAB_QUESTIONS).catch(() => []);
  if (questionsRows.length) {
    const bank = parseQuestionRows(questionsRows);
    if (Object.keys(bank).length) return bank;
  }
  const bank2 = await loadFromCategoryTabs();
  if (Object.keys(bank2).length) return bank2;
  return FALLBACK_BANK;
}

// UI helpers
const cx = (...xs) => xs.filter(Boolean).join(" ");

const Card = ({ children, className = "" }) => (
  <div className={cx("rounded-2xl bg-white shadow-sm border border-violet-100", className)}>{children}</div>
);

function Pill({ children, intent = "default" }) {
  const styles = { default: "bg-violet-100 text-violet-700", success: "bg-emerald-100 text-emerald-700", warning: "bg-amber-100 text-amber-700" }[intent];
  return <span className={cx("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium", styles)}>{children}</span>;
}

function LinearProgress({ value, max }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-violet-100 rounded-full overflow-hidden">
      <div className="h-full bg-violet-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const radius = 18; const C = 2 * Math.PI * radius; const progress = Math.max(0, Math.min(1, secondsLeft / totalSeconds)); const dash = C * progress;
  return (
    <div className="relative w-10 h-10">
      <svg viewBox="0 0 44 44" className="absolute inset-0 rotate-[-90deg]">
        <circle cx="22" cy="22" r={radius} className="fill-none stroke-violet-100" strokeWidth="6" />
        <circle cx="22" cy="22" r={radius} className="fill-none stroke-violet-600 transition-[stroke-dasharray] duration-200 ease-linear" strokeLinecap="round" strokeWidth="6" strokeDasharray={`${dash} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-violet-700">0{Math.max(0, secondsLeft).toString().padStart(2, "0")}</div>
    </div>
  );
}

function OptionButton({ label, isSelected, onClick, letter, disabled }) {
  return (
    <button disabled={disabled} onClick={onClick} className={cx("w-full text-left rounded-xl border-2 px-4 py-3 mb-3 transition-all","bg-white/80 hover:bg-white focus:outline-none", isSelected?"border-violet-600 ring-2 ring-violet-200":"border-transparent hover:border-violet-200")}> 
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

// Views
function Home({ bank, onStartCategory }) {
  const categories = Object.keys(bank);
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-24 pt-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-200 grid place-items-center"><span className="text-violet-700 text-sm font-semibold">K</span></div>
            <div>
              <p className="text-[13px] text-slate-500">Hi, Kenzy</p>
              <p className="text-[15px] font-semibold text-slate-900">Ready to play</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-violet-700 font-semibold"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6 6 .9-4.5 4.4 1 6.3L12 17l-5.5 2.6 1-6.3L3 8.9 9 8z"/></svg>200</div>
        </div>

        <div className="mb-5">
          <div className="flex items-center gap-2 bg-white/80 border border-violet-100 rounded-xl px-3 py-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input className="w-full text-[14px] outline-none placeholder:text-slate-400" placeholder="Search for a quiz"/>
          </div>
        </div>

        <Card className="p-4 mb-6 bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm/5 opacity-90">Play and Win</p>
              <p className="text-xs/5 opacity-80">Start a quiz now and enjoy</p>
            </div>
            <button onClick={() => onStartCategory(categories[0] || "Math")} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Get Started</button>
          </div>
        </Card>

        <div className="mb-4 flex items-center justify-between"><h3 className="text-[15px] font-semibold text-slate-900">Categories</h3><button className="text-[13px] text-violet-700">See all</button></div>
        <div className="grid grid-cols-3 gap-3 mb-7">
          {categories.map((c) => (
            <button key={c} onClick={() => onStartCategory(c)} className="rounded-2xl p-3 bg-white border border-violet-100 hover:border-violet-200 active:scale-[.99] transition">
              <div className="w-10 h-10 mb-2 rounded-xl bg-violet-50 grid place-items-center text-violet-700">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="opacity-80"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>
              </div>
              <div className="text-[13px] font-medium text-slate-800">{c}</div>
              <div className="text-[11px] text-slate-500">{bank[c]?.length || 0} questions</div>
            </button>
          ))}
        </div>

        <div className="mb-3">
          <h3 className="text-[15px] font-semibold text-slate-900 mb-2">Recent</h3>
          <Card className="p-3 mb-2 flex items-center justify-between">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-violet-50 grid place-items-center text-violet-700"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20V10"/><path d="M6 20V14"/><path d="M18 20V4"/></svg></div><div><div className="text-[14px] font-medium text-slate-900">Biology</div><div className="text-[12px] text-slate-500">12 questions</div></div></div>
            <Pill intent="success">Completed</Pill>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-violet-50 grid place-items-center text-violet-700"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 4h18M3 10h18M3 16h18"/></svg></div><div><div className="text-[14px] font-medium text-slate-900">Geography</div><div className="text-[12px] text-slate-500">20 questions</div></div></div>
            <Pill intent="warning">Incomplete</Pill>
          </Card>
        </div>

        <div className="fixed bottom-4 left-0 right-0"><div className="mx-auto max-w-sm px-4"><div className="rounded-2xl bg-white border border-violet-100 py-2 px-6 flex items-center justify-between text-slate-600"><span className="text-violet-700">●</span><span>▤</span><span>♡</span><span>⚙︎</span></div></div></div>
      </div>
    </div>
  );
}

function Quiz({ category, bank, onFinish }) {
  const TOTAL = (bank[category] || []).length;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(25);
  const [advancing, setAdvancing] = useState(false);

  const q = (bank[category] || [])[index];

  useEffect(() => { setSecondsLeft(25); const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000); return () => clearInterval(id); }, [index]);
  useEffect(() => { if (secondsLeft <= 0 && !advancing) handleNext(); }, [secondsLeft, advancing]);

  function handleNext(chosenIndex = selected) {
    if (!q) return onFinish({ score, total: TOTAL });
    const newScore = calcNewScore(score, chosenIndex, q?.answerIndex);
    if (index + 1 >= TOTAL) { onFinish({ score: newScore, total: TOTAL }); return; }
    setScore(newScore); setIndex((i) => i + 1); setSelected(null);
  }

  const letters = ["a", "b", "c", "d", "e", "f"];

  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-8 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => onFinish({ score, total: TOTAL, aborted: true })} className="text-slate-600">←</button>
          <div className="text-[15px] font-semibold">{category}</div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={25} />
        </div>
        <div className="text-[12px] text-slate-500 mb-2">Question <span className="font-semibold text-slate-700">{Math.min(index + 1, TOTAL)}/{TOTAL || 0}</span></div>
        <LinearProgress value={Math.min(index + 1, TOTAL)} max={Math.max(1, TOTAL)} />

        {!q ? (
          <Card className="p-4 mt-4 bg-white/90"><div className="text-[14px] text-slate-700">No questions found for this category.</div></Card>
        ) : (
          <>
            <Card className="p-4 mt-4 mb-3 bg-white/90"><div className="text-[14px] font-semibold text-slate-800">{q?.text}</div></Card>
            <div className="mt-2">
              {q?.options.map((opt, i) => (
                <OptionButton key={i} letter={letters[i]} label={opt} isSelected={selected === i} disabled={secondsLeft <= 0} onClick={() => { if (advancing) return; setSelected(i); setAdvancing(true); setTimeout(() => { handleNext(i); setAdvancing(false); }, 350); }} />
              ))}
            </div>
          </>
        )}

        <div className="fixed bottom-4 left-0 right-0"><div className="mx-auto max-w-sm px-4"><button onClick={handleNext} disabled={(selected == null && secondsLeft > 0) || advancing} className={cx("w-full py-3 rounded-xl text-white font-semibold", selected == null && secondsLeft > 0?"bg-violet-300":"bg-violet-600 hover:bg-violet-700")}>Next</button></div></div>
      </div>
    </div>
  );
}

function Result({ score, total, onBack }) {
  return (
    <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
      <div className="w-full max-w-sm px-4 pb-16 pt-10 text-center">
        <div className="w-36 h-36 rounded-full mx-auto mb-6 grid place-items-center bg-gradient-to-br from-fuchsia-100 to-indigo-100 border border-violet-100"><div className="w-16 h-16 rounded-full bg-violet-200 text-violet-700 font-bold grid place-items-center">★</div></div>
        <div className="text-slate-500 text-sm">Your Score</div>
        <div className="text-4xl font-extrabold text-slate-900 mt-1">{score}/{total}</div>
        <div className="text-xl font-semibold text-slate-900 mt-4">Congratulations!</div>
        <p className="text-slate-500 text-sm mt-1">Great job, Kenzy! You have done well</p>
        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 text-sm font-semibold"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6 6 .9-4.5 4.4 1 6.3L12 17l-5.5 2.6 1-6.3L3 8.9 9 8z"/></svg>200 Points</div>
        <div className="fixed bottom-4 left-0 right-0"><div className="mx-auto max-w-sm px-4 grid gap-3"><button onClick={onBack} className="w-full py-3 rounded-xl text-white font-semibold bg-violet-600 hover:bg-violet-700">Back to Home</button><button onClick={onBack} className="w-full py-3 rounded-xl font-semibold border border-violet-200 bg-white text-violet-700">Try another quiz</button></div></div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("home");
  const [category, setCategory] = useState("Math");
  const [result, setResult] = useState({ score: 0, total: 0 });
  const [bank, setBank] = useState(FALLBACK_BANK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await loadQuestionBank();
        if (alive) setBank(b);
      } catch (e) {
        console.error(e);
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <Splash label="Loading quizzes from Google Sheets…" />;

  if (error) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[#f6f3ff]">
        <div className="max-w-sm px-4">
          <Card className="p-4">
            <div className="text-[15px] font-semibold text-slate-900">Couldn't load from Google Sheets</div>
            <p className="text-sm text-slate-600 mt-1">{error}</p>
            <p className="text-sm text-slate-600 mt-2">Showing demo data so you can still try the UI.</p>
            <div className="mt-3"><button className="px-3 py-2 rounded-lg bg-violet-600 text-white" onClick={() => setError("")}>Use demo anyway</button></div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {view === "home" && (
        <Home bank={bank} onStartCategory={(c) => { setCategory(c); setView("quiz"); }} />
      )}
      {view === "quiz" && (
        <Quiz category={category} bank={bank} onFinish={(r) => { setResult(r); setView("result"); }} />
      )}
      {view === "result" && (
        <Result score={result.score} total={result.total} onBack={() => setView("home")} />
      )}
    </div>
  );
}
