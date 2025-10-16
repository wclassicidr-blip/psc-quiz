// === src/App.jsx ===
// Mobile-first UI with desktop responsiveness + Privacy/Terms pages + hash routing for SEO-friendly URLs

import { useEffect, useMemo, useState } from "react";

/* ─────────────── CONFIG ─────────────── */
const DEFAULT_FILE_ID = "16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o";
const GS_FILE_ID =
  (import.meta?.env?.VITE_GS_FILE_ID || "").trim() || DEFAULT_FILE_ID;

const TAB_CATEGORIES = "Categories";
const TAB_QUESTIONS = "Questions";
const TAB_STUDY = "Study Material";
const TAB_EXAMS = "Exam Notifications";
const BATTLE_QUESTION_COUNT = 20;

/* ─────────────── Utils ─────────────── */
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

  let cols = (json.table?.cols || []).map((c, i) =>
    lower(c?.label || c?.id || `col${i + 1}`)
  );
  let rows = (json.table?.rows || []).map((r) =>
    (r.c || []).map((c) => ((c && c.v) != null ? String(c.v) : ""))
  );
  const looksGeneric = cols.every(
    (c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c)
  );
  const headerish = (rows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual|question|opt|correct|title|url|desc|date)/i.test(
      String(v || "")
    )
  );
  if (looksGeneric && headerish) {
    cols = (rows[0] || []).map((v, i) => lower(v || `col${i + 1}`));
    rows = rows.slice(1);
  }
  return { cols, rows };
}

function findHeaderIndex(cols, cand, fallback) {
  const cands = cand.map(strip),
    coln = cols.map(strip);
  for (const c of cands) {
    const i = coln.findIndex((cn) => cn === c || cn.includes(c));
    if (i !== -1) return i;
  }
  return typeof fallback === "number" ? fallback : -1;
}

function mapQuestionRows(cols, rows, defaultCategory = "General") {
  const idxQ = findHeaderIndex(cols, ["question", "q", "title"]);
  const idxAns = findHeaderIndex(cols, ["answer", "ans", "correcttext"]);
  const idxA = findHeaderIndex(cols, ["optA", "a", "option a", "1"]);
  const idxB = findHeaderIndex(cols, ["optB", "b", "option b", "2"]);
  const idxC = findHeaderIndex(cols, ["optC", "c", "option c", "3"]);
  const idxD = findHeaderIndex(cols, ["optD", "d", "option d", "4"]);
  const idxCor = findHeaderIndex(
    cols,
    ["correct", "answerindex", "correct option"],
    -1
  );
  const idxCat = findHeaderIndex(cols, ["category", "subject", "topic", "cat"], -1);

  const out = [];
  for (const r of rows) {
    const text = norm(r[idxQ]);
    const options = [r[idxA], r[idxB], r[idxC], r[idxD]].map(norm).filter(Boolean);
    if (!text || options.length < 2) continue;

    const ansText = norm(r[idxAns]);
    const corRaw = norm(r[idxCor]);

    let answerIndex = -1;
    if (corRaw) {
      const v = corRaw.toUpperCase();
      if ("ABCD".includes(v)) answerIndex = v.charCodeAt(0) - 65;
      else {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1 && n <= options.length) answerIndex = n - 1;
      }
    }
    if (answerIndex < 0 && ansText) {
      const i = options.findIndex((o) => strip(o) === strip(ansText));
      if (i >= 0) answerIndex = i;
    }
    if (answerIndex < 0) answerIndex = 0;
    out.push({
      cat: idxCat >= 0 ? norm(r[idxCat]) || defaultCategory : defaultCategory,
      text,
      options,
      answerIndex,
    });
  }
  return out;
}

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
  items.sort((a, b) => {
    const da = Date.parse(a.date || "");
    const db = Date.parse(b.date || "");
    if (Number.isFinite(db) && Number.isFinite(da)) return db - da;
    return (b.date || "").localeCompare(a.date || "");
  });
  return items;
}

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

