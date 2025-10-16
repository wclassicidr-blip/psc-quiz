// === src/App.jsx ===
// Tea Green theme + Online Battle + Study Material / Exam Notifications lists
// - Loads quiz data and two extra tabs from Google Sheets (GViz)
// - Shuffled options, 2s auto-advance with feedback
// - Home: "Online Battle", Categories, and new "Study Material" + "Exam Notifications" cards
// - List pages with sticky header + search for both tabs

import { useEffect, useMemo, useState } from "react";

/* ───────────────────────── CONFIG ───────────────────────── */
const DEFAULT_FILE_ID = "16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o";
const GS_FILE_ID =
  (import.meta?.env?.VITE_GS_FILE_ID || "").trim() || DEFAULT_FILE_ID;

const TAB_CATEGORIES = "Categories";
const TAB_QUESTIONS = "Questions";

// NEW: names of extra tabs
const TAB_STUDY = "Study Material";
const TAB_EXAMS = "Exam Notifications";

const BATTLE_QUESTION_COUNT = 20;

/* ───────────────────────── Utils ───────────────────────── */
const cx = (...xs) => xs.filter(Boolean).join(" ");
const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();
const strip = (s) => lower(s).replace(/[^a-z0-9]+/g, "");
const normalizeSheetName = (s) =>
  norm(s).replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-").replace(/\s+/g, " ");

