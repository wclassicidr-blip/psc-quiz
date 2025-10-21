// App.jsx — PSC Guru (Tea Green theme)
// Adds: Mock Exams (timer + section cutoffs), OMR-style review,
// Daily goals & streaks, XP/levels, badges, Battle mode, and NEW: Random Quick Quiz (choose # of questions).
// Home shows TWO sections — Topic Categories (from "Categories") & Exam Categories (from "EXAM CAT").
// NOTE: Difficulty Ladder, Papers/Topic Packs, and Revise Mistakes are REMOVED per request.

import { useEffect, useMemo, useState } from 'react';

/* ========================= CONFIG ========================= */
const DEFAULT_FILE_ID = '16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o';
const GS_FILE_ID = (import.meta?.env?.VITE_GS_FILE_ID || '').trim() || DEFAULT_FILE_ID;

const TAB_CATEGORIES = 'Categories';
const TAB_EXAM_CATS = 'EXAM CAT';
const TAB_QUESTIONS = 'Questions';
const TAB_STUDY = 'Study Material';
const TAB_EXAMS = 'Exam Notifications';

const BATTLE_QUESTION_COUNT = 20;
const QUICK_DEFAULT_COUNT = 10;
const QUICK_MIN = 5;
const QUICK_MAX = 50;

/* ========================= UTILS ========================= */
const cx = (...xs) => xs.filter(Boolean).join(' ');
const norm = (s) => String(s ?? '').trim();
const lower = (s) => norm(s).toLowerCase();
const strip = (s) => lower(s).replace(/[^a-z0-9]+/g, '');
// Avoid \u escapes to prevent TS parser issues. Use literal Unicode dashes.
const normalizeSheetName = (s) => norm(s).replace(/[‒–—―−]/g, '-').replace(/\s+/g, ' ');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const rand = (n) => Math.floor(Math.random() * n);
const sampleOne = (arr) => (arr.length ? arr[rand(arr.length)] : undefined);
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sampleMany(arr, n) { return shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length))); }

function parseGViz(text) {
  const t = String(text || '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error('GViz parse error');
}

async function gvizFetch({ sheetName, gid, tq = 'select *' }) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`);
  if (gid) url.searchParams.set('gid', gid); else url.searchParams.set('sheet', sheetName);
  url.searchParams.set('tq', tq);
  url.searchParams.set('tqx', 'out:json');
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GViz HTTP ${res.status}`);
  const raw = await res.text();
  const json = parseGViz(raw);
  let cols = (json.table?.cols || []).map((c, i) => lower(c?.label || c?.id || `col${i + 1}`));
  let rows = (json.table?.rows || []).map((r) => (r.c || []).map((c) => ((c && c.v) != null ? String(c.v) : '')));
  const looksGeneric = cols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c));
  const headerish = (rows[0] || []).some((v) => /(name|display|tab|sheet|actual|question|opt|correct|title|url|desc|date|categories|duration|year|questions)/i.test(String(v || '')));
  if (looksGeneric && headerish) { cols = (rows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); rows = rows.slice(1); }
  return { cols, rows };
}

function findHeaderIndex(cols, candidates, fallbackIndex) {
  const candNorms = candidates.map((c) => strip(c));
  const colNorms = cols.map((c) => strip(c));
  for (const c of candNorms) {
    const i = colNorms.findIndex((cn) => cn === c || cn.includes(c));
    if (i !== -1) return i;
  }
  return typeof fallbackIndex === 'number' ? fallbackIndex : -1;
}