/* Loaders */
async function loadQuestionBank() {
  try {
    const { cols, rows } = await gvizFetch({ sheetName: TAB_QUESTIONS });
    if (rows.length) {
      const items = mapQuestionRows(cols, rows);
      const bank = toBank(items);
      if (Object.keys(bank).length) return bank;
    }
  } catch {}
  const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_CATEGORIES });
  let cCols = cCols0,
    cRows = cRows0;
  const generic =
    cCols.every((c) => c === "" || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c)) &&
    (cRows[0] || []).length > 0;
  const headerish = (cRows[0] || []).some((v) =>
    /(name|display|tab|sheet|actual)/i.test(String(v || ""))
  );
  if (generic && headerish) {
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
      console.warn("Failed tab", m.tab, e);
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
    console.warn("List load failed", tabName, e);
    return [];
  }
}

/* UI primitives */
const Card = ({ children, className = "" }) => (
  <div className={cx("rounded-2xl bg-white shadow-sm border border-emerald-100", className)}>
    {children}
  </div>
);

function LinearProgress({ value, max }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 md:h-2 bg-emerald-100 rounded-full overflow-hidden">
      <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const R = 18,
    C = 2 * Math.PI * R,
    p = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  return (
    <div className="relative w-10 h-10 md:w-11 md:h-11">
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
      <div className="absolute inset-0 grid place-items-center text-[10px] md:text-xs font-semibold text-emerald-700">
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
        "w-full text-left rounded-xl border-2 px-4 py-3 md:px-5 md:py-3.5 mb-3 transition-all bg-white/80",
        feedbackClass
      )}
      aria-pressed={isSelected ? "true" : "false"}
    >
      <span className="inline-flex items-center gap-3">
        <span
          className={cx(
            "grid place-items-center w-6 h-6 rounded-full text-xs font-semibold md:w-7 md:h-7 md:text-sm",
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
        <span className={cx("text-[15px] md:text-[16px]", textColor)}>{label}</span>
      </span>
    </button>
  );
}

/* Splash */
function Splash() {
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
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4" />
        <div className="text-emerald-700 font-semibold text-[15px] md:text-[17px] transition-opacity duration-300">
          {messages[i]}
        </div>
        <div className="w-56 md:w-72 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4">
          <div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* Avatars */
function CartoonAvatar() {
  return (
    <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-emerald-200 grid place-items-center overflow-hidden" aria-hidden="true">
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
      className="w-10 h-10 md:w-11 md:h-11 rounded-full grid place-items-center text-sm font-bold text-white"
      style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }}
      title={name}
    >
      {initials || "OP"}
    </div>
  );
}

/* Battle assets */
const MALAYALI_NAMES = [
  "Anand","Akhil","Ajith","Anu","Amala","Hari","Gopika","Sreenath","Nimisha","Midhun","Varun",
  "Fahad","Mamta","Dulquer","Nazriya","Tovino","Keerthi","Surya","Meera","Aswin","Neha","Anjana",
  "Athul","Devika","Mohan","Sreejith","Athira","Jishnu","Remya","Arjun","Anoop","Sarath","Abhiram",
  "Nikhil","Sneha","Gayathri","Adithya","Aparna"
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

/* Footer links (Privacy / Terms) */
function FooterLinks({ toPrivacy, toTerms }) {
  return (
    <div className="mt-8 text-center text-[12px] md:text-[13px] text-slate-500">
      <button onClick={toPrivacy} className="underline hover:text-emerald-700">Privacy Policy</button>
      <span className="mx-2">•</span>
      <button onClick={toTerms} className="underline hover:text-emerald-700">Terms &amp; Conditions</button>
    </div>
  );
}

/* Views (Home, AllCategories, BattleSearch, Quiz, ListPage, Result) — unchanged UI except footer where noted) */
/* … (unchanged large blocks for Home/AllCategories/BattleSearch/Quiz/ListPage/Result from your latest working file) … */
/* To keep this message shorter, those sections are exactly the same as the last version I gave you, with ONE addition:
   - At the bottom of Home and AllCategories and each ListPage, we render <FooterLinks …/> with callbacks that set the view. */

/*  ►► Replace just the RETURN blocks for Home, AllCategories and ListPage to include <FooterLinks/>  ◄◄  */

/* HOME (return tail) */
      {/* Recent … (existing) */}
      {recent.length>0 && (/* existing recent grid here */)}

      {/* Footer links */}
      <FooterLinks toPrivacy={() => window.location.hash = "#/privacy"}
                   toTerms={() => window.location.hash = "#/terms"} />
    </div>
  </div>
);

