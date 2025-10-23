// App.jsx — PSC Guru (Tea Green theme) + Dark Mode Toggle
// - Dark/Light toggle with sun/moon, persists to localStorage, applies on <html> and local wrapper.
// - Keeps features: Mock Exams (timer + section cutoffs), OMR-style review w/ actual answers,
//   Daily goals & streaks, XP/levels, badges, Battle mode, Random Quick Quiz with % slider,
//   Topic & Exam categories from Google Sheets.
// - Adds: Syllabus, Answer Key, PSC Bulletin cards on Home (loaded from official site via CORS-safe proxy)
// - Fixes: validated JSX, no unterminated strings, +/- stepper works, OMR shows full text.

import { useEffect, useMemo, useState } from 'react'
import NotificationTicker from "./components/NotificationTicker.jsx";

/* ========================= CONFIG ========================= */
const DEFAULT_FILE_ID = '16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o'
const GS_FILE_ID = (import.meta?.env?.VITE_GS_FILE_ID || '').trim() || DEFAULT_FILE_ID

const TAB_CATEGORIES = 'Categories'
const TAB_EXAM_CATS = 'EXAM CAT'
const TAB_QUESTIONS = 'Questions'
const TAB_STUDY = 'Study Material'
const TAB_EXAMS = 'Exam Notifications'

const BATTLE_QUESTION_COUNT = 20
const QUICK_DEFAULT_COUNT = 10
const QUICK_MIN = 5
const QUICK_MAX = 50

/* ========================= UTILS ========================= */
const cx = (...xs) => xs.filter(Boolean).join(' ')
const norm = (s) => String(s ?? '').trim()
const lower = (s) => norm(s).toLowerCase()
const strip = (s) => lower(s).replace(/[^a-z0-9]+/g, '')
// Avoid \u escapes to prevent TS/JS parser issues. Use literal Unicode dashes.
const normalizeSheetName = (s) => norm(s).replace(/[‒–—―−]/g, '-').replace(/\s+/g, ' ')
const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

const rand = (n) => Math.floor(Math.random() * n)
const sampleOne = (arr) => (arr.length ? arr[rand(arr.length)] : undefined)
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }
function sampleMany(arr, n) { return shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length))) }

function parseGViz(text) {
  const t = String(text || '')
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1))
  throw new Error('GViz parse error')
}