function mapQuestionRows(cols, rows, defaultCategory = 'General') {
  const idxQ = findHeaderIndex(cols, ['question', 'q', 'title']);
  const idxAns = findHeaderIndex(cols, ['answer', 'ans', 'correcttext']);
  const idxA = findHeaderIndex(cols, ['opta', 'a', 'option a', '1']);
  const idxB = findHeaderIndex(cols, ['optb', 'b', 'option b', '2']);
  const idxC = findHeaderIndex(cols, ['optc', 'c', 'option c', '3']);
  const idxD = findHeaderIndex(cols, ['optd', 'd', 'option d', '4']);
  const idxCor = findHeaderIndex(cols, ['correct', 'answerindex', 'correct option'], -1);
  const idxCat = findHeaderIndex(cols, ['category', 'subject', 'topic', 'cat'], -1);
  const idxDiff = findHeaderIndex(cols, ['difficulty', 'level'], -1);

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
      if ('ABCD'.includes(v)) answerIndex = v.charCodeAt(0) - 65; else {
        const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= options.length) answerIndex = n - 1;
      }
    }
    if (answerIndex < 0 && answerText) {
      const i = options.findIndex((o) => strip(o) === strip(answerText));
      if (i >= 0) answerIndex = i;
    }
    if (answerIndex < 0) answerIndex = 0;

    let diff = lower(r[idxDiff]) || '';
    if (!['easy', 'medium', 'hard'].includes(diff)) {
      const L = text.length;
      diff = L < 60 ? 'easy' : L < 120 ? 'medium' : 'hard';
    }

    items.push({
      cat: idxCat >= 0 ? norm(r[idxCat]) || defaultCategory : defaultCategory,
      text,
      options,
      answerIndex,
      difficulty: diff,
    });
  }
  return items;
}

function mapListRows(cols, rows) {
  const idxTitle = findHeaderIndex(cols, ['title', 'name', 'heading'], 0);
  const idxUrl = findHeaderIndex(cols, ['url', 'link', 'href'], 1);
  const idxDesc = findHeaderIndex(cols, ['desc', 'description', 'about', 'categories'], 2);
  const idxDate = findHeaderIndex(cols, ['date', 'when', 'year'], 3);
  const idxDur = findHeaderIndex(cols, ['duration', 'time'], -1);
  const idxQn = findHeaderIndex(cols, ['questions', 'count', 'total'], -1);

  const items = [];
  for (const r of rows) {
    const title = norm(r[idxTitle]);
    if (!title) continue;
    items.push({
      title,
      url: norm(r[idxUrl]),
      desc: norm(r[idxDesc]),
      date: norm(r[idxDate]),
      duration: norm(r[idxDur]),
      questions: norm(r[idxQn]),
    });
  }
  return items;
}

function shuffleWithIndex(arr, correctIdx) {
  const idxs = arr.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idxs[i], idxs[j]] = [idxs[j], idxs[i]]; }
  const newOptions = idxs.map((i) => arr[i]);
  const newCorrect = idxs.indexOf(correctIdx);
  return { newOptions, newCorrect };
}

function toBank(items) {
  const bank = {};
  for (const it of items) {
    const { newOptions, newCorrect } = shuffleWithIndex(it.options, it.answerIndex);
    bank[it.cat] ??= [];
    bank[it.cat].push({ id: bank[it.cat].length + 1, text: it.text, options: newOptions, answerIndex: newCorrect, difficulty: it.difficulty });
  }
  return bank;
}

function flattenBank(bank) { const out = []; for (const [cat, list] of Object.entries(bank)) for (const q of list) out.push({ ...q, cat }); return out; }
function mergeBanks(a, b){ const out = {...a}; for(const [k,v] of Object.entries(b||{})){ out[k] = (out[k]||[]).concat(v); } return out; }

/* ========= Avatars / UI ========= */
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
  const initials = useMemo(() => name.split(' ').map((w) => w[0]?.toUpperCase()).slice(0, 2).join(''), [name]);
  let hue = 0; for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div className="w-10 h-10 md:w-11 md:h-11 rounded-full grid place-items-center text-sm font-bold text-white" style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }} title={name}>
      {initials || 'OP'}
    </div>
  );
}