/* ALL CATEGORIES (bottom after grid) */
      {/* grid … existing */}
      <FooterLinks toPrivacy={() => window.location.hash = "#/privacy"}
                   toTerms={() => window.location.hash = "#/terms"} />
    </div>
  </div>
</div>
);

/* LIST PAGE (bottom after list) */
        {/* list … existing */}
        <FooterLinks toPrivacy={() => window.location.hash = "#/privacy"}
                     toTerms={() => window.location.hash = "#/terms"} />
      </div>
    </div>
  </div>
);

/* ─────────────── Static pages ─────────────── */
function PageShell({ title, children, onBack }) {
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full mx-auto max-w-3xl px-4 md:px-6 pb-20 pt-6">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="text-slate-600">←</button>
          <h1 className="text-[16px] md:text-[20px] font-semibold">{title}</h1>
          <span className="w-4" />
        </div>
        <Card className="p-5 md:p-7 prose prose-sm md:prose-base max-w-none">
          {children}
        </Card>
        <FooterLinks toPrivacy={() => (window.location.hash = "#/privacy")}
                     toTerms={() => (window.location.hash = "#/terms")} />
      </div>
    </div>
  );
}

function PrivacyPage({ onBack }) {
  return (
    <PageShell title="Privacy Policy" onBack={onBack}>
      <p><strong>Last updated:</strong> {new Date().toLocaleDateString()}</p>
      <p>
        PSC Guru (“we”, “our”, “us”) respects your privacy. This app does not
        require a login and stores minimal data in your browser (for example,
        your recent categories and quiz progress) via <em>localStorage</em>.
      </p>
      <h2>Information We Collect</h2>
      <ul>
        <li>Anonymous usage data (e.g., page views, category clicks) if analytics are enabled.</li>
        <li>Local data on your device for recent activity and preferences.</li>
      </ul>
      <h2>Use of Information</h2>
      <p>We use the above solely to improve quiz experience and performance.</p>
      <h2>Third-Party Content</h2>
      <p>Some pages link to external resources (study material / notifications). Those sites have their own policies.</p>
      <h2>Cookies</h2>
      <p>We may use cookies only for essential site functionality.</p>
      <h2>Your Choices</h2>
      <ul>
        <li>You can clear your browser data to remove locally stored items.</li>
        <li>You may opt out of any non-essential analytics if added in future.</li>
      </ul>
      <h2>Contact</h2>
      <p>Questions? Email us at <a href="mailto:hello@yourdomain.com">hello@yourdomain.com</a>.</p>
    </PageShell>
  );
}

function TermsPage({ onBack }) {
  return (
    <PageShell title="Terms &amp; Conditions" onBack={onBack}>
      <p><strong>Last updated:</strong> {new Date().toLocaleDateString()}</p>
      <h2>Acceptance of Terms</h2>
      <p>
        By using PSC Guru, you agree to these Terms. If you do not agree, please stop using the app.
      </p>
      <h2>Use License</h2>
      <p>
        This app is for personal, non-commercial use. You agree not to copy, modify, reverse engineer,
        or resell the content without permission.
      </p>
      <h2>Content & Accuracy</h2>
      <p>
        Questions are sourced from Google Sheets and other materials. We aim for accuracy but do not
        guarantee completeness. Use at your own discretion.
      </p>
      <h2>Limitation of Liability</h2>
      <p>
        We are not liable for any losses arising from use of this app.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these Terms at any time by posting a new version in the app.
      </p>
      <h2>Governing Law</h2>
      <p>Laws of India (Kerala jurisdiction) apply, unless otherwise required by local law.</p>
      <h2>Contact</h2>
      <p>For any issues, email <a href="mailto:hello@yourdomain.com">hello@yourdomain.com</a>.</p>
    </PageShell>
  );
}

