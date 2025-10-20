// === src/App.jsx ===
// Mobile-first UI with desktop responsiveness
// - Wider containers on desktop
// - Responsive grids for categories, lists, and quiz options
// - All existing features preserved

import { useEffect, useMemo, useState } from "react";

/* ───────────────────────── CONFIG ───────────────────────── */
const DEFAULT_FILE_ID = "16iIOLKAkFzXD1ja7v6b7_ZUKVjbcsswX8LfJ_D0S57o";
const GS_FILE_ID =
  (import.meta?.env?.VITE_GS_FILE_ID || "").trim() || DEFAULT_FILE_ID;

const TAB_CATEGORIES = "Categories";
const TAB_QUESTIONS = "Questions";
const TAB_STUDY = "Study Material";
const TAB_EXAMS = "Exam Notifications";
const TAB_EXAM_CATEGORIES = "EXAM CAT";
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
function sampleMany(arr, n) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]} return a.slice(0,Math.max(0,Math.min(n,a.length))); }

function parseGViz(text) { const t=String(text||""); const i=t.indexOf("{"); const j=t.lastIndexOf("}"); if(i>=0&&j>i) return JSON.parse(t.slice(i,j+1)); throw new Error("GViz parse error"); }

async function gvizFetch({ sheetName, gid, tq = "select *" }) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${GS_FILE_ID}/gviz/tq`);
  if (gid) url.searchParams.set("gid", gid); else url.searchParams.set("sheet", sheetName);
  url.searchParams.set("tq", tq); url.searchParams.set("tqx", "out:json");
  const res = await fetch(url.toString(), { cache: "no-store" }); if (!res.ok) throw new Error(`GViz HTTP ${res.status}`);
  const raw = await res.text(); const json = parseGViz(raw);

  let cols = (json.table?.cols || []).map((c,i)=>lower(c?.label||c?.id||`col${i+1}`));
  let rows = (json.table?.rows || []).map((r)=>(r.c||[]).map((c)=>((c&&c.v)!=null?String(c.v):"")));
  const looksGeneric = cols.every((c)=>c===""||/^[a-z]\w*$/i.test(c)||/^col\d+$/i.test(c));
  const headerish = (rows[0]||[]).some((v)=>/(name|display|tab|sheet|actual|question|opt|correct|title|url|desc|date)/i.test(String(v||"")));
  if (looksGeneric && headerish) { cols=(rows[0]||[]).map((v,i)=>lower(v||`col${i+1}`)); rows=rows.slice(1); }
  return { cols, rows };
}

function findHeaderIndex(cols, cand, fallback) {
  const cands=cand.map(strip), coln=cols.map(strip);
  for(const c of cands){ const i=coln.findIndex((cn)=>cn===c||cn.includes(c)); if(i!==-1) return i; }
  return typeof fallback==="number"?fallback:-1;
}

function mapQuestionRows(cols, rows, defaultCategory="General") {
  const idxQ=findHeaderIndex(cols,["question","q","title"]);
  const idxAns=findHeaderIndex(cols,["answer","ans","correcttext"]);
  const idxA=findHeaderIndex(cols,["optA","a","option a","1"]);
  const idxB=findHeaderIndex(cols,["optB","b","option b","2"]);
  const idxC=findHeaderIndex(cols,["optC","c","option c","3"]);
  const idxD=findHeaderIndex(cols,["optD","d","option d","4"]);
  const idxCor=findHeaderIndex(cols,["correct","answerindex","correct option"],-1);
  const idxCat=findHeaderIndex(cols,["category","subject","topic","cat"],-1);

  const out=[];
  for(const r of rows){
    const text=norm(r[idxQ]); const options=[r[idxA],r[idxB],r[idxC],r[idxD]].map(norm).filter(Boolean);
    if(!text||options.length<2) continue;
    const ansText=norm(r[idxAns]); const corRaw=norm(r[idxCor]);
    let answerIndex=-1;
    if(corRaw){ const v=corRaw.toUpperCase(); if("ABCD".includes(v)) answerIndex=v.charCodeAt(0)-65; else { const n=Number(v); if(Number.isFinite(n)&&n>=1&&n<=options.length) answerIndex=n-1; } }
    if(answerIndex<0&&ansText){ const i=options.findIndex((o)=>strip(o)===strip(ansText)); if(i>=0) answerIndex=i; }
    if(answerIndex<0) answerIndex=0;
    out.push({ cat: idxCat>=0?norm(r[idxCat])||defaultCategory:defaultCategory, text, options, answerIndex });
  }
  return out;
}

function mapListRows(cols, rows) {
  const idxTitle=findHeaderIndex(cols,["title","name","heading"],0);
  const idxUrl=findHeaderIndex(cols,["url","link","href"],1);
  const idxDesc=findHeaderIndex(cols,["desc","description","about"],2);
  const idxDate=findHeaderIndex(cols,["date","when"],3);
  const items=[];
  for(const r of rows){
    const title=norm(r[idxTitle]); const url=norm(r[idxUrl]); const desc=norm(r[idxDesc]); const date=norm(r[idxDate]);
    if(!title) continue; items.push({title,url,desc,date});
  }
  items.sort((a,b)=>{ const da=Date.parse(a.date||""), db=Date.parse(b.date||""); if(Number.isFinite(db)&&Number.isFinite(da)) return db-da; return (b.date||"").localeCompare(a.date||""); });
  return items;
}

function shuffleWithIndex(arr, correctIdx) {
  const idxs=arr.map((_,i)=>i); for(let i=idxs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idxs[i],idxs[j]]=[idxs[j],idxs[i]]; }
  const newOptions=idxs.map(i=>arr[i]); const newCorrect=idxs.indexOf(correctIdx); return { newOptions, newCorrect };
}
function toBank(items){ const bank={}; for(const it of items){ const {newOptions,newCorrect}=shuffleWithIndex(it.options,it.answerIndex); bank[it.cat]??=[]; bank[it.cat].push({id:bank[it.cat].length+1,text:it.text,options:newOptions,answerIndex:newCorrect}); } return bank; }
function flattenBank(bank){ const out=[]; for(const [cat,list] of Object.entries(bank)){ for(const q of list) out.push({...q,cat}); } return out; }

/* Loaders */
async function loadQuestionBankFrom(mappingTab){
  try{ const {cols,rows}=await gvizFetch({sheetName:TAB_QUESTIONS}); if(rows.length){ const items=mapQuestionRows(cols,rows); const bank=toBank(items); if(Object.keys(bank).length) return bank; } }catch{}
  const {cols:cCols0,rows:cRows0}=await gvizFetch({sheetName:mappingTab});
  let cCols=cCols0,cRows=cRows0;
  const generic=cCols.every((c)=>c===""||/^[a-z]\w*$/i.test(c)||/^col\d+$/i.test(c));
  const headerish=(cRows[0]||[]).some((v)=>/(name|display|tab|sheet|actual)/i.test(String(v||"")));
  if(generic&&headerish){ cCols=(cRows[0]||[]).map((v,i)=>lower(v||`col${i+1}`)); cRows=cRows.slice(1); }
  let idxDisplay=findHeaderIndex(cCols,["name (display)","display","title","name"],-1);
  let idxTab=findHeaderIndex(cCols,["text (actual tab name)","actual tab name","tab","sheet","sheetname"],-1);
  if(idxDisplay===-1||idxTab===-1){ const idIdx=cCols.findIndex((x)=>strip(x)==="id"); const indices=cCols.map((_,i)=>i).filter((i)=>i!==idIdx); if(idxDisplay===-1&&indices.length) idxDisplay=indices[0]; if(idxTab===-1&&indices.length>1) idxTab=indices[1]; }
  if(idxDisplay===-1) idxDisplay=1; if(idxTab===-1) idxTab=2;
  const mappings=cRows.map((r)=>({display:normalizeSheetName(r[idxDisplay]),tab:normalizeSheetName(r[idxTab])})).filter((m)=>m.display&&m.tab);
  const bank={};
  for(const m of mappings){
    try{
      const isGid=/^\d+$/.test(m.tab);
      const {cols,rows}=await gvizFetch({sheetName:isGid?undefined:m.tab,gid:isGid?m.tab:undefined});
      const items=mapQuestionRows(cols,rows,m.display);
      bank[m.display]=toBank(items)[m.display]||[];
    }catch(e){ console.warn("Failed tab",m.tab,e); bank[m.display]=[]; }
  }
  return bank;
}

async function loadQuestionBank(){
  try{ const {cols,rows}=await gvizFetch({sheetName:TAB_QUESTIONS}); if(rows.length){ const items=mapQuestionRows(cols,rows); const bank=toBank(items); if(Object.keys(bank).length) return bank; } }catch{}
  const {cols:cCols0,rows:cRows0}=await gvizFetch({sheetName:TAB_CATEGORIES});
  let cCols=cCols0,cRows=cRows0;
  const generic=cCols.every((c)=>c===""||/^[a-z]\w*$/i.test(c)||/^col\d+$/i.test(c));
  const headerish=(cRows[0]||[]).some((v)=>/(name|display|tab|sheet|actual)/i.test(String(v||"")));
  if(generic&&headerish){ cCols=(cRows[0]||[]).map((v,i)=>lower(v||`col${i+1}`)); cRows=cRows.slice(1); }
  let idxDisplay=findHeaderIndex(cCols,["name (display)","display","title","name"],-1);
  let idxTab=findHeaderIndex(cCols,["text (actual tab name)","actual tab name","tab","sheet","sheetname"],-1);
  if(idxDisplay===-1||idxTab===-1){ const idIdx=cCols.findIndex((x)=>strip(x)==="id"); const indices=cCols.map((_,i)=>i).filter((i)=>i!==idIdx); if(idxDisplay===-1&&indices.length) idxDisplay=indices[0]; if(idxTab===-1&&indices.length>1) idxTab=indices[1]; }
  if(idxDisplay===-1) idxDisplay=1; if(idxTab===-1) idxTab=2;
  const mappings=cRows.map((r)=>({display:normalizeSheetName(r[idxDisplay]),tab:normalizeSheetName(r[idxTab])})).filter((m)=>m.display&&m.tab);
  const bank={};
  for(const m of mappings){
    try{
      const isGid=/^\d+$/.test(m.tab);
      const {cols,rows}=await gvizFetch({sheetName:isGid?undefined:m.tab,gid:isGid?m.tab:undefined});
      const items=mapQuestionRows(cols,rows,m.display);
      bank[m.display]=toBank(items)[m.display]||[];
    }catch(e){ console.warn("Failed tab",m.tab,e); bank[m.display]=[]; }
  }
  return bank;
}
async function loadList(tabName){ try{ const {cols,rows}=await gvizFetch({sheetName:tabName}); return mapListRows(cols,rows); }catch(e){ console.warn("List load failed",tabName,e); return []; } }

/* UI Primitives */
const Card = ({children,className=""}) => <div className={cx("rounded-2xl bg-white shadow-sm border border-emerald-100",className)}>{children}</div>;
function LinearProgress({value,max}){ const pct=Math.min(100,Math.max(0,(value/max)*100)); return(<div className="w-full h-1.5 md:h-2 bg-emerald-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-600" style={{width:`${pct}%`}}/></div>); }
function TimerRing({secondsLeft,totalSeconds=25}){ const R=18,C=2*Math.PI*R,p=Math.max(0,Math.min(1,secondsLeft/totalSeconds)); return(<div className="relative w-10 h-10 md:w-11 md:h-11"><svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90"><circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-100" strokeWidth="6"/><circle cx="22" cy="22" r={R} className="fill-none stroke-emerald-600 transition-[stroke-dasharray] duration-200" strokeLinecap="round" strokeWidth="6" strokeDasharray={`${C*p} ${C}`}/></svg><div className="absolute inset-0 grid place-items-center text-[10px] md:text-xs font-semibold text-emerald-700">0{Math.max(0,secondsLeft).toString().padStart(2,"0")}</div></div>); }

function OptionButton({label,letter,disabled,isSelected,showFeedback,isCorrect,isWrong}){
  const feedbackClass = showFeedback ? (isCorrect ? "border-green-500 bg-green-50" : isWrong ? "border-red-500 bg-red-50" : "border-transparent")
                                     : (isSelected ? "border-emerald-600 ring-2 ring-emerald-200" : "border-transparent hover:border-emerald-200");
  const textColor = showFeedback ? (isCorrect ? "text-green-800" : isWrong ? "text-red-700" : "text-slate-800") : "text-slate-800";
  return (
    <button disabled={disabled} className={cx("w-full text-left rounded-xl border-2 px-4 py-3 md:px-5 md:py-3.5 mb-3 transition-all bg-white/80",feedbackClass)}>
      <span className="inline-flex items-center gap-3">
        <span className={cx("grid place-items-center w-6 h-6 rounded-full text-xs font-semibold md:w-7 md:h-7 md:text-sm",
          showFeedback ? (isCorrect ? "bg-green-100 text-green-700" : isWrong ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700") : "bg-emerald-100 text-emerald-700")}>
          {letter}
        </span>
        <span className={cx("text-[15px] md:text-[16px]",textColor)}>{label}</span>
      </span>
    </button>
  );
}

/* Splash (messages only) */
function Splash(){
  const messages=["Personalizing your questions…","Finding new online friends…","Updating new questions…","Sharpening brain cells…","Warming up the quiz engine…","Checking your lucky stars…"];
  const [i,setI]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>setI((x)=>(x+1)%messages.length),1400); return()=>clearInterval(id); },[]);
  return(
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin mb-4"/>
        <div className="text-emerald-700 font-semibold text-[15px] md:text-[17px] transition-opacity duration-300">{messages[i]}</div>
        <div className="w-56 md:w-72 h-2 rounded-full bg-emerald-100 overflow-hidden mt-4"><div className="h-full w-1/2 rounded-full bg-emerald-400/70 animate-pulse"/></div>
      </div>
    </div>
  );
}

/* Avatars */
function CartoonAvatar(){ return(<div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-emerald-200 grid place-items-center overflow-hidden">
  <svg viewBox="0 0 64 64" width="36" height="36"><circle cx="32" cy="24" r="12" fill="#fff"/><path d="M12 54c3-10 13-14 20-14s17 4 20 14" fill="#fff"/><circle cx="28" cy="22" r="2" fill="#059669"/><circle cx="36" cy="22" r="2" fill="#059669"/><path d="M26 27c2 2 8 2 10 0" stroke="#059669" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
</div>); }
function OppAvatar({name}){ const initials=useMemo(()=>name.split(" ").map((w)=>w[0]?.toUpperCase()).slice(0,2).join(""),[name]); let hue=0; for(const ch of name) hue=(hue*31+ch.charCodeAt(0))%360;
  return(<div className="w-10 h-10 md:w-11 md:h-11 rounded-full grid place-items-center text-sm font-bold text-white" style={{backgroundColor:`hsl(${hue},60%,45%)`}} title={name}>{initials||"OP"}</div>);
}

/* Battle assets */
const MALAYALI_NAMES=["Anand","Akhil","Ajith","Anu","Amala","Hari","Gopika","Sreenath","Nimisha","Midhun","Varun","Fahad","Mamta","Dulquer","Nazriya","Tovino","Keerthi","Surya","Meera","Aswin","Neha","Anjana","Athul","Devika","Mohan","Sreejith","Athira","Jishnu","Remya","Arjun","Anoop","Sarath","Abhiram","Nikhil","Sneha","Gayathri","Adithya","Aparna"];
const KERALA_PLACES=["Thiruvananthapuram","Kollam","Pathanamthitta","Alappuzha","Kottayam","Idukki","Ernakulam","Thrissur","Palakkad","Malappuram","Kozhikode","Wayanad","Kannur","Kasaragod","Kochi","Muvattupuzha","Kattappana","Pala","Chalakudy","Kunnamkulam","Nedumangad","Neyyattinkara","Attingal","Kayamkulam","Tirur","Perinthalmanna","Payyannur","Taliparamba","Kanhangad","Varkala","Adoor","Changanassery","Irinjalakuda","Thodupuzha"];
function randomOpponent(){ return { name: sampleOne(MALAYALI_NAMES)+" "+sampleOne(["K","S","N","M","P","V"]), place: sampleOne(KERALA_PLACES) }; }

/* Views */
function Home({ bankTopic, bankExam, onStartCategory, onSeeAll, onStartBattle, studyCount, examCount, openStudy, openExams, recent }) {
  const [homeQ,setHomeQ]=useState("");
  const catsTopic=Object.keys(bankTopic);
  const catsExam=Object.keys(bankExam);
  const filteredTopic=catsTopic.filter((c)=>c.toLowerCase().includes(homeQ.toLowerCase()));
  const filteredExam=catsExam.filter((c)=>c.toLowerCase().includes(homeQ.toLowerCase()));
  const previewTopic=filteredTopic.slice(0,6);
  const previewExam=filteredExam.slice(0,6);

  return(
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 lg:px-8 pb-28 pt-6">
        {/* header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 md:gap-4">
            <CartoonAvatar/>
            <div>
              <p className="text-[15px] md:text-[17px] font-semibold text-slate-900">PSC Guru</p>
              <p className="text-[13px] md:text-[14px] text-slate-600">No1 PSC Learning App</p>
            </div>
          </div>
        </div>

        {/* search */}
        <div className="mb-5 max-w-2xl">
          <div className="flex items-center gap-2 bg-white/80 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5">
            <span className="text-slate-400">🔎</span>
            <input className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400" placeholder="Search categories" value={homeQ} onChange={(e)=>setHomeQ(e.target.value)}/>
          </div>
        </div>

        {/* hero + battle row */}
        <div className="grid gap-4 md:grid-cols-2 md:items-stretch mb-6">
          <Card className="p-4 bg-gradient-to-br from-lime-400 to-emerald-600 text-white">
            <div className="flex items-center justify-between h-full">
              <div>
                <p className="text-sm/5 md:text-base/5 opacity-90">Play and Win</p>
                <p className="text-xs/5 md:text-sm/5 opacity-80">Start a quiz now and enjoy</p>
              </div>
              <button onClick={()=>onStartCategory(previewTopic[0],'topic'||cats[0])} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Get Started</button>
            </div>
          </Card>

          <Card className="p-4 bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 text-white">
            <div className="flex items-center justify-between h-full">
              <div>
                <p className="font-semibold">Online Battle</p>
                <p className="text-sm opacity-90">Match with an opponent &amp; race!</p>
              </div>
              <button onClick={onStartBattle} className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-semibold">Find Battle</button>
            </div>
          </Card>
        </div>

        {/* categories */}
        
        {/* topic categories */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] md:text-[17px] font-semibold text-slate-900">Categories — Topics</h3>
          <button onClick={onSeeAll} className="text-[13px] md:text-[14px] text-emerald-700">See all</button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4 mb-6">
          {previewTopic.map((c)=>(
            <button key={"topic-"+c} onClick={()=>onStartCategory(c,'topic')} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200">
              <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">＋</div>
              <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
              <div className="text-[11px] md:text-[12px] text-slate-500">{(bankTopic[c]||[]).length} questions</div>
            </button>
          ))}
          {previewTopic.length===0 && <div className="col-span-full text-center text-sm text-slate-600">No topic categories match “{homeQ}”.</div>}
        </div>

        {/* exam categories */}
        <div className="mb-2 mt-6 flex items-center justify-between">
          <h3 className="text-[15px] md:text-[17px] font-semibold text-slate-900">Categories — Exams</h3>
          <button onClick={onSeeAll} className="text-[13px] md:text-[14px] text-emerald-700">See all</button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4 mb-6">
          {previewExam.map((c)=>(
            <button key={"exam-"+c} onClick={()=>onStartCategory(c,'exam')} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200">
              <div className="w-10 h-10 md:w-12 md:h-12 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">★</div>
              <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
              <div className="text-[11px] md:text-[12px] text-slate-500">{(bankExam[c]||[]).length} questions</div>
            </button>
          ))}
          {previewExam.length===0 && <div className="col-span-full text-center text-sm text-slate-600">No exam categories match “{homeQ}”.</div>}
        </div>
{/* study + exam row */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 md:gap-4">
          <button onClick={openStudy} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📚</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">Study Material</div>
            <div className="text-[12px] text-slate-500">Browse curated links</div>
          </button>
          <button onClick={openExams} className="rounded-2xl p-4 text-left bg-white border border-emerald-100 hover:border-emerald-200">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 mb-2">📢</div>
            <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">Exam Notifications</div>
            <div className="text-[12px] text-slate-500">Latest alerts &amp; dates</div>
          </button>
        </div>

        {/* recent */}
        {recent.length>0 && (
          <div className="mt-6">
            <div className="mb-3 text-[15px] md:text-[17px] font-semibold text-slate-900">Recent</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {recent.map((c)=>(
                <button key={c} onClick={()=>onStartCategory(c)} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">🕘</div>
                    <div>
                      <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                      <div className="text-[11px] md:text-[12px] text-slate-500">{(bank[c]||[]).length} questions</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function AllCategories({ bankTopic, bankExam, onStartCategory, onBack }) {
  const [q,setQ]=useState("");
  const catsTopic=Object.keys(bankTopic).filter((n)=>n.toLowerCase().includes(q.toLowerCase()));
  const catsExam=Object.keys(bankExam).filter((n)=>n.toLowerCase().includes(q.toLowerCase()));
  return(
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full mx-auto max-w-5xl pb-20">
        <div className="sticky top-0 z-30 -mx-4 md:mx-0 px-4 md:px-0 pt-4 pb-3 bg-[#eefbe7]/90 backdrop-blur supports-[backdrop-filter]:bg-[#eefbe7]/80 border-b border-emerald-100">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onBack} className="text-slate-600">←</button>
            <div className="text-[15px] md:text-[17px] font-semibold">All Categories</div>
            <span className="w-4"/>
          </div>
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <input className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400" placeholder="Search categories" value={q} onChange={(e)=>setQ(e.target.value)}/>
            </div>
          </div>
        </div>

        <div className="px-4 md:px-0">
          <h3 className="mt-5 mb-3 text-[15px] md:text-[17px] font-semibold text-slate-900">Topics</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 mb-8">
            {catsTopic.map((c)=>(
              <button key={"topic-"+c} onClick={()=>onStartCategory(c,'topic')} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 text-left">
                <div className="w-9 h-9 md:w-11 md:h-11 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">＋</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500">{(bankTopic[c]||[]).length} questions</div>
              </button>
            ))}
            {catsTopic.length===0 && <div className="col-span-full text-center text-sm text-slate-600">No results.</div>}
          </div>

          <h3 className="mt-6 mb-3 text-[15px] md:text-[17px] font-semibold text-slate-900">Exams</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {catsExam.map((c)=>(
              <button key={"exam-"+c} onClick={()=>onStartCategory(c,'exam')} className="rounded-2xl p-3 md:p-4 bg-white border border-emerald-100 hover:border-emerald-200 text-left">
                <div className="w-9 h-9 md:w-11 md:h-11 mb-2 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700">★</div>
                <div className="text-[13px] md:text-[14px] font-medium text-slate-800">{c}</div>
                <div className="text-[11px] md:text-[12px] text-slate-500">{(bankExam[c]||[]).length} questions</div>
              </button>
            ))}
            {catsExam.length===0 && <div className="col-span-full text-center text-sm text-slate-600">No results.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
}

function BattleSearch({ onMatched }) {
  useEffect(()=>{ const id=setTimeout(()=>onMatched(),3000); return()=>clearTimeout(id); },[onMatched]);
  return(
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

function Quiz({ category, bank, onFinish, customQuestions, opponent, battleMode }) {
  const qs=customQuestions||bank[category]||[];
  const [i,setI]=useState(0); const [sel,setSel]=useState(null); const [score,setScore]=useState(0);
  const [secondsLeft,setSecondsLeft]=useState(25); const [showFeedback,setShowFeedback]=useState(false);
  const [advancing,setAdvancing]=useState(false); const [history,setHistory]=useState([]);
  const q=qs[i];

  useEffect(()=>{ setSecondsLeft(25); const id=setInterval(()=>setSecondsLeft((s)=>s-1),1000); return()=>clearInterval(id); },[i]);
  useEffect(()=>{ if(secondsLeft<=0&&q&&!showFeedback&&!advancing){ revealAndQueueNext(null); } },[secondsLeft,showFeedback,advancing,q]);

  function nextQuestion(){ if(i+1>=qs.length) return onFinish({score,total:qs.length,history,opponent,battleMode}); setI((x)=>x+1); setSel(null); setShowFeedback(false); setAdvancing(false); }
  function revealAndQueueNext(chosenIndex){
    if(!q||advancing) return;
    setSel(chosenIndex); setShowFeedback(true); setAdvancing(true);
    const isCorrect=chosenIndex===q.answerIndex; if(chosenIndex!=null) setScore((s)=>s+(isCorrect?1:0));
    setHistory((h)=>[...h,{id:q.id,text:q.text,options:q.options,correctIndex:q.answerIndex,chosenIndex,isCorrect}]);
    setTimeout(()=>nextQuestion(),2000);
  }
  const letters=["a","b","c","d","e","f"];

  return(
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 pb-20 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={()=>onFinish({score,total:qs.length,history,aborted:true,opponent,battleMode})} className="text-slate-600">←</button>
          <div className="text-[15px] md:text-[17px] font-semibold">{battleMode?"Online Battle":category}</div>
          <TimerRing secondsLeft={secondsLeft} totalSeconds={25}/>
        </div>

        {battleMode&&opponent&&(
          <div className="flex items-center gap-3 mb-2">
            <OppAvatar name={opponent.name}/>
            <div>
              <div className="text-[13px] md:text-[14px] font-semibold text-slate-800">{opponent.name}</div>
              <div className="text-[12px] text-slate-500">{opponent.place}</div>
            </div>
          </div>
        )}

        <div className="text-[12px] md:text-[13px] text-slate-500 mb-2">
          Question <span className="font-semibold">{Math.min(i+1,qs.length)}/{qs.length||0}</span>
        </div>
        <LinearProgress value={Math.min(i+1,qs.length)} max={Math.max(1,qs.length)}/>

        {!q ? (
          <Card className="p-4 mt-4 bg-white/90"><div className="text-[14px] text-slate-700">No questions found.</div></Card>
        ) : (
          <div className="grid md:grid-cols-2 md:items-start md:gap-4">
            <Card className="p-4 mt-4 mb-3 md:mb-0 bg-white/90">
              <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">{q.text}</div>
            </Card>
            <div className="mt-2 md:mt-4">
              {q.options.map((opt,idx)=>(
                <div key={idx} onClick={()=>{ if(showFeedback||advancing) return; revealAndQueueNext(idx); }}>
                  <OptionButton letter={letters[idx]} label={opt} disabled={showFeedback||advancing} isSelected={sel===idx}
                    showFeedback={showFeedback} isCorrect={showFeedback&&idx===q.answerIndex} isWrong={showFeedback&&sel===idx&&idx!==q.answerIndex}/>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-5xl px-4 md:px-6">
            <button className="w-full py-3 md:py-3.5 rounded-xl text-white font-semibold bg-emerald-300 cursor-not-allowed" disabled>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListPage({ title, items, onBack }) {
  const [q,setQ]=useState("");
  const filtered=items.filter((it)=>it.title.toLowerCase().includes(q.toLowerCase())||it.desc.toLowerCase().includes(q.toLowerCase()));
  return(
    <div className="min-h-dvh bg-[#eefbe7]">
      <div className="w-full mx-auto max-w-4xl pb-20">
        <div className="sticky top-0 z-30 -mx-4 md:mx-0 px-4 md:px-6 pt-4 pb-3 bg-[#eefbe7]/95 backdrop-blur supports-[backdrop-filter]:bg-[#eefbe7]/80 border-b border-emerald-100">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onBack} className="text-slate-600">←</button>
            <div className="text-[15px] md:text-[17px] font-semibold">{title}</div>
            <span className="w-4"/>
          </div>
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 bg-white/90 border border-emerald-100 rounded-xl px-3 py-2 md:px-4 md:py-2.5 shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} className="w-full text-[14px] md:text-[15px] outline-none placeholder:text-slate-400 bg-transparent" autoFocus/>
            </div>
          </div>
        </div>

        <div className="px-4 md:px-6 pt-3 grid gap-3 md:gap-4 md:grid-cols-2">
          {filtered.map((it,i)=>(
            <Card key={i} className="p-3 md:p-4">
              <div className="text-[14px] md:text-[15px] font-semibold text-slate-800">{it.title}</div>
              {it.date && <div className="text-[12px] md:text-[13px] text-slate-500 mt-0.5">{it.date}</div>}
              {it.desc && <div className="text-[13px] md:text-[14px] text-slate-600 mt-2">{it.desc}</div>}
              <div className="mt-3">
                <a href={it.url||"#"} target="_blank" rel="noreferrer" className={cx("inline-block px-3 py-1.5 rounded-lg text-sm font-semibold",
                  it.url ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500 cursor-not-allowed")}
                  onClick={(e)=>{ if(!it.url) e.preventDefault(); }}>
                  {it.url ? "Open" : "No Link"}
                </a>
              </div>
            </Card>
          ))}
          {filtered.length===0 && <Card className="p-4 text-center text-sm text-slate-600 md:col-span-2">No items found.</Card>}
        </div>
      </div>
    </div>
  );
}

function Result({ score, total, history, opponent, battleMode, onBack }) {
  const [showSummary,setShowSummary]=useState(false);
  const correctCount=history.filter((h)=>h.isCorrect).length;
  const opponentScore=useMemo(()=>{ if(!battleMode) return null; const d=Math.floor(Math.random()*7)-3; return Math.max(0,Math.min(total,score+d)); },[battleMode,score,total]);

  if(showSummary){
    return(
      <div className="min-h-dvh bg-[#eefbe7]">
        <div className="mx-auto w-full max-w-4xl px-4 md:px-6 pb-16 pt-6">
          <div className="flex items-center justify-between mb-3">
            <button onClick={()=>setShowSummary(false)} className="text-slate-600">←</button>
            <div className="text-[15px] md:text-[17px] font-semibold">Summary</div>
            <span className="w-4"/>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {history.map((h,idx)=>(
              <Card key={idx} className="p-3 md:p-4">
                <div className="text-[13px] md:text-[14px] text-slate-500 mb-1">Q{idx+1}</div>
                <div className="text-[14px] md:text-[15px] font-semibold text-slate-800 mb-2">{h.text}</div>
                <div className="space-y-1">
                  {h.options.map((o,i)=>{
                    const isCorrect=i===h.correctIndex; const isChosen=i===h.chosenIndex;
                    const cls=isCorrect?"bg-green-50 border-green-500":isChosen&&!isCorrect?"bg-red-50 border-red-500":"bg-white border-transparent";
                    return <div key={i} className={cx("text-[13px] md:text-[14px] rounded-lg border px-3 py-2",cls)}>{o}</div>;
                  })}
                </div>
              </Card>
            ))}
            {history.length===0 && <Card className="p-4 text-center text-sm text-slate-600">No answers to summarize.</Card>}
          </div>
          <div className="fixed bottom-4 left-0 right-0">
            <div className="mx-auto max-w-4xl px-4 md:px-6 grid">
              <button onClick={onBack} className="w-full py-3 rounded-xl text-white font-semibold bg-emerald-600 hover:bg-emerald-700">Back to Home</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="min-h-dvh grid place-items-center bg-[#eefbe7]">
      <div className="w-full max-w-sm md:max-w-md px-4 pb-20 pt-8 text-center">
        <div className="w-36 h-36 md:w-40 md:h-40 rounded-full mx-auto mb-6 grid place-items-center bg-gradient-to-br from-lime-100 to-emerald-100 border border-emerald-100">
          <div className="w-16 h-16 md:w-18 md:h-18 rounded-full bg-emerald-200 text-emerald-700 font-bold grid place-items-center">★</div>
        </div>
        <div className="text-slate-500 text-sm md:text-[15px]">Your Score</div>
        <div className="text-4xl md:text-5xl font-extrabold text-slate-900 mt-1">{score}/{total}</div>
        <div className="text-sm md:text-[15px] text-slate-600 mt-1">Correct: {correctCount} • Wrong: {history.length-correctCount}</div>
        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">Keep practicing!</div>
        <div className="mt-3">
          <button onClick={()=>setShowSummary(true)} className="px-4 py-2 rounded-lg font-semibold border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50">View Summary</button>
        </div>
        {battleMode&&(
          <Card className="mt-6 p-3 md:p-4 text-left">
            <div className="text-[13px] md:text-[14px] text-slate-500 mb-2">Battle Result</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <div className="rounded-xl border border-emerald-100 p-3 md:p-4 bg-emerald-50/40">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 md:w-11 md:h-11 rounded-full grid place-items-center bg-emerald-500 text-white font-bold">U</div>
                  <div><div className="text-[13px] md:text-[14px] font-semibold text-slate-800">User</div><div className="text-[12px] text-slate-500">Kerala</div></div>
                </div>
                <div className="text-[13px] text-slate-600">Score</div>
                <div className="text-xl md:text-2xl font-extrabold text-slate-900">{score}</div>
              </div>
              <div className="rounded-xl border border-emerald-100 p-3 md:p-4 bg-white">
                <div className="flex items-center gap-3 mb-1">
                  <OppAvatar name={opponent?.name||"Opponent"}/>
                  <div><div className="text-[13px] md:text-[14px] font-semibold text-slate-800">{opponent?.name||"Opponent"}</div><div className="text-[12px] text-slate-500">{opponent?.place||"Kerala"}</div></div>
                </div>
                <div className="text-[13px] text-slate-600">Score</div>
                <div className="text-xl md:text-2xl font-extrabold text-slate-900">{opponentScore}/{total}</div>
              </div>
            </div>
          </Card>
        )}
        <div className="fixed bottom-4 left-0 right-0">
          <div className="mx-auto max-w-md px-4">
            <button onClick={onBack} className="w-full py-3 rounded-xl text-white font-semibold bg-emerald-600 hover:bg-emerald-700">Back to Home</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* App */
export default function App(){
  const [view,setView]=useState("home");
  const [category,setCategory]=useState("");
  const [bank,setBank]=useState({});
  const [bankTopic,setBankTopic]=useState({});
  const [bankExam,setBankExam]=useState({});
  const [result,setResult]=useState({score:0,total:0,history:[]});
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState("");

  const [battleQuestions,setBattleQuestions]=useState(null);
  const [opponent,setOpponent]=useState(null);
  const [battleMode,setBattleMode]=useState(false);

  const [studyItems,setStudyItems]=useState([]);
  const [examItems,setExamItems]=useState([]);

  const [recent,setRecent]=useState([]);
  const [currentCategory,setCurrentCategory]=useState("");

  useEffect(()=>{ const saved=JSON.parse(localStorage.getItem("recent_cats")||"[]"); if(Array.isArray(saved)) setRecent(saved.slice(0,2)); },[]);
  function pushRecent(cat){ if(!cat) return; setRecent((prev)=>{ const next=[cat,...prev.filter((c)=>c!==cat)].slice(0,2); localStorage.setItem("recent_cats",JSON.stringify(next)); return next; }); }

  useEffect(()=>{ let alive=true; (async()=>{ try{ const [bt,be,study,exams]=await Promise.all([loadQuestionBankFrom(TAB_CATEGORIES),loadQuestionBankFrom(TAB_EXAM_CATEGORIES),loadList(TAB_STUDY),loadList(TAB_EXAMS)]); if(!alive) return; setBankTopic(bt); setBankExam(be); setBank(bt); setStudyItems(study); setExamItems(exams); }catch(e){ console.error(e); if(alive) setErr(String(e?.message||e)); }finally{ if(alive) setLoading(false); } })(); return()=>{alive=false}; },[]);

  const startCategory=(c,kind='topic')=>{ if(kind==='exam') setBank(bankExam); else setBank(bankTopic); setCategory(c); setCurrentCategory(c); setBattleMode(false); setBattleQuestions(null); setOpponent(null); setView("quiz"); };
  const handleStartBattle=()=>{ setBattleMode(true); setBattleQuestions(null); setOpponent(null); setView("battle_search"); };
  const handleMatched=()=>{ const opp=randomOpponent(); const flat=flattenBank(bank); const picked=sampleMany(flat,BATTLE_QUESTION_COUNT).map((q,idx)=>({id:idx+1,text:q.text,options:q.options,answerIndex:q.answerIndex,cat:q.cat})); setOpponent(opp); setBattleQuestions(picked); setCategory("Random Battle"); setView("quiz"); };

  if(loading) return <Splash/>;
  if(err) return (<div className="min-h-dvh grid place-items-center bg-[#eefbe7]"><div className="max-w-sm md:max-w-md px-4"><Card className="p-4"><div className="text-[15px] md:text-[16px] font-semibold">Couldn't load Google Sheet</div><p className="text-sm text-slate-600 mt-2">{err}</p></Card></div></div>);

  return(
    <div className="min-h-dvh">
      {view==="home" && <Home bankTopic={bankTopic} bankExam={bankExam} onStartCategory={startCategory} onSeeAll={()=>setView("categories")} onStartBattle={handleStartBattle}
        studyCount={studyItems.length} examCount={examItems.length} openStudy={()=>setView("study")} openExams={()=>setView("exams")} recent={recent}/>}
      {view==="categories" && <AllCategories bankTopic={bankTopic} bankExam={bankExam} onStartCategory={startCategory} onBack={()=>setView("home")}/>}
      {view==="battle_search" && <BattleSearch onMatched={handleMatched}/>}
      {view==="quiz" && <Quiz category={category} bank={bank} customQuestions={battleQuestions} opponent={opponent} battleMode={battleMode}
        onFinish={(r)=>{ setResult(r); if(!r.aborted&&!r.battleMode&&currentCategory) pushRecent(currentCategory); setView("result"); }}/>}
      {view==="result" && <Result score={result.score} total={result.total} history={result.history||[]} opponent={result.opponent} battleMode={result.battleMode}
        onBack={()=>{ setView("home"); setBattleMode(false); setBattleQuestions(null); setOpponent(null); }}/>}
      {view==="study" && <ListPage title="Study Material" items={studyItems} onBack={()=>setView("home")}/>}
      {view==="exams" && <ListPage title="Exam Notifications" items={examItems} onBack={()=>setView("home")}/>}
    </div>
  );
}