const MALAYALI_NAMES = ['Anand','Akhil','Ajith','Anu','Amala','Hari','Gopika','Sreenath','Nimisha','Midhun','Varun','Fahad','Mamta','Dulquer','Nazriya','Tovino','Keerthi','Surya','Meera','Aswin','Neha','Anjana','Athul','Devika','Mohan','Sreejith','Athira','Jishnu','Remya','Arjun','Anoop','Sarath','Abhiram','Nikhil','Sneha','Gayathri','Adithya','Aparna'];
const KERALA_PLACES = ['Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur','Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod','Kochi','Muvattupuzha','Kattappana','Pala','Chalakudy','Kunnamkulam','Nedumangad','Neyyattinkara','Attingal','Kayamkulam','Tirur','Perinthalmanna','Payyannur','Taliparamba','Kanhangad','Varkala','Adoor','Changanassery','Irinjalakuda','Thodupuzha'];
function randomOpponent() { return { name: sampleOne(MALAYALI_NAMES) + ' ' + sampleOne(['K','S','N','M','P','V']), place: sampleOne(KERALA_PLACES) }; }

const Card = ({ children, className = '' }) => (
  <div className={cx('rounded-2xl bg-white shadow-sm border border-emerald-100', className)}>{children}</div>
);

function LinearProgress({ value, max }) { const pct = Math.min(100, Math.max(0, (value / max) * 100)); return (<div className="w-full h-1.5 md:h-2 bg-emerald-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${pct}%`} } /></div>); }

function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  return (
    <div className="relative w-10 h-10 md:w-11 md:h-11">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-100" strokeWidth="6" />
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-600 transition-[stroke-dasharray] duration-200" strokeLinecap="round" strokeWidth="6" strokeDasharray={`${C * p} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] md:text-xs font-semibold text-emerald-700">0{Math.max(0, secondsLeft).toString().padStart(2, '0')}</div>
    </div>
  );
}

function OptionButton({ label, letter, disabled, isSelected, showFeedback, isCorrect, isWrong }) {
  const feedbackClass = showFeedback ? (isCorrect ? 'border-green-500 bg-green-50' : isWrong ? 'border-red-500 bg-red-50' : 'border-transparent') : isSelected ? 'border-emerald-600 ring-2 ring-emerald-200' : 'border-transparent hover:border-emerald-200';
  const textColor = showFeedback ? (isCorrect ? 'text-green-800' : isWrong ? 'text-red-700' : 'text-slate-800') : 'text-slate-800';
  return (
    <button disabled={disabled} className={cx('w-full text-left rounded-xl border-2 px-4 py-3 md:px-5 md:py-3.5 mb-3 transition-all bg-white/80', feedbackClass)} aria-pressed={isSelected ? 'true' : 'false'}>
      <span className="inline-flex items-center gap-3">
        <span className={cx('grid place-items-center w-6 h-6 rounded-full text-xs font-semibold md:w-7 md:h-7 md:text-sm', showFeedback ? (isCorrect ? 'bg-green-100 text-green-700' : isWrong ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700') : 'bg-emerald-100 text-emerald-700')}>{letter}</span>
        <span className={cx('text-[15px] md:text-[16px]', textColor)}>{label}</span>
      </span>
    </button>
  );
}

function Splash() {
  const messages = ['Personalizing your questions…','Finding new online friends…','Updating new questions…','Sharpening brain cells…','Warming up the quiz engine…','Checking your lucky stars…'];
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % messages.length), 1400); return () => clearInterval(id); }, []);
  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4" />
        <div className="text-emerald-700 font-semibold text-[15px] md:text-[17px] transition-opacity duration-300">{messages[i]}</div>
        <div className="w-56 md:w-72 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4"><div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse" /></div>
      </div>
    </div>
  );
}

/* ========= Progress / XP / Streaks ========= */
const XP_KEY = 'xp_total';
const LVL_KEY = 'xp_level';
const BADGE_KEY = 'xp_badges';
const STREAK_KEY = 'streak_count';
const LASTDAY_KEY = 'last_played_day';
const DAILY_TARGET_KEY = 'daily_target';
const DAILY_DONE_KEY = 'daily_done_'; // + yyyymmdd