/* ─────────────── App + hash routing ─────────────── */
export default function App() {
  const [view, setView] = useState("home");
  const [category, setCategory] = useState("");
  const [bank, setBank] = useState({});
  const [result, setResult] = useState({ score: 0, total: 0, history: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [battleQuestions, setBattleQuestions] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [battleMode, setBattleMode] = useState(false);

  const [studyItems, setStudyItems] = useState([]);
  const [examItems, setExamItems] = useState([]);

  const [recent, setRecent] = useState([]);
  const [currentCategory, setCurrentCategory] = useState("");

  /* load recent */
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("recent_cats") || "[]");
    if (Array.isArray(saved)) setRecent(saved.slice(0, 2));
  }, []);
  function pushRecent(cat) {
    if (!cat) return;
    setRecent((prev) => {
      const next = [cat, ...prev.filter((c) => c !== cat)].slice(0, 2);
      localStorage.setItem("recent_cats", JSON.stringify(next));
      return next;
    });
  }

  /* load data */
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

  /* simple hash router (SEO/shareable URLs) */
  useEffect(() => {
    const parseHash = () => {
      const h = (window.location.hash || "#/").replace(/^#\//, "");
      const [route, ...rest] = h.split("/");
      if (!route || route === "") return setView("home");
      if (route === "categories") return setView("categories");
      if (route === "study") return setView("study");
      if (route === "exams") return setView("exams");
      if (route === "privacy") return setView("privacy");
      if (route === "terms") return setView("terms");
      if (route === "quiz") {
        const cat = decodeURIComponent(rest.join("/"));
        if (cat) {
          setCategory(cat);
          setBattleMode(false);
          setBattleQuestions(null);
          setOpponent(null);
          return setView("quiz");
        }
      }
      if (route === "battle") return setView("battle_search");
      setView("home");
    };
    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  const navigate = (hash) => {
    window.location.hash = hash;
  };

  const startCategory = (c) => {
    setCategory(c);
    setCurrentCategory(c);
    setBattleMode(false);
    setBattleQuestions(null);
    setOpponent(null);
    navigate(`#/quiz/${encodeURIComponent(c)}`);
  };

  const handleStartBattle = () => {
    setBattleMode(true);
    setBattleQuestions(null);
    setOpponent(null);
    navigate("#/battle");
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
    setView("quiz"); // stay on same URL
  };

  if (loading) return <Splash />;
  if (err)
    return (
      <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
        <div className="max-w-sm md:max-w-md px-4">
          <Card className="p-4">
            <div className="text-[15px] md:text-[16px] font-semibold">
              Couldn't load Google Sheet
            </div>
            <p className="text-sm text-slate-600 mt-2">{err}</p>
          </Card>
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh">
      {view === "home" && (
        <Home
          bank={bank}
          onStartCategory={startCategory}
          onSeeAll={() => navigate("#/categories")}
          onStartBattle={handleStartBattle}
          studyCount={studyItems.length}
          examCount={examItems.length}
          openStudy={() => navigate("#/study")}
          openExams={() => navigate("#/exams")}
          recent={recent}
        />
      )}
      {view === "categories" && (
        <AllCategories
          bank={bank}
          onStartCategory={startCategory}
          onBack={() => navigate("#/")}
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
            if (!r.aborted && !r.battleMode && currentCategory) pushRecent(currentCategory);
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
          onBack={() => navigate("#/")}
        />
      )}
      {view === "study" && (
        <ListPage title="Study Material" items={studyItems} onBack={() => navigate("#/")} />
      )}
      {view === "exams" && (
        <ListPage title="Exam Notifications" items={examItems} onBack={() => navigate("#/")} />
      )}
      {view === "privacy" && <PrivacyPage onBack={() => navigate("#/")} />}
      {view === "terms" && <TermsPage onBack={() => navigate("#/")} />}
    </div>
  );
}