const rand = (n) => Math.floor(Math.random() * n);
const sampleOne = (arr) => (arr.length ? arr[rand(arr.length)] : undefined);
function sampleMany(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

function parseGViz(text) {
  const t = String(text || "");
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error("GViz parse error");
}

async function gvizFetch({ sheetName, gid, tq = "select *" }) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`
  );
  if (gid) url.searchParams.set("gid", gid);
  else url.searchParams.set("sheet", sheetName);
  url.searchParams.set("tq", tq);
  url.searchParams.set("tqx", "out:json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`GViz HTTP ${res.status}`);
  const raw = await res.text();
  const json = parseGViz(raw);

  // Promote first row to header if GViz uses generic labels
  let cols = (json.table?.cols || []).map((c, i) =>
    lower(c?.label || c?.id || `col${i + 1}`)
  );
  let rows = (json.table?.rows || []).map((r) =>
    (r.c || []).map((c) => ((c && c.v) != null ? String(c.v) : ""))
  );
  const looksGeneric = cols.every(
    (c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c)
  );
  const firstRowHeaderish = (rows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual|question|opt|correct|title|url|desc|date)/i.test(
      String(v || "")
    )
  );
  if (looksGeneric && firstRowHeaderish) {
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

/* Questions mapping */
function mapQuestionRows(cols, rows, defaultCategory = "General") {
  const idxQ = findHeaderIndex(cols, ["question", "q", "title"]);
  const idxAns = findHeaderIndex(cols, ["answer", "ans", "correcttext"]);
  const idxA = findHeaderIndex(cols, ["optA", "a", "option a", "1"]);
  const idxB = findHeaderIndex(cols, ["optB", "b", "option b", "2"]);
  const idxC = findHeaderIndex(cols, ["optC", "c", "option c", "3"]);
  const idxD = findHeaderIndex(cols, ["optD", "d", "option d", "4"]);
  const idxCor = findHeaderIndex(cols, ["correct", "answerindex", "correct option"], -1);
  const idxCat = findHeaderIndex(cols, ["category", "subject", "topic", "cat"], -1);

  const items = [];
  for (const r of rows) {
    const text = norm(r[idxQ]);
    const options = [r[idxA], r[idxB], r[idxC], r[idxD]].map(norm).filter(Boolean);
    if (!text || options.length < 2) continue;

    const answerText = norm(r[idxAns]);
    const correctRaw = norm(r[idxCor]);

    let answerIndex = -1;
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

/* NEW: map generic list rows (title/url/desc/date) */
function mapListRows(cols, rows) {
  const idxTitle = findHeaderIndex(cols, ["title", "name", "heading"], 0);
  const idxUrl = findHeaderIndex(cols, ["url", "link", "href"], 1);
  const idxDesc = findHeaderIndex(cols, ["desc", "description", "about"], 2);
  const idxDate = findHeaderIndex(cols, ["date", "when"], 3);

  const items = [];
  for (const r of rows) {
    const title = norm(r[idxTitle]);
    const url = norm(r[idxUrl]);
    const desc = norm(r[idxDesc]);
    const date = norm(r[idxDate]);
    if (!title) continue;
    items.push({ title, url, desc, date });
  }

  // Try a simple sort by date (desc)
  items.sort((a, b) => {
    const da = Date.parse(a.date || "");
    const db = Date.parse(b.date || "");
    if (Number.isFinite(db) && Number.isFinite(da)) return db - da;
    return (b.date || "").localeCompare(a.date || "");
  });

  return items;
}

/* Shuffle utility that keeps track of the correct index */
function shuffleWithIndex(arr, correctIdx) {
  const idxs = arr.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const newOptions = idxs.map((i) => arr[i]);
  const newCorrect = idxs.indexOf(correctIdx);
  return { newOptions, newCorrect };
}

function toBank(items) {
  const bank = {};
  for (const it of items) {
    const { newOptions, newCorrect } = shuffleWithIndex(it.options, it.answerIndex);
    bank[it.cat] ??= [];
    bank[it.cat].push({
      id: bank[it.cat].length + 1,
      text: it.text,
      options: newOptions,
      answerIndex: newCorrect,
    });
  }
  return bank;
}

function flattenBank(bank) {
  const out = [];
  for (const [cat, list] of Object.entries(bank)) {
    for (const q of list) out.push({ ...q, cat });
  }
  return out;
}

/* ───────────────────────── Data loaders ───────────────────────── */
async function loadQuestionBank() {
  // Try single "Questions" sheet first
  try {
    const { cols, rows } = await gvizFetch({ sheetName: TAB_QUESTIONS });
    if (rows.length) {
      const items = mapQuestionRows(cols, rows);
      const bank = toBank(items);
      if (Object.keys(bank).length) return bank;
    }
  } catch {}

  // Fallback: Categories + each tab
  const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_CATEGORIES });

  let cCols = cCols0, cRows = cRows0;
  const generic = cCols.every((c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c));
  const firstLooksHeader = (cRows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual)/i.test(String(v || ""))
  );
  if (generic && firstLooksHeader) {
    cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`));
    cRows = cRows.slice(1);
  }

  let idxDisplay = findHeaderIndex(cCols, ["name (display)", "display", "title", "name"], -1);
  let idxTab = findHeaderIndex(
    cCols,
    ["text (actual tab name)", "actual tab name", "tab", "sheet", "sheetname"],
    -1
  );
  if (idxDisplay === -1 || idxTab === -1) {
    const idIdx = cCols.findIndex((x) => strip(x) === "id");
    const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx);
    if (idxDisplay === -1 && indices.length) idxDisplay = indices[0];
    if (idxTab === -1 && indices.length > 1) idxTab = indices[1];
  }
  if (idxDisplay === -1) idxDisplay = 1;
  if (idxTab === -1) idxTab = 2;

  const mappings = cRows
    .map((r) => ({
      display: normalizeSheetName(r[idxDisplay]),
      tab: normalizeSheetName(r[idxTab]),
    }))
    .filter((m) => m.display && m.tab);

  const bank = {};
  for (const m of mappings) {
    try {
      const isGid = /^\d+$/.test(m.tab);
      const { cols, rows } = await gvizFetch({
        sheetName: isGid ? undefined : m.tab,
        gid: isGid ? m.tab : undefined,
      });
      const items = mapQuestionRows(cols, rows, m.display);
      bank[m.display] = toBank(items)[m.display] || [];
    } catch (e) {
      console.warn("Failed loading tab", m.tab, e);
      bank[m.display] = [];
    }
  }

  return bank;
}

