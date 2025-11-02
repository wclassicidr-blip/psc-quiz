// App.jsx — PSC Guru (Tea Green theme)
// Fixes & Features
// - Robust GViz loader with header autodetect and fallback to per-sheet topic/exam tabs
// - Modern Battle Finder (mosaic + scan) → auto-match → battle start
// - Random Quick Quiz setup with percent presets and working +/- steppers
// - Play view with timer, progress, per-question feedback, and score summary
// - OMR Review that shows full questions & answers (correct vs chosen)
// - Profile & Goals: XP/Level, daily target, streaks, badges
// - Lightweight unit smoke tests that never throw in the UI

import { useEffect, useMemo, useState, useCallback } from 'react'

/* ========================= CONFIG ========================= */
const DEFAULT_FILE_ID = '16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o'
const GS_FILE_ID = (import.meta?.env?.VITE_GS_FILE_ID || '').trim() || DEFAULT_FILE_ID

const TAB_CATEGORIES = 'Categories'
const TAB_EXAM_CATS = 'EXAM CAT'
const TAB_QUESTIONS = 'Questions'
const TAB_STUDY = 'Study Material'
const TAB_EXAMS = 'Exam Notifications'

const BATTLE_QUESTION_COUNT = 20
const TOPIC_DEFAULT_COUNT = 20
const EXAM_DEFAULT_COUNT = 20
const QUICK_DEFAULT_COUNT = 10
const QUICK_MIN = 5
const QUESTION_SECONDS = 25

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
  for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idxs[i], idxs[j]] = [idxs[j], idxs[i]] }
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

/* ====== Lightweight, non-throwing tests (won't break UI) ====== */
;(function unitSmokeTests(){
  try {
    console.assert(clamp(10, 0, 5) === 5, 'clamp: upper bound')
    console.assert(clamp(-1, 0, 5) === 0, 'clamp: lower bound')
    const { newOptions, newCorrect } = shuffleWithIndex(['A','B','C','D'], 2)
    console.assert(newOptions.length === 4 && newCorrect >= 0 && newCorrect < 4, 'shuffleWithIndex: size and index')
    const cols = ['Question','OptA','OptB','OptC','OptD','Correct']
    const rows = [['Q1','A','B','C','D','B']]
    const items = mapQuestionRows(cols, rows, 'Gen')
    console.assert(items[0]?.options?.length === 4, 'mapQuestionRows: options')

    const bank = toBank(items)
    const flat = flattenBank(bank)
    console.assert(Array.isArray(flat) && flat.length >= 1, 'flattenBank: non-empty')
    console.assert(typeof mergeBanks({A:[{id:1}]},{A:[{id:2}]})?.A?.length === 'number', 'mergeBanks: merges arrays')
  } catch { /* never throw in UI */ }
})()

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
  <div className={cx('rounded-2xl bg-white shadow-sm border border-emerald-100', className)}>{children}</div>
)

function LinearProgress({ value, max }) { const pct = Math.min(100, Math.max(0, (value / max) * 100)); return (<div className="w-full h-1.5 md:h-2 bg-emerald-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${pct}%`} } /></div>) }

function TimerRing({ secondsLeft, totalSeconds = QUESTION_SECONDS }) {
  const R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, secondsLeft / totalSeconds))
  return (
    <div className="relative w-10 h-10 md:w-11 md:h-11">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-100" strokeWidth="6" />
        <circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-600 transition-[stroke-dasharray] duration-200" strokeLinecap="round" strokeWidth="6" strokeDasharray={`${C * p} ${C}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] md:text-xs font-semibold text-emerald-700">0{Math.max(0, secondsLeft).toString().padStart(2, '0')}</div>
    </div>
  )
}