async function gvizFetch({ sheetName, gid, tq = 'select *' }) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`)
  if (gid) url.searchParams.set('gid', gid); else url.searchParams.set('sheet', sheetName)
  url.searchParams.set('tq', tq)
  url.searchParams.set('tqx', 'out:json')
  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`GViz HTTP ${res.status}`)
  const raw = await res.text()
  const json = parseGViz(raw)
  let cols = (json.table?.cols || []).map((c, i) => lower(c?.label || c?.id || `col${i + 1}`))
  let rows = (json.table?.rows || []).map((r) => (r.c || []).map((c) => ((c && c.v) != null ? String(c.v) : '')))
  const looksGeneric = cols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c))
  const headerish = (rows[0] || []).some((v) => /(name|display|tab|sheet|actual|question|opt|correct|title|url|desc|date|categories|duration|year|questions)/i.test(String(v || '')))
  if (looksGeneric && headerish) { cols = (rows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); rows = rows.slice(1) }
  return { cols, rows }
}

function findHeaderIndex(cols, candidates, fallbackIndex) {
  const candNorms = candidates.map((c) => strip(c))
  const colNorms = cols.map((c) => strip(c))
  for (const c of candNorms) {
    const i = colNorms.findIndex((cn) => cn === c || cn.includes(c))
    if (i !== -1) return i
  }
  return typeof fallbackIndex === 'number' ? fallbackIndex : -1
}

function mapQuestionRows(cols, rows, defaultCategory = 'General') {
  const idxQ = findHeaderIndex(cols, ['question', 'q', 'title'])
  const idxAns = findHeaderIndex(cols, ['answer', 'ans', 'correcttext'])
  const idxA = findHeaderIndex(cols, ['opta', 'a', 'option a', '1'])
  const idxB = findHeaderIndex(cols, ['optb', 'b', 'option b', '2'])
  const idxC = findHeaderIndex(cols, ['optc', 'c', 'option c', '3'])
  const idxD = findHeaderIndex(cols, ['optd', 'd', 'option d', '4'])
  const idxCor = findHeaderIndex(cols, ['correct', 'answerindex', 'correct option'], -1)
  const idxCat = findHeaderIndex(cols, ['category', 'subject', 'topic', 'cat'], -1)
  const idxDiff = findHeaderIndex(cols, ['difficulty', 'level'], -1)

  const items = []
  for (const r of rows) {
    const text = norm(r[idxQ])
    const options = [r[idxA], r[idxB], r[idxC], r[idxD]].map(norm).filter(Boolean)
    if (!text || options.length < 2) continue

    const answerText = norm(r[idxAns])
    const correctRaw = norm(r[idxCor])

    let answerIndex = -1
    if (correctRaw) {
      const v = correctRaw.toUpperCase()
      if ('ABCD'.includes(v)) answerIndex = v.charCodeAt(0) - 65
      else { const n = Number(v); if (Number.isFinite(n) && n >= 1 && n <= options.length) answerIndex = n - 1 }
    }
    if (answerIndex < 0 && answerText) {
      const i = options.findIndex((o) => strip(o) === strip(answerText))
      if (i >= 0) answerIndex = i
    }
    if (answerIndex < 0) answerIndex = 0

    let diff = lower(r[idxDiff]) || ''
    if (!['easy', 'medium', 'hard'].includes(diff)) {
      const L = text.length
      diff = L < 60 ? 'easy' : L < 120 ? 'medium' : 'hard'
    }

    items.push({
      cat: idxCat >= 0 ? norm(r[idxCat]) || defaultCategory : defaultCategory,
      text,
      options,
      answerIndex,
      difficulty: diff,
    })
  }
  return items
}

function mapListRows(cols, rows) {
  const idxTitle = findHeaderIndex(cols, ['title', 'name', 'heading'], 0)
  const idxUrl = findHeaderIndex(cols, ['url', 'link', 'href'], 1)
  const idxDesc = findHeaderIndex(cols, ['desc', 'description', 'about', 'categories'], 2)
  const idxDate = findHeaderIndex(cols, ['date', 'when', 'year'], 3)
  const idxDur = findHeaderIndex(cols, ['duration', 'time'], -1)
  const idxQn = findHeaderIndex(cols, ['questions', 'count', 'total'], -1)

  const items = []
  for (const r of rows) {
    const title = norm(r[idxTitle])
    if (!title) continue
    items.push({
      title,
      url: norm(r[idxUrl]),
      desc: norm(r[idxDesc]),
      date: norm(r[idxDate]),
      duration: norm(r[idxDur]),
      questions: norm(r[idxQn]),
    })
  }
  return items
}

function shuffleWithIndex(arr, correctIdx) {
  const idxs = arr.map((_, i) => i)
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idxs[i], idxs[j]] = [idxs[j], idxs[i]]
  }
  const newOptions = idxs.map((i) => arr[i])
  const newCorrect = idxs.indexOf(correctIdx)
  return { newOptions, newCorrect }
}

function toBank(items) {
  const bank = {}
  for (const it of items) {
    const { newOptions, newCorrect } = shuffleWithIndex(it.options, it.answerIndex)
    bank[it.cat] ??= []
    bank[it.cat].push({ id: bank[it.cat].length + 1, text: it.text, options: newOptions, answerIndex: newCorrect, difficulty: it.difficulty })
  }
  return bank
}

function flattenBank(bank) { const out = []; for (const [cat, list] of Object.entries(bank)) for (const q of list) out.push({ ...q, cat }); return out }
function mergeBanks(a, b){ const out = {...a}; for(const [k,v] of Object.entries(b||{})){ out[k] = (out[k]||[]).concat(v) } return out }

/* ====== Non-throwing smoke tests ====== */
;(function unitSmokeTests(){
  try {
    console.assert(clamp(10, 0, 5) === 5, 'clamp upper')
    console.assert(clamp(-1, 0, 5) === 0, 'clamp lower')
    const { newOptions, newCorrect } = shuffleWithIndex(['A','B','C','D'], 2)
    console.assert(newOptions.length === 4 && newCorrect >= 0 && newCorrect < 4, 'shuffleWithIndex ok')
  } catch {}
})()

/* ========= Theming ========= */
const THEME_KEY = 'prefers_dark'
function applyThemeClass(isDark){
  const root = document.documentElement
  if (isDark) root.classList.add('dark'); else root.classList.remove('dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', isDark ? '#0B1220' : '#eefbe7')
}

function useTheme(){
  const [dark, setDark] = useState(false)
  useEffect(()=>{
    const stored = localStorage.getItem(THEME_KEY)
    const sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    const initial = stored === '1' || (stored == null && sys)
    setDark(initial); applyThemeClass(initial)
  }, [])
  function toggle(){
    setDark((d)=> {
      const next = !d
      localStorage.setItem(THEME_KEY, next ? '1' : '0')
      applyThemeClass(next)
      return next
    })
  }
  return { dark, toggle }
}

function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle dark mode"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-200 text-slate-700 hover:bg-emerald-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {dark ? (
        // Sun icon
        <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0"><circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" strokeWidth="2"><path d="M12 1v3"/><path d="M12 20v3"/><path d="M4.22 4.22l2.12 2.12"/><path d="M17.66 17.66l2.12 2.12"/><path d="M1 12h3"/><path d="M20 12h3"/><path d="M4.22 19.78l2.12-2.12"/><path d="M17.66 6.34l2.12-2.12"/></g></svg>
      ) : (
        // Moon icon
        <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0"><path fill="currentColor" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      )}
      <span className="text-sm hidden sm:inline">{dark ? 'Light' : 'Dark'}</span>
    </button>
  )
}

/* ========= Avatars / UI ========= */
function CartoonAvatar() {
  return (
    <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-emerald-200 grid place-items-center overflow-hidden dark:bg-emerald-300/30" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="36" height="36">
        <circle cx="32" cy="24" r="12" fill="#fff" />
        <path d="M12 54c3-10 13-14 20-14s17 4 20 14" fill="#fff" />
        <circle cx="28" cy="22" r="2" fill="#059669" />
        <circle cx="36" cy="22" r="2" fill="#059669" />
        <path d="M26 27c2 2 8 2 10 0" stroke="#059669" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function OppAvatar({ name }) {
  const initials = useMemo(() => name.split(' ').map((w) => w[0]?.toUpperCase()).slice(0, 2).join(''), [name])
  let hue = 0; for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  return (
    <div className="w-10 h-10 md:w-11 md:h-11 rounded-full grid place-items-center text-sm font-bold text-white" style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }} title={name}>
      {initials || 'OP'}
    </div>
  )
}

const MALAYALI_NAMES = ['Anand','Akhil','Ajith','Anu','Amala','Hari','Gopika','Sreenath','Nimisha','Midhun','Varun','Fahad','Mamta','Dulquer','Nazriya','Tovino','Keerthi','Surya','Meera','Aswin','Neha','Anjana','Athul','Devika','Mohan','Sreejith','Athira','Jishnu','Remya','Arjun','Anoop','Sarath','Abhiram','Nikhil','Sneha','Gayathri','Adithya','Aparna']
const KERALA_PLACES = ['Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur','Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod','Kochi','Muvattupuzha','Kattappana','Pala','Chalakudy','Kunnamkulam','Nedumangad','Neyyattinkara','Attingal','Kayamkulam','Tirur','Perinthalmanna','Payyannur','Taliparamba','Kanhangad','Varkala','Adoor','Changanassery','Irinjalakuda','Thodupuzha']
function randomOpponent() { return { name: sampleOne(MALAYALI_NAMES) + ' ' + sampleOne(['K','S','N','M','P','V']), place: sampleOne(KERALA_PLACES) } }

const Card = ({ children, className = '' }) => (
  <div className={cx('rounded-2xl bg-white shadow-sm border border-emerald-100 dark:bg-slate-800 dark:border-slate-700', className)}>{children}</div>
)

function LinearProgress({ value, max }) { const pct = Math.min(100, Math.max(0, (value / max) * 100)); return (<div className="w-full h-1.5 md:h-2 bg-emerald-100 rounded-full overflow-hidden dark:bg-slate-700"><div className="h-full bg-emerald-600" style={{ width: `${pct}%`} } /></div>) }

function TimerRing({ secondsLeft, totalSeconds = 25 }) {
  const R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, secondsLeft / totalSeconds))
  return (
    <div className="relative w-10 h-10 md:w-11 md:h-11">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-100 dark:stroke-slate-700" strokeWidth="6" />
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-600 transition-[stroke-dasharray] duration-200" strokeLinecap="round" strokeWidth="6" strokeDasharray={`${C * p} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] md:text-xs font-semibold text-emerald-700 dark:text-emerald-300">0{Math.max(0, secondsLeft).toString().padStart(2, '0')}</div>
    </div>
  )
}

function OptionButton({ label, letter, disabled, isSelected, showFeedback, isCorrect, isWrong }) {
  const feedbackClass = showFeedback
    ? (isCorrect ? 'border-green-500 bg-green-50 dark:bg-green-900/30' : isWrong ? 'border-red-500 bg-red-50 dark:bg-red-900/30' : 'border-transparent')
    : isSelected ? 'border-emerald-600 ring-2 ring-emerald-200 dark:ring-emerald-900' : 'border-transparent hover:border-emerald-200 dark:hover:border-slate-600'
  const textColor = showFeedback ? (isCorrect ? 'text-green-800 dark:text-green-300' : isWrong ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-100') : 'text-slate-800 dark:text-slate-100'
  return (
    <button disabled={disabled} className={cx('w-full text-left rounded-xl border-2 px-4 py-3 md:px-5 md:py-3.5 mb-3 transition-all bg-white/80 dark:bg-slate-800/80', feedbackClass)} aria-pressed={isSelected ? 'true' : 'false'}>
      <span className="inline-flex items-center gap-3">
        <span className={cx('grid place-items-center w-6 h-6 rounded-full text-xs font-semibold md:w-7 md:h-7 md:text-sm', showFeedback ? (isCorrect ? 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-200' : isWrong ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200' : 'bg-emerald-100 text-emerald-700 dark:bg-slate-700 dark:text-emerald-300') : 'bg-emerald-100 text-emerald-700 dark:bg-slate-700 dark:text-emerald-300')}>{letter}</span>
        <span className={cx('text-[15px] md:text-[16px]', textColor)}>{label}</span>
      </span>
    </button>
  )
}

function Splash() {
  const messages = ['Personalizing your questions…','Finding new online friends…','Updating new questions…','Sharpening brain cells…','Warming up the quiz engine…','Checking your lucky stars…']
  const [i, setI] = useState(0)
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % messages.length), 1400); return () => clearInterval(id) }, [])
  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7] dark:bg-slate-900">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4 dark:border-slate-700 dark:border-t-emerald-600" />
        <div className="text-emerald-700 dark:text-emerald-300 font-semibold text-[15px] md:text-[17px] transition-opacity duration-300">{messages[i]}</div>
        <div className="w-56 md:w-72 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4 dark:bg-slate-700"><div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse" /></div>
      </div>
    </div>
  )
}