async function loadList(tabName) {
  try {
    const { cols, rows } = await gvizFetch({ sheetName: tabName });
    return mapListRows(cols, rows);
  } catch (e) {
    console.warn("List load failed for", tabName, e);
    return [];
  }
}

/* ───────────────────────── UI bits ───────────────────────── */
const Card = ({ children, className = "" }) => (
  <div className={cx("rounded-2xl bg-white shadow-sm border border-emerald-100", className)}>
    {children}
  </div>
);

function LinearProgress({ value, max }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-emerald-100 rounded-full overflow-hidden">
      <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  return (
    <div className="relative w-10 h-10">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-100" strokeWidth="6" />
        <circle
          cx="22"
          cy="22"
          r={R}
          className="fill-none stroke-emerald-600 transition-[stroke-dasharray] duration-200"
          strokeLinecap="round"
          strokeWidth="6"
          strokeDasharray={`${C * p} ${C}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-emerald-700">
        0{Math.max(0, secondsLeft).toString().padStart(2, "0")}
      </div>
    </div>
  );
}

function OptionButton({
  label,
  letter,
  disabled,
  isSelected,
  showFeedback,
  isCorrect,
  isWrong,
}) {
  const feedbackClass = showFeedback
    ? isCorrect
      ? "border-green-500 bg-green-50"
      : isWrong
      ? "border-red-500 bg-red-50"
      : "border-transparent"
    : isSelected
    ? "border-emerald-600 ring-2 ring-emerald-200"
    : "border-transparent hover:border-emerald-200";

  const textColor = showFeedback
    ? isCorrect
      ? "text-green-800"
      : isWrong
      ? "text-red-700"
      : "text-slate-800"
    : "text-slate-800";

  return (
    <button
      disabled={disabled}
      className={cx(
        "w-full text-left rounded-xl border-2 px-4 py-3 mb-3 transition-all bg-white/80",
        feedbackClass
      )}
    >
      <span className="inline-flex items-center gap-3">
        <span
          className={cx(
            "grid place-items-center w-6 h-6 rounded-full text-xs font-semibold",
            showFeedback
              ? isCorrect
                ? "bg-green-100 text-green-700"
                : isWrong
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700"
              : "bg-emerald-100 text-emerald-700"
          )}
        >
          {letter}
        </span>
        <span className={cx("text-[15px]", textColor)}>{label}</span>
      </span>
    </button>
  );
}

/* Loading screen */
function Splash({ label = "Loading from Google Sheets…" }) {
  const messages = [
    "Personalizing your questions…",
    "Finding new online friends…",
    "Updating new questions…",
    "Sharpening brain cells…",
    "Warming up the quiz engine…",
    "Checking your lucky stars…",
  ];
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % messages.length), 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4" />
        <div className="text-emerald-700 font-semibold text-[15px] transition-opacity duration-300">
          {messages[i]}
        </div>
        <div className="text-slate-600 text-xs mt-1">{label}</div>
        <div className="w-56 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4">
          <div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* Avatars */
function CartoonAvatar() {
  return (
    <div className="w-12 h-12 rounded-full bg-emerald-200 grid place-items-center overflow-hidden">
      <svg viewBox="0 0 64 64" width="36" height="36">
        <circle cx="32" cy="24" r="12" fill="#fff" />
        <path d="M12 54c3-10 13-14 20-14s17 4 20 14" fill="#fff" />
        <circle cx="28" cy="22" r="2" fill="#059669" />
        <circle cx="36" cy="22" r="2" fill="#059669" />
        <path d="M26 27c2 2 8 2 10 0" stroke="#059669" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
function OppAvatar({ name }) {
  const initials = useMemo(
    () =>
      name
        .split(" ")
        .map((w) => w[0]?.toUpperCase())
        .slice(0, 2)
        .join(""),
    [name]
  );
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div
      className="w-10 h-10 rounded-full grid place-items-center text-sm font-bold text-white"
      style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }}
      title={name}
    >
      {initials || "OP"}
    </div>
  );
}

/* ───────────────────────── Battle assets ───────────────────────── */
const MALAYALI_NAMES = [
  "Anand","Akhil","Ajith","Anu","Amala","Hari","Gopika","Sreenath","Nimisha","Midhun","Varun",
  "Fahad","Mamta","Dulquer","Nazriya","Tovino","Keerthi","Surya","Meera","Aswin","Neha","Anjana",
  "Athul","Devika","Mohan","Sreejith","Athira","Jishnu","Remya","Arjun","Anoop","Sarath",
  "Abhiram","Nikhil","Sneha","Gayathri","Adithya","Aparna"
];
const KERALA_PLACES = [
  "Thiruvananthapuram","Kollam","Pathanamthitta","Alappuzha","Kottayam","Idukki","Ernakulam",
  "Thrissur","Palakkad","Malappuram","Kozhikode","Wayanad","Kannur","Kasaragod","Kochi",
  "Muvattupuzha","Kattappana","Pala","Chalakudy","Kunnamkulam","Nedumangad","Neyyattinkara",
  "Attingal","Kayamkulam","Tirur","Perinthalmanna","Payyannur","Taliparamba","Kanhangad",
  "Varkala","Adoor","Changanassery","Irinjalakuda","Thodupuzha"
];

function randomOpponent() {
  return {
    name: sampleOne(MALAYALI_NAMES) + " " + sampleOne(["K", "S", "N", "M", "P", "V"]),
    place: sampleOne(KERALA_PLACES),
  };
}

/* ───────────────────────── Views ───────────────────────── */
function Home({
  bank,
  onStartCategory,
  onSeeAll,
  onStartBattle,
  studyCount,
  examCount,
  openStudy,
  openExams,
}) {
  const cats = Object.keys(bank);
  const preview = cats.slice(0, 6);
  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm px-4 pb-28 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <CartoonAvatar />
            <div>
              <p className="text-[15px] font-semibold text-slate-900">PSC Guru</p>
              <p className="text-[13px] text-slate-600">No1 PSC Learning App</p>
            </div>
          </div>
        </div>

        {/* Search (visual only) */}
        <div className="mb-5">
          <div className="flex items-center gap-2 bg-white/80 border border-emerald-100 rounded-xl px-3 py-2">
            <span className="text-slate-400">🔎</span>
            <input className="w-full text-[14px] outline-none placeholder:text-slate-400" placeholder="Search for a quiz" readOnly />
          </div>
        </div>

        {/* Promo */}
        <Card className="p-4 mb-4 bg-gradient-to-br from-lime-400 to-emerald-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm/5 opacity-90">Play and Win</p>
              <p className="text-xs/5 opacity-80">Start a quiz now and enjoy</p>
            </div>
            <button
              onClick={() => onStartCategory(preview[0] || cats[0])}
              className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold"
            >
              Get Started
            </button>
          </div>
        </Card>

        {/* Online Battle card */}
        <Card className="p-4 mb-6 bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Online Battle</p>
              <p className="text-sm opacity-90">Match with an opponent & race!</p>
            </div>
            <button
              onClick={onStartBattle}
              className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold"
            >
              Find Battle
            </button>
          </div>
        </Card>

        {/* Categories */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-slate-900">Categories</h3>
          <button onClick={onSeeAll} className="text-[13px] text-emerald-700">
            See all
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {preview.map((c) => (
            <button
              key={c}
              onClick={() => onStartCategory(c)}
              className="rounded-2xl p-3 bg-white border border-emerald-100 hover:border-emerald-200"
            >
              <div className="w-10 h-10 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">＋</div>
              <div className="text-[13px] font-medium text-slate-800">{c}</div>
              <div className="text-[11px] text-slate-500">{(bank[c] || []).length} questions</div>
            </button>
          ))}
        </div>

        {/* NEW: Two cards in a row */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={openStudy}
            className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📚</div>
            <div className="text-[14px] font-semibold text-slate-800">Study Material</div>
            <div className="text-[12px] text-slate-500">{studyCount} items</div>
          </button>

          <button
            onClick={openExams}
            className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📢</div>
            <div className="text-[14px] font-semibold text-slate-800">Exam Notifications</div>
            <div className="text-[12px] text-slate-500">{examCount} items</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function AllCategories({ bank, onStartCategory, onBack }) {
  const [q, setQ] = useState("");
  const cats = Object.keys(bank).filter((n) => n.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full max-w-sm mx-auto pb-20">
        {/* Sticky top bar */}
        <div className="sticky top-0 z-30 -mx-4 px-4 pt-4 pb-3 bg-[#eefbe7]/95 backdrop-blur supports-[backdrop-filter]:bg-[#eefbe7]/80 border-b border-emerald-100">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onBack} className="text-slate-600">←</button>
            <div className="text-[15px] font-semibold">All Categories</div>
            <span className="w-4" />
          </div>

          <div>
            <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search categories"
                className="w-full text-[14px] outline-none placeholder:text-slate-400 bg-transparent"
                autoFocus
              />
            </div>
          </div>
        </div>

        <div className="px-4 pt-3">
          <div className="grid grid-cols-3 gap-3">
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => onStartCategory(c)}
                className="rounded-2xl p-3 bg-white border border-emerald-100 hover:border-emerald-200 active:scale-[.99] transition"
              >
                <div className="w-10 h-10 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="opacity-80">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                </div>
                <div className="text-[12px] font-medium text-slate-800 text-left">{c}</div>
                <div className="text-[11px] text-slate-500 text-left">
                  {(bank[c] || []).length} questions
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Matching animation (3s) */
function BattleSearch({ onMatched }) {
  useEffect(() => {
    const id = setTimeout(() => {
      onMatched();
    }, 3000);
    return () => clearTimeout(id);
  }, [onMatched]);

  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm px-4 pt-16 text-center">
        <div className="relative w-48 h-48 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-emerald-200 animate-ping"></div>
          <div className="absolute inset-3 rounded-full border-4 border-emerald-300 animate-pulse"></div>
          <div className="absolute inset-6 rounded-full border-4 border-emerald-500 animate-spin"></div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex -space-x-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/80 animate-bounce"></div>
              <div className="w-10 h-10 rounded-full bg-teal-500/80 animate-[bounce_1.2s_infinite]"></div>
              <div className="w-10 h-10 rounded-full bg-lime-500/80 animate-[bounce_1.4s_infinite]"></div>
            </div>
          </div>
        </div>
        <div className="text-emerald-800 font-semibold text-lg mb-1">
          Finding an opponent…
        </div>
        <div className="text-slate-600 text-sm">Looking for players online</div>
      </div>
    </div>
  );
}

function Quiz({ category, bank, onFinish, customQuestions, opponent, battleMode }) {
  const qs = customQuestions || bank[category] || [];
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(25);
  const [showFeedback, setShowFeedback] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [history, setHistory] = useState([]);

  const q = qs[i];

  useEffect(() => {
    setSecondsLeft(25);
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [i]);

  useEffect(() => {
    if (secondsLeft <= 0 && q && !showFeedback && !advancing) {
      revealAndQueueNext(null);
    }
  }, [secondsLeft, showFeedback, advancing, q]);

  function nextQuestion() {
    if (i + 1 >= qs.length) {
      return onFinish({ score, total: qs.length, history, opponent, battleMode });
    }
    setI((x) => x + 1);
    setSel(null);
    setShowFeedback(false);
    setAdvancing(false);
  }

  function revealAndQueueNext(chosenIndex) {
    if (!q || advancing) return;
    setSel(chosenIndex);
    setShowFeedback(true);
    setAdvancing(true);

    const isCorrect = chosenIndex === q.answerIndex;
    if (chosenIndex != null) {
      setScore((s) => s + (isCorrect ? 1 : 0));
    }
    setHistory((h) => [
      ...h,
      {
        id: q.id,
        text: q.text,
        options: q.options,
        correctIndex: q.answerIndex,
        chosenIndex: chosenIndex,
        isCorrect: chosenIndex === q.answerIndex,
      },
    ]);

    setTimeout(() => {
      nextQuestion();
    }, 2000);
  }

  const letters = ["a", "b", "c", "d", "e", "f"];

  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm px-4 pb-20 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => onFinish({ score, total: qs.length, history, aborted: true, opponent, battleMode })}
            className="text-slate-600"
          >
            ←
          </button>
          <div className="text-[15px] font-semibold">
            {battleMode ? "Online Battle" : category}
          </div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={25} />
        </div>

        {battleMode && opponent && (
          <div className="flex items-center gap-3 mb-2">
            <OppAvatar name={opponent.name} />
            <div>
              <div className="text-[13px] font-semibold text-slate-800">
                {opponent.name}
              </div>
              <div className="text-[12px] text-slate-500">{opponent.place}</div>
            </div>
          </div>
        )}

        <div className="text-[12px] text-slate-500 mb-2">
          Question <span className="font-semibold">{Math.min(i + 1, qs.length)}/{qs.length || 0}</span>
        </div>
        <LinearProgress value={Math.min(i + 1, qs.length)} max={Math.max(1, qs.length)} />

        {!q ? (
          <Card className="p-4 mt-4 bg-white/90">
            <div className="text-[14px] text-slate-700">No questions found.</div>
          </Card>
        ) : (
          <>
            <Card className="p-4 mt-4 mb-3 bg-white/90">
              <div className="text-[14px] font-semibold text-slate-800">{q.text}</div>
            </Card>
            <div className="mt-2">
              {q.options.map((opt, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    if (showFeedback || advancing) return;
                    revealAndQueueNext(idx);
                  }}
                >
                  <OptionButton
                    letter={letters[idx]}
                    label={opt}
                    disabled={showFeedback || advancing}
                    isSelected={sel === idx}
                    showFeedback={showFeedback}
                    isCorrect={showFeedback && idx === q.answerIndex}
                    isWrong={showFeedback && sel === idx && idx !== q.answerIndex}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-sm px-4">
            <button className="w-full py-3 rounded-xl text-white font-semibold bg-emerald-300 cursor-not-allowed" disabled>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Generic list page (Study / Exams) */
function ListPage({ title, items, onBack }) {
  const [q, setQ] = useState("");
  const filtered = items.filter(
    (it) =>
      it.title.toLowerCase().includes(q.toLowerCase()) ||
      it.desc.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full max-w-sm mx-auto pb-20">
        {/* Sticky header with search */}
        <div className="sticky top-0 z-30 -mx-4 px-4 pt-4 pb-3 bg-[#eefbe7]/95 backdrop-blur supports-[backdrop-filter]:bg-[#eefbe7]/80 border-b border-emerald-100">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onBack} className="text-slate-600">←</button>
            <div className="text-[15px] font-semibold">{title}</div>
            <span className="w-4" />
          </div>
          <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              className="w-full text-[14px] outline-none placeholder:text-slate-400 bg-transparent"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="px-4 pt-3 space-y-3">
          {filtered.map((it, i) => (
            <Card key={i} className="p-3">
              <div className="text-[14px] font-semibold text-slate-800">{it.title}</div>
              {it.date && <div className="text-[12px] text-slate-500 mt-0.5">{it.date}</div>}
              {it.desc && <div className="text-[13px] text-slate-600 mt-2">{it.desc}</div>}
              <div className="mt-3">
                <a
                  href={it.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className={cx(
                    "inline-block px-3 py-1.5 rounded-lg text-sm font-semibold",
                    it.url ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"
                  )}
                  onClick={(e) => { if (!it.url) e.preventDefault(); }}
                >
                  {it.url ? "Open" : "No Link"}
                </a>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="p-4 text-center text-sm text-slate-600">
              No items found.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Result({ score, total, history, opponent, battleMode, onBack }) {
  const [showSummary, setShowSummary] = useState(false);
  const correctCount = history.filter((h) => h.isCorrect).length;

  const opponentScore = useMemo(() => {
    if (!battleMode) return null;
    const delta = Math.floor(Math.random() * 7) - 3; // -3..+3
    const raw = score + delta;
    const clamped = Math.max(0, Math.min(total, raw));
    return clamped;
  }, [battleMode, score, total]);

  if (showSummary) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
        <div className="w-full max-w-sm px-4 pb-16 pt-6">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setShowSummary(false)} className="text-slate-600">←</button>
            <div className="text-[15px] font-semibold">Summary</div>
            <span className="w-4" />
          </div>

          <div className="space-y-3">
            {history.map((h, idx) => (
              <Card key={idx} className="p-3">
                <div className="text-[13px] text-slate-500 mb-1">Q{idx + 1}</div>
                <div className="text-[14px] font-semibold text-slate-800 mb-2">{h.text}</div>
                <div className="space-y-1">
                  {h.options.map((o, i) => {
                    const isCorrect = i === h.correctIndex;
                    const isChosen = i === h.chosenIndex;
                    const cls = isCorrect
                      ? "bg-green-50 border-green-500"
                      : isChosen && !isCorrect
                      ? "bg-red-50 border-red-500"
                      : "bg-white border-transparent";
                    return (
                      <div key={i} className={cx("text-[13px] rounded-lg border px-3 py-2", cls)}>
                        {o}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
            {history.length === 0 && (
              <Card className="p-4 text-center text-sm text-slate-600">
                No answers to summarize.
              </Card>
            )}
          </div>

          <div className="fixed bottom-4 left-0 right-0">
            <div className="mx-auto max-w-sm px-4 grid gap-3">
              <button
                onClick={onBack}
                className="w-full py-3 rounded-xl text-white font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm px-4 pb-20 pt-8 text-center">
        <div className="w-36 h-36 rounded-full mx-auto mb-6 grid place-items-center bg-gradient-to-br from-lime-100 to-emerald-100 border border-emerald-100">
          <div className="w-16 h-16 rounded-full bg-emerald-200 text-emerald-700 font-bold grid place-items-center">★</div>
        </div>
        <div className="text-slate-500 text-sm">Your Score</div>
        <div className="text-4xl font-extrabold text-slate-900 mt-1">{score}/{total}</div>
        <div className="text-sm text-slate-600 mt-1">
          Correct: {correctCount} • Wrong: {history.length - correctCount}
        </div>

        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
          Keep practicing!
        </div>

        <div className="mt-3">
          <button
            onClick={() => setShowSummary(true)}
            className="px-4 py-2 rounded-lg font-semibold border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
          >
            View Summary
          </button>
        </div>

        {/* Battle comparison */}
        {battleMode && (
          <Card className="mt-6 p-3 text-left">
            <div className="text-[13px] text-slate-500 mb-2">Battle Result</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-100 p-3 bg-emerald-50/40">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-full grid place-items-center bg-emerald-500 text-white font-bold">
                    U
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800">User</div>
                    <div className="text-[12px] text-slate-500">Kerala</div>
                  </div>
                </div>
                <div className="text-[13px] text-slate-600">Score</div>
                <div className="text-xl font-extrabold text-slate-900">{score}</div>
              </div>

              <div className="rounded-xl border border-emerald-100 p-3 bg-white">
                <div className="flex items-center gap-3 mb-1">
                  <OppAvatar name={opponent?.name || "Opponent"} />
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800">
                      {opponent?.name || "Opponent"}
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {opponent?.place || "Kerala"}
                    </div>
                  </div>
                </div>
                <div className="text-[13px] text-slate-600">Score</div>
                <div className="text-xl font-extrabold text-slate-900">
                  {opponentScore}/{total}
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-sm px-4 grid gap-3">
            <button
              onClick={onBack}
              className="w-full py-3 rounded-xl text-white font-semibold bg-emerald-600 hover:bg-emerald-700"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */
export default function App() {
  // views: home | categories | battle_search | quiz | result | study | exams
  const [view, setView] = useState("home");
  const [category, setCategory] = useState("");
  const [bank, setBank] = useState({});
  const [result, setResult] = useState({ score: 0, total: 0, history: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // battle state
  const [battleQuestions, setBattleQuestions] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [battleMode, setBattleMode] = useState(false);

  // NEW: study / exams lists
  const [studyItems, setStudyItems] = useState([]);
  const [examItems, setExamItems] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [b, study, exams] = await Promise.all([
          loadQuestionBank(),
          loadList(TAB_STUDY),
          loadList(TAB_EXAMS),
        ]);
        if (!alive) return;
        setBank(b);
        setStudyItems(study);
        setExamItems(exams);
      } catch (e) {
        console.error(e);
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startCategory = (c) => {
    setCategory(c);
    setBattleMode(false);
    setBattleQuestions(null);
    setOpponent(null);
    setView("quiz");
  };

  const handleStartBattle = () => {
    setBattleMode(true);
    setBattleQuestions(null);
    setOpponent(null);
    setView("battle_search");
  };

  const handleMatched = () => {
    const opp = randomOpponent();
    const flat = flattenBank(bank);
    const picked = sampleMany(flat, BATTLE_QUESTION_COUNT).map((q, idx) => ({
      id: idx + 1,
      text: q.text,
      options: q.options,
      answerIndex: q.answerIndex,
      cat: q.cat,
    }));
    setOpponent(opp);
    setBattleQuestions(picked);
    setCategory("Random Battle");
    setView("quiz");
  };

  if (loading) return <Splash />;

  if (err) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
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
      {view === "home" && (
        <Home
          bank={bank}
          onStartCategory={startCategory}
          onSeeAll={() => setView("categories")}
          onStartBattle={handleStartBattle}
          studyCount={studyItems.length}
          examCount={examItems.length}
          openStudy={() => setView("study")}
          openExams={() => setView("exams")}
        />
      )}
      {view === "categories" && (
        <AllCategories
          bank={bank}
          onStartCategory={startCategory}
          onBack={() => setView("home")}
        />
      )}
      {view === "battle_search" && <BattleSearch onMatched={handleMatched} />}
      {view === "quiz" && (
        <Quiz
          category={category}
          bank={bank}
          customQuestions={battleQuestions}
          opponent={opponent}
          battleMode={battleMode}
          onFinish={(r) => {
            setResult(r);
            setView("result");
          }}
        />
      )}
      {view === "result" && (
        <Result
          score={result.score}
          total={result.total}
          history={result.history || []}
          opponent={result.opponent}
          battleMode={result.battleMode}
          onBack={() => {
            setView("home");
            setBattleMode(false);
            setBattleQuestions(null);
            setOpponent(null);
          }}
        />
      )}
      {view === "study" && (
        <ListPage
          title="Study Material"
          items={studyItems}
          onBack={() => setView("home")}
        />
      )}
      {view === "exams" && (
        <ListPage
          title="Exam Notifications"
          items={examItems}
          onBack={() => setView("home")}
        />
      )}
    </div>
  );
}