function todayKey() { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}${m}${dd}`; }
function getNum(key, def=0){ const v = Number(localStorage.getItem(key)); return Number.isFinite(v)? v: def; }
function setNum(key, v){ localStorage.setItem(key, String(v)); }
function addBadge(name){ const arr = JSON.parse(localStorage.getItem(BADGE_KEY) || '[]'); if(!arr.includes(name)){ arr.push(name); localStorage.setItem(BADGE_KEY, JSON.stringify(arr)); } }
function getBadges(){ return JSON.parse(localStorage.getItem(BADGE_KEY) || '[]'); }
function addXP(n){ const cur = getNum(XP_KEY, 0) + n; setNum(XP_KEY, cur); const level = Math.floor(cur/200)+1; setNum(LVL_KEY, level); return { xp: cur, level }; }
function bumpDailyDone(n){ const key = DAILY_DONE_KEY+todayKey(); setNum(key, getNum(key,0)+n); }
function getDaily(){ const target = getNum(DAILY_TARGET_KEY, 20); const done = getNum(DAILY_DONE_KEY+todayKey(),0); return {target, done}; }
function setDailyTarget(n){ setNum(DAILY_TARGET_KEY, clamp(n,5,200)); }
function updateStreakOnPlay(){ const last = localStorage.getItem(LASTDAY_KEY)||''; const today = todayKey(); if(last===today) return getNum(STREAK_KEY,0); const y = Number(last.slice(0,4)), m = Number(last.slice(4,6))-1, d = Number(last.slice(6,8)); const was = y? new Date(y,m,d): null; const now = new Date(); const diffDays = was? Math.round((now - was)/(24*3600*1000)): null; let streak = getNum(STREAK_KEY,0); if(diffDays===1) streak += 1; else streak = 1; setNum(STREAK_KEY, streak); localStorage.setItem(LASTDAY_KEY, today); if(streak===7) addBadge('7-Day Streak'); if(streak===30) addBadge('30-Day Streak'); return streak; }

/* ========= Data loaders ========= */
async function loadTopicBank() {
  try {
    const { cols, rows } = await gvizFetch({ sheetName: TAB_QUESTIONS });
    if (rows.length) { const items = mapQuestionRows(cols, rows); const bank = toBank(items); if (Object.keys(bank).length) return bank; }
  } catch {}
  const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_CATEGORIES });
  let cCols = cCols0, cRows = cRows0;
  const generic = cCols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c));
  const firstLooksHeader = (cRows[0] || []).some((v) => /(name|display|tab|sheet|actual)/i.test(String(v || '')));
  if (generic && firstLooksHeader) { cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); cRows = cRows.slice(1); }
  let idxDisplay = findHeaderIndex(cCols, ['name (display)', 'display', 'title', 'name'], -1);
  let idxTab = findHeaderIndex(cCols, ['text (actual tab name)', 'actual tab name', 'tab', 'sheet', 'sheetname'], -1);
  if (idxDisplay === -1 || idxTab === -1) { const idIdx = cCols.findIndex((x) => strip(x) === 'id'); const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx); if (idxDisplay === -1 && indices.length) idxDisplay = indices[0]; if (idxTab === -1 && indices.length > 1) idxTab = indices[1]; }
  if (idxDisplay === -1) idxDisplay = 1; if (idxTab === -1) idxTab = 2;
  const mappings = cRows.map((r) => ({ display: normalizeSheetName(r[idxDisplay]), tab: normalizeSheetName(r[idxTab]) })).filter((m) => m.display && m.tab);
  const bank = {};
  for (const m of mappings) {
    try {
      const isGid = /^\d+$/.test(m.tab);
      const { cols, rows } = await gvizFetch({ sheetName: isGid ? undefined : m.tab, gid: isGid ? m.tab : undefined });
      const items = mapQuestionRows(cols, rows, m.display);
      bank[m.display] = toBank(items)[m.display] || [];
    } catch (e) { console.warn('Failed tab (topic)', m.tab, e); bank[m.display] = []; }
  }
  return bank;
}

async function loadExamBank(){
  try{
    const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_EXAM_CATS });
    let cCols = cCols0, cRows = cRows0;
    const generic = cCols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c));
    const firstLooksHeader = (cRows[0] || []).some((v) => /(name|display|tab|sheet|actual)/i.test(String(v || '')));
    if (generic && firstLooksHeader) { cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); cRows = cRows.slice(1); }
    let idxDisplay = findHeaderIndex(cCols, ['name (display)', 'display', 'title', 'name'], -1);
    let idxTab = findHeaderIndex(cCols, ['text (actual tab name)', 'actual tab name', 'tab', 'sheet', 'sheetname'], -1);
    if (idxDisplay === -1 || idxTab === -1) { const idIdx = cCols.findIndex((x) => strip(x) === 'id'); const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx); if (idxDisplay === -1 && indices.length) idxDisplay = indices[0]; if (idxTab === -1 && indices.length > 1) idxTab = indices[1]; }
    if (idxDisplay === -1) idxDisplay = 1; if (idxTab === -1) idxTab = 2;
    const mappings = cRows.map((r) => ({ display: normalizeSheetName(r[idxDisplay]), tab: normalizeSheetName(r[idxTab]) })).filter((m) => m.display && m.tab);
    const bank = {};
    for(const m of mappings){
      try{
        const isGid = /^\d+$/.test(m.tab);
        const { cols, rows } = await gvizFetch({ sheetName: isGid ? undefined : m.tab, gid: isGid ? m.tab : undefined });
        const items = mapQuestionRows(cols, rows, m.display);
        bank[m.display] = toBank(items)[m.display] || [];
      }catch(e){ console.warn('Failed tab (exam)', m.tab, e); bank[m.display] = []; }
    }
    return bank;
  }catch(e){ console.warn('Exam bank load failed', e); return {}; }
}

async function loadList(tabName) { try { const { cols, rows } = await gvizFetch({ sheetName: tabName }); return mapListRows(cols, rows); } catch (e) { console.warn('List load failed', tabName, e); return []; } }

/* ========= Views ========= */
function Home({ topicBank, examBank, onStartTopic, onStartExam, onSeeAllTopics, onSeeAllExams, onStartBattle, onQuick, openStudy, openExams, recent, toMock, toProfile }) {
  const topicCats = Object.keys(topicBank);
  const examCats = Object.keys(examBank);
  const [homeQ, setHomeQ] = useState('');
  const filteredTopics = topicCats.filter((c) => c.toLowerCase().includes(homeQ.toLowerCase()));
  const filteredExams = examCats.filter((c) => c.toLowerCase().includes(homeQ.toLowerCase()));
  const previewTopics = filteredTopics.slice(0, 6);
  const previewExams = filteredExams.slice(0, 6);
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6 lg:px-8 pb-28 pt-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 md:gap-4">
            <CartoonAvatar />
            <div>
              <p className="text-[15px] md:text-[17px] font-semibold text-slate-900">PSC Guru</p>
              <p className="text-[13px] md:text-[14px] text-slate-600">No1 PSC Learning App</p>
            </div>
          </div>
          <button onClick={toProfile} className="text-[13px] md:text-[14px] text-emerald-700 underline">Profile & Goals</button>
        </div>

        <div className="mb-5 max-w-2xl sticky top-0 z-20">
          <div className="flex items-center gap-2 bg-white/80 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5">
            <span className="text-slate-400">🔎</span>
            <input className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400" placeholder="Search categories" value={homeQ} onChange={(e) => setHomeQ(e.target.value)} />
          </div>
        </div>

        {/* Top quick actions */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4 bg-gradient-to-br from-lime-400 to-emerald-600 text-white">
            <div className="flex items-center justify-between h-full">
              <div>
                <p className="text-base font-semibold">Mock Exam</p>
                <p className="text-sm opacity-90">Timer + sections + OMR review</p>
              </div>
              <button onClick={toMock} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Start</button>
            </div>
          </Card>
          <Card className="p-4 bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 text-white">
            <div className="flex items-center justify-between h-full">
              <div>
                <p className="font-semibold">Online Battle</p>
                <p className="text-sm opacity-90">Match with an opponent</p>
              </div>
              <button onClick={onStartBattle} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Find</button>
            </div>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-teal-400 to-emerald-600 text-white">
            <div className="flex items-center justify-between h-full">
              <div>
                <p className="font-semibold">Random Quick Quiz</p>
                <p className="text-sm opacity-90">Pick # of questions</p>
              </div>
              <button onClick={onQuick} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Setup</button>
            </div>
          </Card>
        </div>

        {/* Topic Categories */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[15px] md:text-[17px] font-semibold">Topic Categories</div>
            <button onClick={onSeeAllTopics} className="text-[13px] md:text-[14px] text-emerald-700">View all</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {previewTopics.map((c) => (
              <button key={c} onClick={() => onStartTopic(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">＋</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500">{(topicBank[c] || []).length} questions</div>
              </button>
            ))}
            {previewTopics.length === 0 && <div className="col-span-full text-center text-sm text-slate-600">No topics match “{homeQ}”.</div>}
          </div>
        </div>

        {/* Exam Categories */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[15px] md:text-[17px] font-semibold">Exam Categories</div>
            <button onClick={onSeeAllExams} className="text-[13px] md:text-[14px] text-emerald-700">View all</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {previewExams.map((c) => (
              <button key={c} onClick={() => onStartExam(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">🎓</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500">{(examBank[c] || []).length} questions</div>
              </button>
            ))}
            {previewExams.length === 0 && <div className="col-span-full text-center text-sm text-slate-600">No exams match “{homeQ}”.</div>}
          </div>
        </div>

        {/* Tools */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-3">
          <button onClick={openStudy} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📚</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">Study Material</div>
            <div className="text-[12px] text-slate-500">Curated links</div>
          </button>
          <button onClick={openExams} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📢</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">Exam Notifications</div>
            <div className="text-[12px] text-slate-500">Latest alerts</div>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 text-[15px] md:text-[17px] font-semibold text-slate-900">Recent</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {recent.map((item, idx) => {
                const kind = typeof item === 'string' ? (topicBank[item] ? 'topic' : 'exam') : item.kind;
                const name = typeof item === 'string' ? item : item.name;
                const count = kind === 'exam' ? (examBank[name] || []).length : (topicBank[name] || []).length;
                const onClick = kind === 'exam' ? () => onStartExam(name) : () => onStartTopic(name);
                return (
                  <button key={idx} onClick={onClick} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">🕘</div>
                      <div>
                        <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{name}</div>
                        <div className="text-[11px] md:text-[12px] text-slate-500">{count} questions • {kind==='exam'?'Exam':'Topic'}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AllCategories({ title, bank, onStart, onBack }) {
  const [q, setQ] = useState('');
  const cats = Object.keys(bank).filter((n) => n.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full mx-auto max-w-6xl pb-20">
        <div className="sticky top-0 z-30 -mx-4 md:mx-0 px-4 md:px-6 pt-4 pb-3 bg-[#eefbe7]/95 backdrop-blur border-b border-emerald-100 flex items-center justify-between">
          <button onClick={onBack} className="text-slate-600">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold">{title}</div>
          <span className="w-4" />
        </div>
        <div className="px-4 md:px-6 pt-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
            <div className="col-span-full max-w-xl mb-2">
              <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5 shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400 bg-transparent" autoFocus />
              </div>
            </div>
            {cats.map((c) => (
              <button key={c} onClick={() => onStart(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 transition">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">＋</div>
                <div className="text-[12px] md:text-[13px] font-medium text-slate-800 text-left">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500 text-left">{(bank[c] || []).length} questions</div>
              </button>
            ))}
            {cats.length === 0 && <Card className="p-4 text-center text-sm text-slate-600 col-span-full">No items found.</Card>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BattleSearch({ onMatched }) {
  useEffect(() => { const id = setTimeout(() => { onMatched(); }, 3000); return () => clearTimeout(id); }, [onMatched]);
  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm md:max-w-md px-4 pt-16 text-center">
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
        <div className="text-emerald-800 font-semibold text-lg mb-1">Finding an opponent…</div>
        <div className="text-slate-600 text-sm">Looking for players online</div>
      </div>
    </div>
  );
}

/* ========= Quick Setup (random N questions) ========= */
function QuickSetup({ bank, onStart, onBack }){
  const [count, setCount] = useState(QUICK_DEFAULT_COUNT);
  const total = useMemo(()=> flattenBank(bank).length, [bank]);
  const disabled = total === 0;
  function start(){
    const flat = flattenBank(bank);
    const picked = sampleMany(flat, clamp(count, QUICK_MIN, QUICK_MAX)).map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat }));
    onStart(picked);
  }
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-16 pt-6">
        <div className="flex items-center justify-between mb-3"><button onClick={onBack} className="text-slate-600">←</button><div className="text-[15px] md:text-[17px] font-semibold">Random Quick Quiz</div><span className="w-4"/></div>
        <Card className="p-4">
          <div className="text-sm text-slate-600">Pick how many questions you want (available: {total}).</div>
          <div className="grid md:grid-cols-12 gap-3 mt-3 items-center">
            <div className="md:col-span-8">
              <input type="range" min={QUICK_MIN} max={Math.min(QUICK_MAX, Math.max(QUICK_MIN,total))} value={count} onChange={(e)=> setCount(Number(e.target.value)||QUICK_DEFAULT_COUNT)} className="w-full"/>
            </div>
            <div className="md:col-span-2">
              <input type="number" min={QUICK_MIN} max={Math.min(QUICK_MAX, Math.max(QUICK_MIN,total))} value={count} onChange={(e)=> setCount(clamp(Number(e.target.value)||QUICK_DEFAULT_COUNT, QUICK_MIN, QUICK_MAX))} className="w-full px-3 py-2 border border-emerald-200 rounded-lg bg-white"/>
            </div>
            <div className="md:col-span-2 text-right">
              <button onClick={start} disabled={disabled} className={cx('px-4 py-2 rounded-lg font-semibold', disabled? 'bg-slate-200 text-slate-500 cursor-not-allowed':'bg-emerald-600 text-white hover:bg-emerald-700')}>Start</button>
            </div>
          </div>
          {disabled && <div className="text-sm text-red-600 mt-2">No questions available yet. Please add to your Google Sheet.</div>}
        </Card>
      </div>
    </div>
  );
}

/* ========= Core Quiz ========= */
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

  useEffect(() => { setSecondsLeft(25); const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000); return () => clearInterval(id); }, [i]);
  useEffect(() => { if (secondsLeft <= 0 && q && !showFeedback && !advancing) { revealAndQueueNext(null); } }, [secondsLeft, showFeedback, advancing, q]);
  useEffect(() => { if (i===0) updateStreakOnPlay(); }, []);

  function nextQuestion() { if (i + 1 >= qs.length) { return onFinish({ score, total: qs.length, history, opponent, battleMode }); } setI((x) => x + 1); setSel(null); setShowFeedback(false); setAdvancing(false); }
  function revealAndQueueNext(chosenIndex) {
    if (!q || advancing) return;
    setSel(chosenIndex); setShowFeedback(true); setAdvancing(true);
    const isCorrect = chosenIndex === q.answerIndex;
    if (chosenIndex != null) setScore((s) => s + (isCorrect ? 1 : 0));
    setHistory((h) => [...h, { id: q.id, text: q.text, options: q.options, correctIndex: q.answerIndex, chosenIndex, isCorrect, cat: q.cat }]);
    bumpDailyDone(1); addXP(isCorrect ? 10 : 2);
    setTimeout(() => { nextQuestion(); }, 2000);
  }

  const letters = ['a','b','c','d','e','f'];

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 pb-20 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => onFinish({ score, total: qs.length, history, aborted: true, opponent, battleMode })} className="text-slate-600">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold">{battleMode ? 'Online Battle' : category}</div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={25} />
        </div>
        {battleMode && opponent && (
          <div className="flex items-center gap-3 mb-2"><OppAvatar name={opponent.name} /><div><div className="text-[13px] md:text-[14px] font-semibold text-slate-800">{opponent.name}</div><div className="text-[12px] text-slate-500">{opponent.place}</div></div></div>
        )}
        <div className="text-[12px] md:text-[13px] text-slate-500 mb-2">Question <span className="font-semibold">{Math.min(i + 1, qs.length)}/{qs.length || 0}</span></div>
        <LinearProgress value={Math.min(i + 1, qs.length)} max={Math.max(1, qs.length)} />
        {!q ? (<Card className="p-4 mt-4 bg-white/90"><div className="text-[14px] text-slate-700">No questions found.</div></Card>) : (
          <div className="grid md:grid-cols-2 md:items-start md:gap-4">
            <Card className="p-4 mt-4 mb-3 md:mb-0 bg-white/90"><div className="text-[14px] md:text-[15px] font-semibold text-slate-800">{q.text}</div></Card>
            <div className="mt-2 md:mt-4">
              {q.options.map((opt, idx) => (
                <div key={idx} onClick={() => { if (showFeedback || advancing) return; revealAndQueueNext(idx); }}>
                  <OptionButton letter={letters[idx]} label={opt} disabled={showFeedback || advancing} isSelected={sel === idx} showFeedback={showFeedback} isCorrect={showFeedback && idx === q.answerIndex} isWrong={showFeedback && sel === idx && idx !== q.answerIndex} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="fixed bottom-4 left-0 right-0"><div className="mx-auto max-w-5xl px-4 md:px-6"><button className="w-full py-3 md:py-3.5 rounded-xl text-white font-semibold bg-emerald-300 cursor-not-allowed" disabled>Next</button></div></div>
      </div>
    </div>
  );
}

/* ========= Mock Exam (global timer + sections + OMR) ========= */
function MockSetup({ bank, onStart, onBack }){
  const cats = Object.keys(bank);
  const [sections, setSections] = useState(cats.slice(0,3).map((c)=>({ name:c, count:10, cutoff:30 })));
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState('Full Mock Test');

  function addSection(){ if (sections.length>=5) return; const cand = cats.find(c=> !sections.find(s=>s.name===c)); if(!cand) return; setSections([...sections, {name:cand, count:10, cutoff:30}]); }
  function removeSection(i){ setSections(sections.filter((_,idx)=> idx!==i)); }
  function start(){ onStart({ title, duration, sections }); }

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-12 pt-6">
        <div className="flex items-center justify-between mb-3"><button onClick={onBack} className="text-slate-600">←</button><div className="text-[15px] md:text-[17px] font-semibold">Mock Exam Setup</div><span className="w-4"/></div>
        <Card className="p-4">
          <div className="grid gap-3">
            <div>
              <label className="text-sm text-slate-600">Title</label>
              <input value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-600">Duration (minutes)</label>
                <input type="number" min={15} max={180} value={duration} onChange={(e)=>setDuration(Number(e.target.value)||60)} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white"/>
              </div>
              <div className="flex items-end"><button onClick={addSection} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">Add Section</button></div>
            </div>
            <div className="space-y-2">
              {sections.map((s,idx)=> (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-5">
                    <label className="text-sm text-slate-600">Section Category</label>
                    <select value={s.name} onChange={(e)=>{ const name=e.target.value; const next=[...sections]; next[idx]={...s,name}; setSections(next); }} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white">
                      {cats.map((c)=> <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-sm text-slate-600">Questions</label>
                