/* ========= Progress / XP / Streaks ========= */
const XP_KEY = 'xp_total'
const LVL_KEY = 'xp_level'
const BADGE_KEY = 'xp_badges'
const STREAK_KEY = 'streak_count'
const LASTDAY_KEY = 'last_played_day'
const DAILY_TARGET_KEY = 'daily_target'
const DAILY_DONE_KEY = 'daily_done_' // + yyyymmdd

function todayKey() { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}${m}${dd}` }
function getNum(key, def=0){ const v = Number(localStorage.getItem(key)); return Number.isFinite(v)? v: def }
function setNum(key, v){ localStorage.setItem(key, String(v)) }
function addBadge(name){ const arr = JSON.parse(localStorage.getItem(BADGE_KEY) || '[]'); if(!arr.includes(name)){ arr.push(name); localStorage.setItem(BADGE_KEY, JSON.stringify(arr)) } }
function getBadges(){ return JSON.parse(localStorage.getItem(BADGE_KEY) || '[]') }
function addXP(n){ const cur = getNum(XP_KEY, 0) + n; setNum(XP_KEY, cur); const level = Math.floor(cur/200)+1; setNum(LVL_KEY, level); return { xp: cur, level } }
function bumpDailyDone(n){ const key = DAILY_DONE_KEY+todayKey(); setNum(key, getNum(key,0)+n) }
function getDaily(){ const target = getNum(DAILY_TARGET_KEY, 20); const done = getNum(DAILY_DONE_KEY+todayKey(),0); return {target, done} }
function setDailyTarget(n){ setNum(DAILY_TARGET_KEY, clamp(n,5,200)) }
function updateStreakOnPlay(){ const last = localStorage.getItem(LASTDAY_KEY)||''; const today = todayKey(); if(last===today) return getNum(STREAK_KEY,0); const y = Number(last.slice(0,4)), m = Number(last.slice(4,6))-1, d = Number(last.slice(6,8)); const was = y? new Date(y,m,d): null; const now = new Date(); const diffDays = was? Math.round((now - was)/(24*3600*1000)): null; let streak = getNum(STREAK_KEY,0); if(diffDays===1) streak += 1; else streak = 1; setNum(STREAK_KEY, streak); localStorage.setItem(LASTDAY_KEY, today); if(streak===7) addBadge('7-Day Streak'); if(streak===30) addBadge('30-Day Streak'); return streak }

/* ========= Data loaders ========= */
async function loadTopicBank() {
  try {
    const { cols, rows } = await gvizFetch({ sheetName: TAB_QUESTIONS })
    if (rows.length) { const items = mapQuestionRows(cols, rows); const bank = toBank(items); if (Object.keys(bank).length) return bank }
  } catch {}
  const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_CATEGORIES })
  let cCols = cCols0, cRows = cRows0
  const generic = cCols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c))
  const firstLooksHeader = (cRows[0] || []).some((v) => /(name|display|tab|sheet|actual)/i.test(String(v || '')))
  if (generic && firstLooksHeader) { cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); cRows = cRows.slice(1) }
  let idxDisplay = findHeaderIndex(cCols, ['name (display)', 'display', 'title', 'name'], -1)
  let idxTab = findHeaderIndex(cCols, ['text (actual tab name)', 'actual tab name', 'tab', 'sheet', 'sheetname'], -1)
  if (idxDisplay === -1 || idxTab === -1) { const idIdx = cCols.findIndex((x) => strip(x) === 'id'); const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx); if (idxDisplay === -1 && indices.length) idxDisplay = indices[0]; if (idxTab === -1 && indices.length > 1) idxTab = indices[1] }
  if (idxDisplay === -1) idxDisplay = 1; if (idxTab === -1) idxTab = 2
  const mappings = cRows.map((r) => ({ display: normalizeSheetName(r[idxDisplay]), tab: normalizeSheetName(r[idxTab]) })).filter((m) => m.display && m.tab)
  const bank = {}
  for (const m of mappings) {
    try {
      const isGid = /^\d+$/.test(m.tab)
      const { cols, rows } = await gvizFetch({ sheetName: isGid ? undefined : m.tab, gid: isGid ? m.tab : undefined })
      const items = mapQuestionRows(cols, rows, m.display)
      bank[m.display] = toBank(items)[m.display] || []
    } catch (e) { console.warn('Failed tab (topic)', m.tab, e); bank[m.display] = [] }
  }
  return bank
}

async function loadExamBank(){
  try{
    const { cols: cCols0, rows: cRows0 } = await gvizFetch({ sheetName: TAB_EXAM_CATS })
    let cCols = cCols0, cRows = cRows0
    const generic = cCols.every((c) => c === '' || /^[a-z]\w*$/i.test(c) || /^col\d+$/i.test(c))
    const firstLooksHeader = (cRows[0] || []).some((v) => /(name|display|tab|sheet|actual)/i.test(String(v || '')))
    if (generic && firstLooksHeader) { cCols = (cRows[0] || []).map((v, i) => lower(v || `col${i + 1}`)); cRows = cRows.slice(1) }
    let idxDisplay = findHeaderIndex(cCols, ['name (display)', 'display', 'title', 'name'], -1)
    let idxTab = findHeaderIndex(cCols, ['text (actual tab name)', 'actual tab name', 'tab', 'sheet', 'sheetname'], -1)
    if (idxDisplay === -1 || idxTab === -1) { const idIdx = cCols.findIndex((x) => strip(x) === 'id'); const indices = cCols.map((_, i) => i).filter((i) => i !== idIdx); if (idxDisplay === -1 && indices.length) idxDisplay = indices[0]; if (idxTab === -1 && indices.length > 1) idxTab = indices[1] }
    if (idxDisplay === -1) idxDisplay = 1; if (idxTab === -1) idxTab = 2
    const mappings = cRows.map((r) => ({ display: normalizeSheetName(r[idxDisplay]), tab: normalizeSheetName(r[idxTab]) })).filter((m) => m.display && m.tab)
    const bank = {}
    for(const m of mappings){
      try{
        const isGid = /^\d+$/.test(m.tab)
        const { cols, rows } = await gvizFetch({ sheetName: isGid ? undefined : m.tab, gid: isGid ? m.tab : undefined })
        const items = mapQuestionRows(cols, rows, m.display)
        bank[m.display] = toBank(items)[m.display] || []
      }catch(e){ console.warn('Failed tab (exam)', m.tab, e); bank[m.display] = [] }
    }
    return bank
  }catch(e){ console.warn('Exam bank load failed', e); return {} }
}

async function loadList(tabName) { try { const { cols, rows } = await gvizFetch({ sheetName: tabName }); return mapListRows(cols, rows) } catch (e) { console.warn('List load failed', tabName, e); return [] } }

/* ========= Syllabus / Answer Key / Bulletin Loaders ========= */
// CORS-safe read-only mirrors
const SYLLABUS_SRC = 'https://r.jina.ai/http://www.keralapsc.gov.in/syllabus1'
const ANSWERKEY_SRC = 'https://r.jina.ai/http://www.keralapsc.gov.in/answerkey_onlineexams'
const BULLETIN_SRC  = 'https://r.jina.ai/http://www.keralapsc.gov.in/psc-bulletin'

function normalizeUrl(u=''){
  const s = String(u).trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  if (s.startsWith('//')) return 'https:' + s
  if (s.startsWith('/')) return 'https://www.keralapsc.gov.in' + s
  return 'https://www.keralapsc.gov.in/' + s.replace(/^\//,'')
}

function dedupeBy(arr, keyFn){
  const seen = new Set()
  const out = []
  for(const it of arr){
    const k = keyFn(it)
    if (k && !seen.has(k)){ seen.add(k); out.push(it) }
  }
  return out
}

async function loadSyllabusList(){
  try{
    const res = await fetch(SYLLABUS_SRC, { cache: 'no-store' })
    if(!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    const items = []
    // Markdown-style links: [Title](URL)
    for(const m of text.matchAll(/\[([^\]]{3,})\]\((https?:\/\/[^\s)]+)\)/g)){
      const title = norm(m[1]); const url = normalizeUrl(m[2])
      if (!title || !url) continue
      if (/syllabus|\.pdf/i.test(url) || /syllabus/i.test(title)) items.push({ title, url })
    }
    // Fallback: bare URLs containing 'syllabus'
    for(const m of text.matchAll(/\bhttps?:\/\/[^\s)>"']+/g)){
      const url = m[0]
      if(!/keralapsc\.gov\.in/i.test(url)) continue
      if(!/syllabus|\.pdf/i.test(url)) continue
      const tail = url.split('/').pop() || 'Syllabus'
      const title = decodeURIComponent(tail).replace(/[-_]/g,' ').replace(/\.(pdf|html?)$/i,'').trim() || 'Syllabus'
      items.push({ title, url })
    }

    const clean = dedupeBy(items, it => it.url).slice(0, 200).map(it => ({
      title: it.title, url: it.url, desc: '', date: '', duration: '', questions: ''
    }))
    if(clean.length === 0){
      return [{ title: 'Kerala PSC Syllabus — Official Page', url: 'https://www.keralapsc.gov.in/syllabus1', desc: 'Browse all syllabus documents.', date: '', duration: '', questions: '' }]
    }
    return clean
  }catch(e){
    console.warn('Syllabus load failed', e)
    return [{ title: 'Kerala PSC Syllabus — Official Page', url: 'https://www.keralapsc.gov.in/syllabus1', desc: 'Open the official syllabus page.', date: '', duration: '', questions: '' }]
  }
}

async function loadAnswerKeyList(){
  try{
    const res = await fetch(ANSWERKEY_SRC, { cache: 'no-store' })
    if(!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    const items = []
    // Markdown links likely referencing answer keys
    for(const m of text.matchAll(/\[([^\]]{3,})\]\((https?:\/\/[^\s)]+)\)/g)){
      const title = norm(m[1]); const url = normalizeUrl(m[2])
      if (!title || !url) continue
      if (/answer\s*key|answerkey|final\s*key|\.pdf/i.test(url+title)) items.push({ title, url })
    }
    // Fallback: bare URLs containing 'answerkey' or 'answer-key'
    for(const m of text.matchAll(/\bhttps?:\/\/[^\s)>"']+/g)){
      const url = m[0]
      if(!/keralapsc\.gov\.in/i.test(url)) continue
      if(!/(answer[-_ ]?key|final[-_ ]?key|\.pdf)/i.test(url)) continue
      const tail = url.split('/').pop() || 'Answer Key'
      const title = decodeURIComponent(tail).replace(/[-_]/g,' ').replace(/\.(pdf|html?)$/i,'').trim() || 'Answer Key'
      items.push({ title, url })
    }

    const clean = dedupeBy(items, it => it.url).slice(0, 200).map(it => ({
      title: it.title, url: it.url, desc: '', date: '', duration: '', questions: ''
    }))
    if(clean.length === 0){
      return [{ title: 'Kerala PSC Answer Keys — Official Page', url: 'https://www.keralapsc.gov.in/answerkey_onlineexams', desc: 'Browse available answer keys for online exams.', date: '', duration: '', questions: '' }]
    }
    return clean
  }catch(e){
    console.warn('AnswerKey load failed', e)
    return [{ title: 'Kerala PSC Answer Keys — Official Page', url: 'https://www.keralapsc.gov.in/answerkey_onlineexams', desc: 'Open the official answer keys page.', date: '', duration: '', questions: '' }]
  }
}

async function loadBulletinList(){
  try{
    const res = await fetch(BULLETIN_SRC, { cache: 'no-store' })
    if(!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    const items = []
    // Markdown links
    for(const m of text.matchAll(/\[([^\]]{3,})\]\((https?:\/\/[^\s)]+)\)/g)){
      const title = norm(m[1]); const url = normalizeUrl(m[2])
      if (!title || !url) continue
      if (/bulletin|psc\s*bulletin|\.pdf/i.test(url+title)) items.push({ title, url })
    }
    // Fallback: bare URLs
    for(const m of text.matchAll(/\bhttps?:\/\/[^\s)>"']+/g)){
      const url = m[0]
      if(!/keralapsc\.gov\.in/i.test(url)) continue
      if(!/(psc[-_ ]?bulletin|bulletin|\.pdf)/i.test(url)) continue
      const tail = url.split('/').pop() || 'PSC Bulletin'
      const title = decodeURIComponent(tail).replace(/[-_]/g,' ').replace(/\.(pdf|html?)$/i,'').trim() || 'PSC Bulletin'
      items.push({ title, url })
    }

    const clean = dedupeBy(items, it => it.url).slice(0, 200).map(it => ({
      title: it.title, url: it.url, desc: '', date: '', duration: '', questions: ''
    }))
    if(clean.length === 0){
      return [{ title: 'Kerala PSC Bulletin — Official Page', url: 'https://www.keralapsc.gov.in/psc-bulletin', desc: 'Read the official PSC Bulletin editions.', date: '', duration: '', questions: '' }]
    }
    return clean
  }catch(e){
    console.warn('Bulletin load failed', e)
    return [{ title: 'Kerala PSC Bulletin — Official Page', url: 'https://www.keralapsc.gov.in/psc-bulletin', desc: 'Open the official PSC Bulletin page.', date: '', duration: '', questions: '' }]
  }
}

/* ========= Views ========= */
function Home({
  topicBank, examBank,
  onStartTopic, onStartExam,
  onSeeAllTopics, onSeeAllExams,
  onStartBattle, onQuick,
  openStudy, openExams, openSyllabus, openAnswerKey, openBulletin,
  recent, toMock, toProfile, theme
}) {
  const topicCats = Object.keys(topicBank)
  const examCats = Object.keys(examBank)
  const [homeQ, setHomeQ] = useState('')
  const filteredTopics = topicCats.filter((c) => c.toLowerCase().includes(homeQ.toLowerCase()))
  const previewTopics = filteredTopics.slice(0, 6)

  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6 lg:px-8 pb-28 pt-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 md:gap-4">
            <CartoonAvatar />
            <div>
              <p className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">PSC Guru</p>
              <p className="text-[13px] md:text-[14px] text-slate-600 dark:text-slate-400">No1 PSC Learning App</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
            <button onClick={toProfile} className="text-[13px] md:text-[14px] text-emerald-700 underline dark:text-emerald-300">Profile & Goals</button>
          </div>
        </div>

        <div className="mb-5 max-w-2xl sticky top-0 z-20">
          <div className="flex items-center gap-2 bg-white/80 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5 dark:bg-slate-800/80 dark:border-slate-700">
            <span className="text-slate-400">🔎</span>
            <input className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400 bg-transparent text-slate-800 dark:text-slate-100" placeholder="Search categories" value={homeQ} onChange={(e) => setHomeQ(e.target.value)} />
          </div>
        </div>

        {/* ===== Notifications Ticker (2025 latest) ===== */}
        <section style={{ marginTop: 16 }}>
          <NotificationTicker limit={40} />
        </section>

        {/* Top quick actions */}
        <div className="grid gap-4 md:grid-cols-3 mt-4">
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
            <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">Topic Categories</div>
            <button onClick={onSeeAllTopics} className="text-[13px] md:text-[14px] text-emerald-700 dark:text-emerald-300">View all</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {previewTopics.map((c) => (
              <button key={c} onClick={() => onStartTopic(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 dark:bg-slate-700 dark:text-emerald-300">＋</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800 dark:text-slate-100">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500 dark:text-slate-400">{(topicBank[c] || []).length} questions</div>
              </button>
            ))}
            {previewTopics.length === 0 && <div className="col-span-full text-center text-sm text-slate-600 dark:text-slate-400">No topics match “{homeQ}”.</div>}
          </div>
        </div>

        {/* Exam Categories */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">Exam Categories</div>
            <button onClick={onSeeAllExams} className="text-[13px] md:text-[14px] text-emerald-700 dark:text-emerald-300">View all</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            {Object.keys(examBank).slice(0,6).map((c) => (
              <button key={c} onClick={() => onStartExam(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 dark:bg-slate-700 dark:text-emerald-300">🎓</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800 dark:text-slate-100">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500 dark:text-slate-400">{(examBank[c] || []).length} questions</div>
              </button>
            ))}
            {Object.keys(examBank).slice(0,6).length === 0 && <div className="col-span-full text-center text-sm text-slate-600 dark:text-slate-400">No exams match “{homeQ}”.</div>}
          </div>
        </div>

        {/* Tools */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-3">
          <button onClick={openStudy} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2 dark:bg-slate-700 dark:text-emerald-300">📚</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">Study Material</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400">Curated links</div>
          </button>
          <button onClick={openExams} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2 dark:bg-slate-700 dark:text-emerald-300">📢</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">Exam Notifications</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400">Latest alerts</div>
          </button>
          {/* NEW: Syllabus */}
          <button onClick={openSyllabus} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2 dark:bg-slate-700 dark:text-emerald-300">📝</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">Syllabus</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400">Official PSC syllabus</div>
          </button>
          {/* NEW: Answer Key */}
          <button onClick={openAnswerKey} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2 dark:bg-slate-700 dark:text-emerald-300">✅</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">Answer Key</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400">Online exam keys</div>
          </button>
          {/* NEW: PSC Bulletin */}
          <button onClick={openBulletin} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2 dark:bg-slate-700 dark:text-emerald-300">📰</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">PSC Bulletin</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400">Official editions</div>
          </button>
        </div>

        {/* Recent */}
        {recent.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">Recent</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {recent.map((item, idx) => {
                const kind = typeof item === 'string' ? (topicBank[item] ? 'topic' : 'exam') : item.kind
                const name = typeof item === 'string' ? item : item.name
                const count = kind === 'exam' ? (examBank[name] || []).length : (topicBank[name] || []).length
                const onClick = kind === 'exam' ? () => onStartExam(name) : () => onStartTopic(name)
                return (
                  <button key={idx} onClick={onClick} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 text-left dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 dark:bg-slate-700 dark:text-emerald-300">🕘</div>
                      <div>
                        <div className="text-[13px] md:text-[14px] font-medium text-slate-800 dark:text-slate-100">{name}</div>
                        <div className="text-[11px] md:text-[12px] text-slate-500 dark:text-slate-400">{count} questions • {kind==='exam'?'Exam':'Topic'}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AllCategories({ title, bank, onStart, onBack, theme }) {
  const [q, setQ] = useState('')
  const cats = Object.keys(bank).filter((n) => n.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="w-full mx-auto max-w-6xl pb-20">
        <div className="sticky top-0 z-30 -mx-4 md:mx-0 px-4 md:px-6 pt-4 pb-3 bg-[#eefbe7]/95 backdrop-blur border-b border-emerald-100 flex items-center justify-between dark:bg-slate-900/95 dark:border-slate-800">
          <button onClick={onBack} className="text-slate-600 dark:text-slate-300">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">{title}</div>
          <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
        </div>
        <div className="px-4 md:px-6 pt-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
            <div className="col-span-full max-w-xl mb-2">
              <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5 shadow-sm dark:bg-slate-800/90 dark:border-slate-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400 bg-transparent text-slate-800 dark:text-slate-100" autoFocus />
              </div>
            </div>
            {cats.map((c) => (
              <button key={c} onClick={() => onStart(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 transition dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 dark:bg-slate-700 dark:text-emerald-300">＋</div>
                <div className="text-[12px] md:text-[13px] font-medium text-slate-800 text-left dark:text-slate-100">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500 text-left dark:text-slate-400">{(bank[c] || []).length} questions</div>
              </button>
            ))}
            {cats.length === 0 && <Card className="p-4 text-center text-sm text-slate-600 dark:text-slate-400 col-span-full">No items found.</Card>}
          </div>
        </div>
      </div>
    </div>
  )
}

function BattleSearch({ onMatched, theme }) {
  useEffect(() => { const id = setTimeout(() => { onMatched() }, 3000); return () => clearTimeout(id) }, [onMatched])
  return (
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7] dark:bg-slate-900">
      <div className="w-full max-w-sm md:max-w-md px-4 pt-16 text-center">
        <div className="absolute top-4 right-4"><ThemeToggle dark={theme.dark} onToggle={theme.toggle} /></div>
        <div className="relative w-48 h-48 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-emerald-200 animate-ping dark:border-slate-700"></div>
          <div className="absolute inset-3 rounded-full border-4 border-emerald-300 animate-pulse dark:border-slate-600"></div>
          <div className="absolute inset-6 rounded-full border-4 border-emerald-500 animate-spin"></div>
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex -space-x-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/80 animate-bounce"></div>
              <div className="w-10 h-10 rounded-full bg-teal-500/80 animate-[bounce_1.2s_infinite]"></div>
              <div className="w-10 h-10 rounded-full bg-lime-500/80 animate-[bounce_1.4s_infinite]"></div>
            </div>
          </div>
        </div>
        <div className="text-emerald-800 dark:text-emerald-300 font-semibold text-lg mb-1">Finding an opponent…</div>
        <div className="text-slate-600 dark:text-slate-400 text-sm">Looking for players online</div>
      </div>
    </div>
  )
}

/* ========= Quick Setup (random N questions, % slider) ========= */
function QuickSetup({ bank, onStart, onBack, theme }){
  const total = useMemo(()=> flattenBank(bank).length, [bank])
  const disabled = total === 0

  const minSelectable = total ? Math.min(QUICK_MIN, total) : 0
  const minPct = total ? Math.max(1, Math.ceil(100 * minSelectable / total)) : 0

  const [count, setCount] = useState(0)
  const [pct, setPct] = useState(0)

  useEffect(()=>{
    if(total>0){
      const initPct = Math.min(100, Math.max(minPct, Math.round(100 * QUICK_DEFAULT_COUNT / total)))
      setPct(initPct)
      setCount(clamp(Math.round(total * initPct / 100), minSelectable, total))
    } else { setPct(0); setCount(0) }
  }, [total, minPct])

  const pctFromCount = (c)=> total ? Math.round(100 * clamp(c, minSelectable, total) / total) : 0
  const countFromPct = (p)=> clamp(Math.round(total * p / 100), minSelectable, total)

  function start(){
    const flat = flattenBank(bank)
    const picked = sampleMany(flat, count).map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat }))
    onStart(picked)
  }
  function nudgeCount(delta){
    const next = clamp((Number(count)||0) + delta, minSelectable, total)
    setCount(next)
    setPct(pctFromCount(next))
  }
  function setPresetPercent(p){
    const nextPct = clamp(p, minPct, 100)
    setPct(nextPct)
    setCount(countFromPct(nextPct))
  }

  const presetPercents = [10,25,50,75,100].filter(p=> p>=minPct)

  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-16 pt-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"><span>←</span><span className="hidden sm:inline">Back</span></button>
          <div className="text-[16px] md:text-[18px] font-semibold text-slate-900 dark:text-slate-100">Random Quick Quiz</div>
          <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
        </div>

        <Card className="p-0 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 text-white px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm/5 opacity-90">Select how many (by % of available)</div>
                <div className="text-xl font-semibold">Make it quick & smart</div>
              </div>
              <div className="px-3 py-1 rounded-full bg-white/20 text-sm font-semibold whitespace-nowrap">
                Available: {total}
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 md:p-5">
            <div className="grid md:grid-cols-12 gap-4 items-center">
              {/* Stepper */}
              <div className="md:col-span-6">
                <div className="rounded-2xl border border-emerald-100 bg-white/90 shadow-sm dark:bg-slate-800/90 dark:border-slate-700">
                  <div className="flex items-stretch">
                    <button onClick={()=>nudgeCount(-10)} className="px-3 md:px-4 py-4 md:py-5 border-r border-emerald-100 hover:bg-emerald-50 rounded-l-2xl dark:border-slate-700 dark:hover:bg-slate-700" title="-10">−10</button>
                    <button onClick={()=>nudgeCount(-1)} className="px-4 md:px-5 py-4 md:py-5 border-r border-emerald-100 hover:bg-emerald-50 dark:border-slate-700 dark:hover:bg-slate-700" title="-1">−</button>
                    <div className="flex-1 grid place-items-center">
                      <div className="text-sm text-slate-500 dark:text-slate-400">Selected</div>
                      <div className="text-3xl md:text-4xl font-extrabold text-emerald-700 tabular-nums dark:text-emerald-300">{disabled? '—' : count}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">min {Math.min(QUICK_MIN, total)} • max {total}</div>
                    </div>
                    <button onClick={()=>nudgeCount(1)} className="px-4 md:px-5 py-4 md:py-5 border-l border-emerald-100 hover:bg-emerald-50 dark:border-slate-700 dark:hover:bg-slate-700" title="+1">+</button>
                    <button onClick={()=>nudgeCount(10)} className="px-3 md:px-4 py-4 md:py-5 border-l border-emerald-100 hover:bg-emerald-50 rounded-r-2xl dark:border-slate-700 dark:hover:bg-slate-700" title="+10">+10</button>
                  </div>
                </div>

                {/* Percent presets */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {presetPercents.map(p=> (
                    <button key={p} onClick={()=> setPresetPercent(p)} className={cx('px-3 py-1.5 rounded-full text-sm border transition', p===pct? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-emerald-200 text-emerald-700 hover:border-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-emerald-300 dark:hover:border-slate-600')}>{p}%</button>
                  ))}
                </div>
              </div>

              {/* % slider */}
              <div className="md:col-span-6">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400"><span>Adjust with slider</span><span>{pct}% • {count} Qs</span></div>
                <div className="relative h-6">
                  <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-slate-700" />
                  <div className="absolute left-0 top-0 bottom-0 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  <input
                    type="range"
                    min={Math.max(1, Math.ceil(100 * Math.min(QUICK_MIN, total) / (total || 1)))}
                    max={100}
                    value={pct}
                    onChange={(e)=> { const val = clamp(Number(e.target.value)||0, Math.max(1, Math.ceil(100 * Math.min(QUICK_MIN, total) / (total || 1))), 100); setPct(val); setCount(countFromPct(val)) }}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    aria-label="Percent of available questions"
                  />
                  <div className="absolute -top-6" style={{ left: `calc(${pct}% - 28px)` }}>
                    <div className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-600 text-white shadow">{pct}%</div>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div className="md:col-span-12 flex justify-end gap-3 mt-1">
                <button onClick={()=> setPresetPercent(Math.max(1, Math.ceil(100 * Math.min(QUICK_MIN, total) / (total || 1))))} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 dark:bg-slate-800 dark:border-slate-700 dark:text-emerald-300 dark:hover:bg-slate-700">Min</button>
                <button onClick={()=> setPresetPercent(100)} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 dark:bg-slate-800 dark:border-slate-700 dark:text-emerald-300 dark:hover:bg-slate-700">All ({total})</button>
                <button onClick={start} disabled={disabled} className={cx('px-5 py-2.5 rounded-lg font-semibold', disabled? 'bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-700 dark:text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-700')}>Start Quiz</button>
              </div>
            </div>
            {disabled && <div className="text-sm text-red-600 dark:text-red-400 mt-3">No questions available yet. Please add to your Google Sheet.</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Core Quiz ========= */
function Quiz({ category, bank, onFinish, customQuestions, opponent, battleMode, theme }) {
  const qs = customQuestions || bank[category] || []
  const [i, setI] = useState(0)
  const [sel, setSel] = useState(null)
  const [score, setScore] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(25)
  const [showFeedback, setShowFeedback] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [history, setHistory] = useState([])

  const q = qs[i]

  useEffect(() => { setSecondsLeft(25); const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000); return () => clearInterval(id) }, [i])
  useEffect(() => { if (secondsLeft <= 0 && q && !showFeedback && !advancing) { revealAndQueueNext(null) } }, [secondsLeft, showFeedback, advancing, q])
  useEffect(() => { if (i===0) updateStreakOnPlay() }, [])

  function nextQuestion() { if (i + 1 >= qs.length) { return onFinish({ score, total: qs.length, history, opponent, battleMode }) } setI((x) => x + 1); setSel(null); setShowFeedback(false); setAdvancing(false) }
  function revealAndQueueNext(chosenIndex) {
    if (!q || advancing) return
    setSel(chosenIndex); setShowFeedback(true); setAdvancing(true)
    const isCorrect = chosenIndex === q.answerIndex
    if (chosenIndex != null) setScore((s) => s + (isCorrect ? 1 : 0))
    setHistory((h) => [
      ...h,
      {
        id: q.id,
        text: q.text,
        options: q.options,
        answerIndex: q.answerIndex,
        correctIndex: q.answerIndex,
        chosenIndex,
        isCorrect,
        cat: q.cat,
      },
    ])
    bumpDailyDone(1); addXP(isCorrect ? 10 : 2)
    setTimeout(() => { nextQuestion() }, 2000)
  }

  const letters = ['a','b','c','d','e','f']

  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 pb-20 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => onFinish({ score, total: qs.length, history, aborted: true, opponent, battleMode })} className="text-slate-600 dark:text-slate-300">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">{battleMode ? 'Online Battle' : category}</div>
          <div className="flex items-center gap-2">
            <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
            <TimerRing secondsLeft={secondsLeft} totalSeconds={25} />
          </div>
        </div>
        {battleMode && opponent && (
          <div className="flex items-center gap-3 mb-2"><OppAvatar name={opponent.name} /><div><div className="text-[13px] md:text-[14px] font-semibold text-slate-800 dark:text-slate-100">{opponent.name}</div><div className="text-[12px] text-slate-500 dark:text-slate-400">{opponent.place}</div></div></div>
        )}
        <div className="text-[12px] md:text-[13px] text-slate-500 dark:text-slate-400 mb-2">Question <span className="font-semibold">{Math.min(i + 1, qs.length)}/{qs.length || 0}</span></div>
        <LinearProgress value={Math.min(i + 1, qs.length)} max={Math.max(1, qs.length)} />
        {!q ? (<Card className="p-4 mt-4 bg-white/90 dark:bg-slate-800/90"><div className="text-[14px] text-slate-700 dark:text-slate-300">No questions found.</div></Card>) : (
          <div className="grid md:grid-cols-2 md:items-start md:gap-4">
            <Card className="p-4 mt-4 mb-3 md:mb-0 bg-white/90 dark:bg-slate-800/90"><div className="text-[14px] md:text-[15px] font-semibold text-slate-800 dark:text-slate-100">{q.text}</div></Card>
            <div className="mt-2 md:mt-4">
              {q.options.map((opt, idx) => (
                <div key={idx} onClick={() => { if (showFeedback || advancing) return; revealAndQueueNext(idx) }}>
                  <OptionButton letter={letters[idx]} label={opt} disabled={showFeedback || advancing} isSelected={sel === idx} showFeedback={showFeedback} isCorrect={showFeedback && idx === q.answerIndex} isWrong={showFeedback && sel === idx && idx !== q.answerIndex} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="fixed bottom-4 left-0 right-0"><div className="mx-auto max-w-5xl px-4 md:px-6"><button className="w-full py-3 md:py-3.5 rounded-xl text-white font-semibold bg-emerald-300 cursor-not-allowed dark:bg-emerald-800/60" disabled>Next</button></div></div>
      </div>
    </div>
  )
}

/* ========= Results / OMR Review ========= */
function OMRRow({ index, q, reveal }){
  const letters = ['A','B','C','D','E','F']
  const hasChoice = q.chosenIndex != null && q.chosenIndex >= 0
  const correctIdx = (typeof q.answerIndex === 'number') ? q.answerIndex : (typeof q.correctIndex === 'number' ? q.correctIndex : -1)
  const chosenLetter = hasChoice ? (letters[q.chosenIndex] || '') : '—'
  const chosenText = hasChoice ? (q.options?.[q.chosenIndex] || '') : ''
  const correctLetter = correctIdx >= 0 ? (letters[correctIdx] || '') : ''
  const correctText = correctIdx >= 0 ? (q.options?.[correctIdx] || '') : ''
  const isRight = hasChoice && q.chosenIndex === correctIdx
  const chosenDisplay = hasChoice ? `${chosenLetter}. ${chosenText}` : '—'
  const correctDisplay = correctIdx >= 0 ? `${correctLetter}. ${correctText}` : '—'
  return (
    <tr className="border-b last:border-0 border-slate-200 dark:border-slate-700">
      <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">{index+1}</td>
      <td className="py-2 pr-2 text-slate-800 dark:text-slate-100">{q.text}</td>
      <td className="py-2 pr-2 text-slate-800 dark:text-slate-100">{chosenDisplay}</td>
      <td className={cx('py-2 pr-2', isRight?'text-green-700 dark:text-green-300':'text-red-600 dark:text-red-300')}>{reveal ? correctDisplay : '•'}</td>
    </tr>
  )
}

function Results({ data, onHome, onRestart, theme }){
  const { score, total, history, opponent, battleMode } = data
  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 pb-16 pt-6">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onHome} className="text-slate-600 dark:text-slate-300">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">{battleMode ? 'Battle Summary' : 'Quiz Summary'}</div>
          <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
        </div>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-700 dark:text-slate-300">Score</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{score} / {total}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={onRestart} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">Retry</button>
              <button onClick={onHome} className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-slate-700 dark:text-slate-200">Home</button>
            </div>
          </div>
        </Card>

        <Card className="p-4 mt-4">
          <div className="text-[15px] md:text-[16px] font-semibold mb-2 text-slate-900 dark:text-slate-100">OMR Review</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 dark:text-slate-400"><th className="text-left">#</th><th className="text-left">Question</th><th className="text-left">Marked Answer</th><th className="text-left">Correct Answer</th></tr></thead>
              <tbody>
                {history.map((q, idx)=> <OMRRow key={idx} index={idx} q={q} reveal />)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Simple List (Study / Exams / Syllabus / Answer Key / Bulletin) ========= */
function SimpleList({ title, items, onBack, theme }){
  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 pb-16 pt-6">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="text-slate-600 dark:text-slate-300">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">{title}</div>
          <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
        </div>
        <div className="grid gap-3">
          {items.map((it,idx)=> (
            <Card key={idx} className="p-4">
              <div className="font-semibold text-slate-800 dark:text-slate-100">{it.title}</div>
              {it.desc && <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">{it.desc}</div>}
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex flex-wrap gap-3">
                {it.date && <span>🗓 {it.date}</span>}
                {it.duration && <span>⏱ {it.duration}</span>}
                {it.questions && <span>❓ {it.questions} Qs</span>}
                {it.url && <a href={it.url} target="_blank" className="text-emerald-700 underline dark:text-emerald-300">Open</a>}
              </div>
            </Card>
          ))}
          {items.length===0 && <Card className="p-4 text-sm text-slate-600 dark:text-slate-400">Nothing to show.</Card>}
        </div>
      </div>
    </div>
  )
}

/* ========= Mock Setup ========= */
function MockSetup({ bank, onStart, onBack, theme }){
  const cats = Object.keys(bank)
  const [sections, setSections] = useState(cats.slice(0,3).map((c)=>({ name:c, count:10, cutoff:30 })))
  const [duration, setDuration] = useState(60)
  const [title, setTitle] = useState('Full Mock Test')

  function addSection(){ if (sections.length>=5) return; const cand = cats.find(c=> !sections.find(s=>s.name===c)); if(!cand) return; setSections([...sections, {name:cand, count:10, cutoff:30}]) }
  function removeSection(i){ setSections(sections.filter((_,idx)=> idx!==i)) }
  function start(){
    const flat = flattenBank(bank)
    const wanted = sections.flatMap((s)=> sampleMany(flat.filter(q=> q.cat===s.name), s.count))
    const picked = wanted.map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat }))
    onStart({ title, duration, sections, customQuestions: picked })
  }

  return (
    <div className="min-h-dvh bg-[#eefbe7] dark:bg-slate-900">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-12 pt-6">
        <div className="flex items-center justify-between mb-3"><button onClick={onBack} className="text-slate-600 dark:text-slate-300">←</button><div className="text-[15px] md:text-[17px] font-semibold text-slate-900 dark:text-slate-100">Mock Exam Setup</div><ThemeToggle dark={theme.dark} onToggle={theme.toggle} /></div>
        <Card className="p-4">
          <div className="grid gap-3">
            <div>
              <label className="text-sm text-slate-600 dark:text-slate-300">Title</label>
              <input value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-600 dark:text-slate-300">Duration (minutes)</label>
                <input type="number" min={15} max={180} value={duration} onChange={(e)=>setDuration(Number(e.target.value)||60)} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"/>
              </div>
              <div className="flex items-end"><button onClick={addSection} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">Add Section</button></div>
            </div>
            <div className="space-y-2">
              {sections.map((s,idx)=> (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-5">
                    <label className="text-sm text-slate-600 dark:text-slate-300">Section Category</label>
                    <select value={s.name} onChange={(e)=>{ const name=e.target.value; const next=[...sections]; next[idx]={...s,name}; setSections(next) }} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100">
                      {cats.map((c)=> <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-sm text-slate-600 dark:text-slate-300">Questions</label>
                    <input type="number" min={5} max={100} value={s.count} onChange={(e)=>{ const count = clamp(Number(e.target.value)||10, 5, 100); const next=[...sections]; next[idx]={...s,count}; setSections(next) }} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"/>
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-sm text-slate-600 dark:text-slate-300">Section Cutoff (%)</label>
                    <input type="number" min={0} max={100} value={s.cutoff} onChange={(e)=>{ const cutoff = clamp(Number(e.target.value)||30, 0, 100); const next=[...sections]; next[idx]={...s,cutoff}; setSections(next) }} className="w-full mt-1 px-3 py-2 border border-emerald-200 rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"/>
                  </div>
                  <div className="md:col-span-1 text-right"><button onClick={()=>removeSection(idx)} className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-slate-700">✕</button></div>
                </div>
              ))}
            </div>
            <div className="text-right"><button onClick={start} className="px-4 py-2 rounded-lg bg-emerald-600 text-white">Start Mock</button></div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Root App ========= */
export default function App(){
  const theme = useTheme()

  const [ready, setReady] = useState(false)
  const [topicBank, setTopicBank] = useState({})
  const [examBank, setExamBank] = useState({})
  const [studyList, setStudyList] = useState([])
  const [examList, setExamList] = useState([])
  const [syllabusList, setSyllabusList] = useState([]) // NEW
  const [answerKeyList, setAnswerKeyList] = useState([]) // NEW
  const [bulletinList, setBulletinList] = useState([]) // NEW
  const [view, setView] = useState('splash')
  const [current, setCurrent] = useState(null)
  const [recent, setRecent] = useState(()=> { try{ return JSON.parse(localStorage.getItem('recent_items')||'[]') } catch { return [] } })

  useEffect(()=>{ (async()=>{
    try{
      const [topics, exams, study, notices, syllabus, answerKeys, bulletins] = await Promise.all([
        loadTopicBank(),
        loadExamBank(),
        loadList(TAB_STUDY),
        loadList(TAB_EXAMS),
        loadSyllabusList(),   // NEW
        loadAnswerKeyList(),  // NEW
        loadBulletinList(),   // NEW
      ])
      setTopicBank(topics)
      setExamBank(exams)
      setStudyList(study)
      setExamList(notices)
      setSyllabusList(syllabus)
      setAnswerKeyList(answerKeys)
      setBulletinList(bulletins)
    }finally{ setReady(true); setView('home') }
  })() }, [])

  function pushRecent(item){ const next=[item, ...recent.filter(x=> (typeof x==='string'? x: x.name)!==(typeof item==='string'? item: item.name))].slice(0,6); setRecent(next); localStorage.setItem('recent_items', JSON.stringify(next)) }

  let content = <Splash />
  if(ready){
    if(view==='home') content = (
      <Home
        topicBank={topicBank}
        examBank={examBank}
        onStartTopic={(c)=>{ setCurrent({ category:c, battleMode:false }); setView('quiz') ; pushRecent(c) }}
        onStartExam={(c)=>{ setCurrent({ category:c, battleMode:false }); setView('quiz'); pushRecent({kind:'exam', name:c}) }}
        onSeeAllTopics={()=> setView('allTopics')}
        onSeeAllExams={()=> setView('allExams')}
        onStartBattle={()=> setView('battleSearch')}
        onQuick={()=> setView('quick')}
        openStudy={()=> setView('study')}
        openExams={()=> setView('exams')}
        openSyllabus={()=> setView('syllabus')}
        openAnswerKey={()=> setView('answerKey')}
        openBulletin={()=> setView('bulletin')}
        recent={recent}
        toMock={()=> setView('mockSetup')}
        toProfile={()=> alert('Profile screen coming soon 🙂')}
        theme={theme}
      />
    )
    else if(view==='allTopics') content = <AllCategories title="All Topic Categories" bank={topicBank} onStart={(c)=>{ setCurrent({ category:c, battleMode:false }); setView('quiz') }} onBack={()=> setView('home')} theme={theme} />
    else if(view==='allExams') content = <AllCategories title="All Exam Categories" bank={examBank} onStart={(c)=>{ setCurrent({ category:c, battleMode:false }); setView('quiz') }} onBack={()=> setView('home')} theme={theme} />
    else if(view==='battleSearch') content = <BattleSearch onMatched={()=>{ const opp = randomOpponent(); const all = flattenBank(mergeBanks(topicBank, examBank)); const picked = sampleMany(all, BATTLE_QUESTION_COUNT).map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat })); setCurrent({ customQuestions:picked, category:'Battle', battleMode:true, opponent:opp }); setView('quiz') }} theme={theme} />
    else if(view==='quick') content = <QuickSetup bank={mergeBanks(topicBank, examBank)} onStart={(picked)=>{ setCurrent({ customQuestions:picked, category:'Quick Quiz', battleMode:false }); setView('quiz') }} onBack={()=> setView('home')} theme={theme} />
    else if(view==='study') content = <SimpleList title="Study Material" items={studyList} onBack={()=> setView('home')} theme={theme} />
    else if(view==='exams') content = <SimpleList title="Exam Notifications" items={examList} onBack={()=> setView('home')} theme={theme} />
    else if(view==='syllabus') content = <SimpleList title="Syllabus" items={syllabusList} onBack={()=> setView('home')} theme={theme} />
    else if(view==='answerKey') content = <SimpleList title="Answer Key" items={answerKeyList} onBack={()=> setView('home')} theme={theme} />
    else if(view==='bulletin') content = <SimpleList title="PSC Bulletin" items={bulletinList} onBack={()=> setView('home')} theme={theme} />
    else if(view==='mockSetup') content = <MockSetup bank={mergeBanks(topicBank, examBank)} onStart={({ customQuestions })=>{ setCurrent({ customQuestions, category:'Mock Exam', battleMode:false }); setView('quiz') }} onBack={()=> setView('home')} theme={theme} />
    else if(view==='quiz') content = <Quiz category={current?.category} bank={mergeBanks(topicBank, examBank)} customQuestions={current?.customQuestions} opponent={current?.opponent} battleMode={current?.battleMode} onFinish={(data)=>{ setCurrent(data); setView('results') }} theme={theme} />
    else if(view==='results') content = <Results data={current} onHome={()=> setView('home')} onRestart={()=>{ if(current?.battleMode){ setView('battleSearch') } else if(current?.category==='Quick Quiz'){ setView('quick') } else { setView('home') } }} theme={theme} />
  }

  // IMPORTANT: Local wrapper ensures dark mode always flips even if <html> is modified elsewhere.
  return <div className={theme.dark ? 'dark' : ''}>{content}</div>
}