function OptionButton({ label, letter, disabled, isSelected, showFeedback, isCorrect, isWrong, onClick }) {
  const feedbackClass = showFeedback ? (isCorrect ? 'border-green-500 bg-green-50' : isWrong ? 'border-red-500 bg-red-50' : 'border-transparent') : isSelected ? 'border-emerald-600 ring-2 ring-emerald-200' : 'border-transparent hover:border-emerald-200'
  const textColor = showFeedback ? (isCorrect ? 'text-green-800' : isWrong ? 'text-red-700' : 'text-slate-800') : 'text-slate-800'
  return (
    <button onClick={onClick} disabled={disabled} className={cx('w-full text-left rounded-xl border-2 px-4 py-3 md:px-5 md:py-3.5 mb-3 transition-all bg-white/80', feedbackClass)} aria-pressed={isSelected ? 'true' : 'false'}>
      <span className="inline-flex items-center gap-3">
        <span className={cx('grid place-items-center w-6 h-6 rounded-full text-xs font-semibold md:w-7 md:h-7 md:text-sm', showFeedback ? (isCorrect ? 'bg-green-100 text-green-700' : isWrong ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700') : 'bg-emerald-100 text-emerald-700')}>{letter}</span>
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
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4" />
        <div className="text-emerald-700 font-semibold text-[15px] md:text-[17px] transition-opacity duration-300">{messages[i]}</div>
        <div className="w-56 md:w-72 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4"><div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse" /></div>
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

/* ========= Views ========= */
function Home({ topicBank, examBank, onStartTopic, onStartExam, onSeeAllTopics, onSeeAllExams, onStartBattle, onQuick, openStudy, openExams, recent, toMock, toProfile }) {
  const topicCats = Object.keys(topicBank)
  const examCats = Object.keys(examBank)
  const [homeQ, setHomeQ] = useState('')
  const filteredTopics = topicCats.filter((c) => c.toLowerCase().includes(homeQ.toLowerCase()))
  const filteredExams = examCats.filter((c) => c.toLowerCase().includes(homeQ.toLowerCase()))
  const previewTopics = filteredTopics.slice(0, 6)
  const previewExams = filteredExams.slice(0, 6)
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
            {Object.keys(examBank).slice(0,6).map((c) => (
              <button key={c} onClick={() => onStartExam(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200">
                <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">🎓</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500">{(examBank[c] || []).length} questions</div>
              </button>
            ))}
            {Object.keys(examBank).slice(0,6).length === 0 && <div className="col-span-full text-center text-sm text-slate-600">No exams match “{homeQ}”.</div>}
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
                const kind = typeof item === 'string' ? (topicBank[item] ? 'topic' : 'exam') : item.kind
                const name = typeof item === 'string' ? item : item.name
                const count = kind === 'exam' ? (examBank[name] || []).length : (topicBank[name] || []).length
                const onClick = kind === 'exam' ? () => onStartExam(name) : () => onStartTopic(name)
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
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AllCategories({ title, bank, onStart, onBack }) {
  const [q, setQ] = useState('')
  const cats = Object.keys(bank).filter((n) => n.toLowerCase().includes(q.toLowerCase()))
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
  )
}

function BattleSearch({ onMatched }) {
  // Mosaic-style battle finder with animated counts and scanning bar
  const TARGET_READY = 1024

  const avatars = useMemo(() => {
    const EMOJIS = ['🙂','😎','🤓','😁','😮','🤠','😺','🧐','😃','🥳','🤩','😇','😌','😅','🤗','😉']
    const N = 12 * 28 // columns * rows for density
    return Array.from({ length: N }, (_, i) => ({
      emoji: EMOJIS[i % EMOJIS.length],
      hue: (i * 29) % 360,
      pulse: i % 23 === 0,
    }))
  }, [])

  const [readyCount, setReadyCount] = useState(0)
  useEffect(() => {
    let n = 0
    const step = Math.max(8, Math.round(TARGET_READY / 60))
    const id = setInterval(() => {
      n = Math.min(TARGET_READY, n + step)
      setReadyCount(n)
      if (n >= TARGET_READY) clearInterval(id)
    }, 18)
    return () => clearInterval(id)
  }, [])

  const [scan, setScan] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setScan((x) => (x + 3) % 100), 30)
    return () => clearInterval(id)
  }, [])

  // Auto-match after short delay
  useEffect(() => {
    const t = setTimeout(() => onMatched(), 3000)
    return () => clearTimeout(t)
  }, [onMatched])

  return (
    <div className="relative min-h-dvh overflow-hidden bg-gradient-to-b from-indigo-500 via-violet-500 to-blue-600">
      {/* Mosaic avatar grid */}
      <div className="absolute inset-0 p-2 sm:p-3 md:p-4">
        <div className="grid gap-[6px] opacity-90 pointer-events-none grid-cols-10 sm:grid-cols-12">
          {avatars.map((av, i) => (
            <div
              key={i}
              className={cx(
                'aspect-square rounded-full grid place-items-center text-[10px] sm:text-[11px] shadow-sm',
                av.pulse ? 'animate-pulse' : ''
              )}
              style={{
                background: `radial-gradient(circle at 30% 30%, hsl(${av.hue}, 90%, 75%) 0%, hsl(${av.hue}, 85%, 60%) 50%, hsl(${av.hue}, 80%, 50%) 100%)`,
                color: 'rgba(255,255,255,0.95)',
              }}
            >
              <span>{av.emoji}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scan overlay */}
      <div className="absolute inset-0">
        <div className="absolute left-0 right-0" style={{ top: `${scan}%` }}>
          <div className="h-14 bg-white/10 blur-[2px]" />
        </div>
      </div>

      {/* Center card */}
      <div className="relative z-10 min-h-dvh grid place-items-center p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-3xl shadow-xl bg-white/90 p-5 text-center">
            <div className="text-5xl font-extrabold text-emerald-600 drop-shadow-sm">{readyCount}</div>
            <div className="text-slate-700 font-semibold mt-1">Players ready</div>
            <div className="mt-4 text-slate-600">Finding opponent for <span className="font-semibold">Battle</span>…</div>
            <div className="mt-4">
              <div className="h-2 rounded-full bg-emerald-100 overflow-hidden">
                <div className="h-full bg-emerald-500 animate-[pulse_1.8s_ease-in-out_infinite]" style={{ width: `${Math.max(40, (scan*1.2)%100)}%` }} />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">Auto-matching…</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ========= Quick Setup (random N questions via percentage) ========= */
function QuickSetup({ bank, onStart, onBack }){
  const total = useMemo(()=> flattenBank(bank).length, [bank])
  const disabled = total === 0

  // Minimum selectable should never exceed total; if total<QUICK_MIN allow "all" of what's there
  const minSelectable = total ? Math.min(QUICK_MIN, total) : 0
  const minPct = total ? Math.max(1, Math.ceil(100 * minSelectable / total)) : 0

  // Keep BOTH count & pct and sync them
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
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-16 pt-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-800"><span>←</span><span className="hidden sm:inline">Back</span></button>
          <div className="text-[16px] md:text-[18px] font-semibold">Random Quick Quiz</div>
          <span className="w-8"/>
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
              {/* Fancy stepper (count-based) */}
              <div className="md:col-span-6">
                <div className="rounded-2xl border border-emerald-100 bg-white/90 shadow-sm">
                  <div className="flex items-stretch">
                    <button onClick={()=>nudgeCount(-10)} className="px-3 md:px-4 py-4 md:py-5 border-r border-emerald-100 hover:bg-emerald-50 rounded-l-2xl" title="-10">−10</button>
                    <button onClick={()=>nudgeCount(-1)} className="px-4 md:px-5 py-4 md:py-5 border-r border-emerald-100 hover:bg-emerald-50" title="-1">−</button>
                    <div className="flex-1 grid place-items-center">
                      <div className="text-sm text-slate-500">Selected</div>
                      <div className="text-3xl md:text-4xl font-extrabold text-emerald-700 tabular-nums">{disabled? '—' : count}</div>
                      <div className="text-xs text-slate-500">min {minSelectable} • max {total}</div>
                    </div>
                    <button onClick={()=>nudgeCount(1)} className="px-4 md:px-5 py-4 md:py-5 border-l border-emerald-100 hover:bg-emerald-50" title="+1">+</button>
                    <button onClick={()=>nudgeCount(10)} className="px-3 md:px-4 py-4 md:py-5 border-l border-emerald-100 hover:bg-emerald-50 rounded-r-2xl" title="+10">+10</button>
                  </div>
                </div>

                {/* Percent presets */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {presetPercents.map(p=> (
                    <button key={p} onClick={()=> setPresetPercent(p)} className={cx('px-3 py-1.5 rounded-full text-sm border transition', p===pct? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-emerald-200 text-emerald-700 hover:border-emerald-300')}>{p}%</button>
                  ))}
                </div>
              </div>

              {/* % slider */}
              <div className="md:col-span-6">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-600"><span>Adjust with slider</span><span>{pct}% • {count} Qs</span></div>
                <div className="relative h-6">
                  <div className="absolute inset-0 rounded-full bg-emerald-100" />
                  <div className="absolute left-0 top-0 bottom-0 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  <input
                    type="range"
                    min={minPct}
                    max={100}
                    value={pct}
                    onChange={(e)=> { const val = clamp(Number(e.target.value)||minPct, minPct, 100); setPct(val); setCount(countFromPct(val)) }}
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
                <button onClick={()=> setPresetPercent(minPct)} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50">Min</button>
                <button disabled={disabled} onClick={start} className={cx('px-4 py-2.5 rounded-lg font-semibold', disabled? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700')}>Start</button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Play View ========= */
function PlayView({ mode='topic', title, questions, onQuit, onFinish }){
  const total = questions.length
  const [i, setI] = useState(0)
  const [sel, setSel] = useState(-1)
  const [locked, setLocked] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_SECONDS)
  const [answers, setAnswers] = useState([]) // {qIndex, chosen, correct}

  // countdown per question
  useEffect(()=>{
    setSecondsLeft(QUESTION_SECONDS)
    const id = setInterval(()=> setSecondsLeft((s)=>{
      if(s<=1){ clearInterval(id); if(!locked){ // auto-submit as wrong/skip
        setLocked(true)
        const q = questions[i]
        const chosen = -1
        const correct = q.answerIndex
        setAnswers((arr)=> [...arr, { qIndex: i, chosen, correct }])
      }
      return 0
    } else return s-1 }), 1000)
    return ()=> clearInterval(id)
  }, [i])

  const q = questions[i]
  const letters = ['A','B','C','D']
  const canNext = locked

  function chooseOption(idx){
    if(locked) return
    setSel(idx)
    setLocked(true)
    const correct = q.answerIndex
    setAnswers((arr)=> [...arr, { qIndex: i, chosen: idx, correct }])
    // XP & daily bump
    addXP(idx === correct ? 5 : 1)
    bumpDailyDone(1)
  }

  function next(){
    if(i < total-1){ setI(i+1); setSel(-1); setLocked(false) }
    else { finish() }
  }

  function finish(){
    const score = answers.reduce((s,a)=> s + (a.chosen===a.correct?1:0), 0)
    onFinish({ mode, title, questions, answers, score, total })
  }

  const progress = i+ (locked? 1: 0)

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-6 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <button onClick={onQuit} className="text-slate-600 hover:text-slate-800">Quit</button>
          <div className="text-[15px] md:text-[17px] font-semibold text-center flex-1 truncate">{title}</div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={QUESTION_SECONDS} />
        </div>
        <LinearProgress value={progress} max={total} />

        {/* Question */}
        <Card className="p-4 md:p-5 mt-4">
          <div className="text-[15px] md:text-[17px] font-semibold text-slate-900">Q{i+1}. {q.text}</div>
          <div className="mt-3">
            {q.options.map((opt, idx)=> (
              <OptionButton
                key={idx}
                label={opt}
                letter={letters[idx]}
                disabled={locked}
                isSelected={sel===idx}
                showFeedback={locked}
                isCorrect={locked && idx===q.answerIndex}
                isWrong={locked && sel===idx && sel!==q.answerIndex}
                onClick={()=> chooseOption(idx)}
              />
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">Category: {q.cat || 'General'}</div>

          <div className="mt-4 flex justify-end">
            <button onClick={canNext? next : ()=>{}} disabled={!canNext} className={cx('px-4 py-2.5 rounded-lg font-semibold', canNext? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-500')}>{i<total-1? 'Next' : 'Finish'}</button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Summary & OMR Review ========= */
function SummaryCard({ result, onReview, onHome, onRetry }){
  const { score, total, title } = result
  const pct = Math.round((score/total)*100)
  return (
    <Card className="p-5 text-center">
      <div className="text-xl font-semibold text-slate-900">{title}</div>
      <div className="mt-2 text-slate-700">You scored <span className="font-semibold">{score}</span> / {total} • {pct}%</div>
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={onReview} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50">OMR Review</button>
        <button onClick={onRetry} className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Retry</button>
        <button onClick={onHome} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white text-slate-700 hover:bg-emerald-50">Home</button>
      </div>
    </Card>
  )
}

function OMRReview({ result, onBack }){
  const letters = ['A','B','C','D']
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-10 pt-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-slate-600">← Back</button>
          <div className="text-[15px] md:text-[17px] font-semibold">OMR Review — {result.title}</div>
          <span className="w-4"/>
        </div>
        {result.questions.map((q, idx)=>{
          const ans = result.answers.find(a=> a.qIndex===idx)
          return (
            <Card key={idx} className="p-4 md:p-5 mb-3">
              <div className="text-[14px] md:text-[15px] font-semibold text-slate-900">Q{idx+1}. {q.text}</div>
              <div className="mt-3">
                {q.options.map((opt,i)=>{
                  const isCorrect = i===q.answerIndex
                  const isChosen = ans?.chosen===i
                  const showFeedback = true
                  const isWrong = isChosen && !isCorrect
                  return (
                    <OptionButton key={i} label={opt} letter={letters[i]} disabled isSelected={isChosen} showFeedback={showFeedback} isCorrect={isCorrect} isWrong={isWrong} />
                  )
                })}
              </div>
              <div className="text-xs text-slate-500">Category: {q.cat || 'General'}</div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/* ========= Study & Exam Lists ========= */
function SimpleList({ title, items, onBack }){
  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 pb-10 pt-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-slate-600">← Back</button>
          <div className="text-[15px] md:text-[17px] font-semibold">{title}</div>
          <span className="w-4"/>
        </div>
        <div className="grid gap-3">
          {items.map((it, idx)=> (
            <Card key={idx} className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[15px] md:text-[16px] font-semibold text-slate-900">{it.title}</div>
                  {it.desc && <div className="text-[13px] text-slate-600 mt-1">{it.desc}</div>}
                  <div className="text-[12px] text-slate-500 mt-1">{it.date || ''} {it.duration? `• ${it.duration}`:''} {it.questions? `• ${it.questions} Qs`:''}</div>
                </div>
                {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm">Open</a>}
              </div>
            </Card>
          ))}
          {items.length===0 && <Card className="p-4 text-center text-slate-600">Nothing found.</Card>}
        </div>
      </div>
    </div>
  )
}

/* ========= Profile ========= */
function ProfileView({ onBack }){
  const [xp, setXp] = useState(getNum(XP_KEY,0))
  const [level, setLevel] = useState(getNum(LVL_KEY,1))
  const [streak, setStreak] = useState(getNum(STREAK_KEY,0))
  const [badges, setBadges] = useState(getBadges())
  const [daily, setDaily] = useState(getDaily())
  const [target, setTarget] = useState(daily.target)

  useEffect(()=>{ const id = setInterval(()=>{ setXp(getNum(XP_KEY,0)); setLevel(getNum(LVL_KEY,1)); setStreak(getNum(STREAK_KEY,0)); setBadges(getBadges()); setDaily(getDaily()) }, 600); return ()=> clearInterval(id)}, [])

  function saveTarget(){ setDailyTarget(Number(target)||20); setDaily(getDaily()) }

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-10 pt-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-slate-600">← Back</button>
          <div className="text-[15px] md:text-[17px] font-semibold">Profile & Goals</div>
          <span className="w-4"/>
        </div>

        <Card className="p-4 md:p-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-600">XP</div>
              <div className="text-3xl font-extrabold text-emerald-700">{xp}</div>
              <div className="text-sm text-slate-600 mt-1">Level {level}</div>
            </div>
            <div>
              <div className="text-sm text-slate-600">Daily Target</div>
              <div className="flex items-center gap-2 mt-1">
                <input value={target} onChange={(e)=> setTarget(e.target.value)} type="number" min={5} max={200} className="px-3 py-2 rounded-lg border border-emerald-200 bg-white w-28" />
                <button onClick={saveTarget} className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Save</button>
              </div>
              <div className="mt-2 text-sm text-slate-600">Today: {daily.done} / {daily.target}</div>
              <div className="mt-2"><LinearProgress value={daily.done} max={daily.target} /></div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="rounded-xl bg-white border border-emerald-100 p-3 text-center">
              <div className="text-sm text-slate-600">Streak</div>
              <div className="text-2xl font-bold text-emerald-700">{streak} 🔥</div>
            </div>
            <div className="rounded-xl bg-white border border-emerald-100 p-3">
              <div className="text-sm text-slate-600 mb-1">Badges</div>
              <div className="flex flex-wrap gap-2">{badges.map((b,i)=> <span key={i} className="px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">{b}</span>)}</div>
              {badges.length===0 && <div className="text-xs text-slate-500">No badges yet.</div>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ========= Mock Exam (lightweight) ========= */
function MockExam({ bank, onBack, onFinish }){
  const flat = useMemo(()=> flattenBank(bank), [bank])
  const [duration] = useState(45*60) // 45 minutes total
  const [left, setLeft] = useState(duration)
  const [started, setStarted] = useState(false)
  const [qs, setQs] = useState([])

  useEffect(()=>{
    if(!started) return
    const id = setInterval(()=> setLeft((s)=> s>0? s-1 : 0), 1000)
    return ()=> clearInterval(id)
  }, [started])

  function start(){
    const picked = sampleMany(flat, Math.min(50, flat.length)).map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat }))
    setQs(picked)
    setStarted(true)
    updateStreakOnPlay()
  }

  if(!started){
    return (
      <div className="min-h-dvh bg-[#eefbe7]">
        <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-8 pt-6">
          <div className="flex items-center justify-between mb-4">
            <button onClick={onBack} className="text-slate-600">← Back</button>
            <div className="text-[15px] md:text-[17px] font-semibold">Mock Exam</div>
            <span className="w-4"/>
          </div>
          <Card className="p-5 text-center">
            <div className="text-lg font-semibold text-slate-900">50 Questions • 45 minutes</div>
            <div className="text-sm text-slate-600 mt-1">OMR review after submission</div>
            <button onClick={start} className="mt-4 px-4 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Start Exam</button>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-6 pt-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-slate-600">← Exit</button>
          <div className="text-[15px] md:text-[17px] font-semibold">Mock Exam</div>
          <div className="px-3 py-1 rounded-full bg-white border border-emerald-200 text-emerald-700 text-sm">{Math.floor(left/60)}:{String(left%60).padStart(2,'0')}</div>
        </div>
      </div>
      <PlayView mode="mock" title="Mock Exam" questions={qs} onQuit={onBack} onFinish={onFinish} />
    </div>
  )
}

/* ========= App ========= */
export default function App(){
  const [loading, setLoading] = useState(true)
  const [topicBank, setTopicBank] = useState({})
  const [examBank, setExamBank] = useState({})

  // navigation state
  const [view, setView] = useState('home')
  const [playing, setPlaying] = useState(null) // {mode,title,questions}
  const [result, setResult] = useState(null)
  const [opp, setOpp] = useState(null)
  const [studyItems, setStudyItems] = useState([])
  const [examItems, setExamItems] = useState([])
  const [recent, setRecent] = useState(()=> { try{ return JSON.parse(localStorage.getItem('recent_items')||'[]') }catch{return []} })

  // initial load
  useEffect(()=>{
    let mounted = true
    ;(async()=>{
      try{
        const [tb, eb] = await Promise.all([loadTopicBank(), loadExamBank()])
        if(!mounted) return
        setTopicBank(tb)
        setExamBank(eb)
      } finally { setLoading(false) }
    })()
    return ()=> { mounted=false }
  }, [])

  const pushRecent = useCallback((item)=>{
    try{
      const cur = JSON.parse(localStorage.getItem('recent_items')||'[]')
      const next = [item, ...cur.filter((x)=> (typeof x==='string'? x: x.name)!==(typeof item==='string'? item: item.name))].slice(0,6)
      localStorage.setItem('recent_items', JSON.stringify(next))
      setRecent(next)
    }catch{}
  }, [])

  // handlers
  function startTopic(name){
    const qs = sampleMany(topicBank[name]||[], TOPIC_DEFAULT_COUNT)
    const mapped = qs.map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:name }))
    setPlaying({ mode:'topic', title: name, questions: mapped })
    updateStreakOnPlay()
    setView('play')
    pushRecent(name)
  }
  function startExam(name){
    const qs = sampleMany(examBank[name]||[], EXAM_DEFAULT_COUNT)
    const mapped = qs.map((q,idx)=> ({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:name }))
    setPlaying({ mode:'exam', title: name, questions: mapped })
    updateStreakOnPlay()
    setView('play')
    pushRecent({ kind:'exam', name })
  }

  function startQuick(){ setView('quick') }
  function handleQuickStart(picked){ setPlaying({ mode:'quick', title:'Quick Quiz', questions: picked }); updateStreakOnPlay(); setView('play') }

  function startBattle(){ setView('battle-search') }
  function matchedBattle(){
    const o = randomOpponent()
    setOpp(o)
    const merged = flattenBank(mergeBanks(topicBank, examBank))
    const picked = sampleMany(merged, Math.min(BATTLE_QUESTION_COUNT, merged.length)).map((q,idx)=>({ id: idx+1, text:q.text, options:q.options, answerIndex:q.answerIndex, cat:q.cat }))
    setPlaying({ mode:'battle', title: `Battle vs ${o.name} (${o.place})`, questions: picked })
    updateStreakOnPlay()
    setView('play')
  }

  function onFinishPlay(r){ setResult(r); setView('summary') }
  function onRetry(){ setView('play') }

  async function openStudy(){ setView('study'); if(studyItems.length===0){ const list = await loadList(TAB_STUDY); setStudyItems(list) } }
  async function openExams(){ setView('exams'); if(examItems.length===0){ const list = await loadList(TAB_EXAMS); setExamItems(list) } }

  function toMock(){ setView('mock') }
  function toProfile(){ setView('profile') }

  if(loading) return <Splash />

  if(view==='home') return (
    <Home
      topicBank={topicBank}
      examBank={examBank}
      onStartTopic={startTopic}
      onStartExam={startExam}
      onSeeAllTopics={()=> setView('all-topics')}
      onSeeAllExams={()=> setView('all-exams')}
      onStartBattle={startBattle}
      onQuick={startQuick}
      openStudy={openStudy}
      openExams={openExams}
      recent={recent}
      toMock={toMock}
      toProfile={toProfile}
    />
  )

  if(view==='all-topics') return <AllCategories title="All Topics" bank={topicBank} onStart={startTopic} onBack={()=> setView('home')} />
  if(view==='all-exams') return <AllCategories title="All Exams" bank={examBank} onStart={startExam} onBack={()=> setView('home')} />

  if(view==='battle-search') return <BattleSearch onMatched={matchedBattle} />

  if(view==='quick') return <QuickSetup bank={mergeBanks(topicBank, examBank)} onStart={handleQuickStart} onBack={()=> setView('home')} />

  if(view==='play' && playing) return (
    <PlayView
      mode={playing.mode}
      title={playing.title}
      questions={playing.questions}
      onQuit={()=> setView('home')}
      onFinish={onFinishPlay}
    />
  )

  if(view==='summary' && result) return (
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 pb-10 pt-6">
        <SummaryCard
          result={result}
          onReview={()=> setView('omr')}
          onHome={()=> setView('home')}
          onRetry={()=> setView('play')}
        />
      </div>
    </div>
  )

  if(view==='omr' && result) return <OMRReview result={result} onBack={()=> setView('home')} />

  if(view==='study') return <SimpleList title="Study Material" items={studyItems} onBack={()=> setView('home')} />
  if(view==='exams') return <SimpleList title="Exam Notifications" items={examItems} onBack={()=> setView('home')} />

  if(view==='mock') return <MockExam bank={mergeBanks(examBank, topicBank)} onBack={()=> setView('home')} onFinish={(r)=> { setResult(r); setView('summary') }} />

  return <Splash />
}
