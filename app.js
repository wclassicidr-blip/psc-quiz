
// --- CONFIG ---
const PUBHTML = window.SHEET_PUBLISH_URL;
const CORS_PROXY = window.CORS_PROXY || "https://cors.isomorphic-git.org/";
const CATEGORY_SHEET_NAME = "Categories";

// How many questions per round
const ROUND_SIZES = { 1: 10, 2: 15, 3: 20, 4: 25, 5: 30 };
const TIME_LIMIT = 30;

// --- STATE ---
const state = {
  round: 1,
  categories: [],   // [{name, tab, desc?}]
  selectedCategory: null,
  selectedTab: null,
  questions: [],
  qIndex: 0,
  selectedOption: null,
  answers: [],
  timer: { t: 0, id: null },
};

// DOM helpers
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const html = (s,...v)=>s.map((x,i)=>x+(i<v.length?v[i]:"")).join("");
function mount(node){ const app=document.getElementById("app"); app.innerHTML=""; app.appendChild(node); }
function cloneTpl(id){ return document.getElementById(id).content.firstElementChild.cloneNode(true); }

// Utils
const tryFetch = async (url) => {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) throw new Error("HTTP "+r.status);
    return r;
  } catch (e) {
    if (!CORS_PROXY) throw e;
    const r2 = await fetch(CORS_PROXY + url, { mode: "cors" });
    if (!r2.ok) throw new Error("HTTP "+r2.status);
    return r2;
  }
};
const parseGVizJSON = (text) => {
  const s=text.indexOf("{"), e=text.lastIndexOf("}");
  if (s===-1||e===-1) throw new Error("Bad GViz response");
  return JSON.parse(text.slice(s,e+1));
};
const norm = (k) => (k||"")
  .toString()
  .normalize("NFKD")
  .toLowerCase()
  .replace(/\u00a0/g," ")        // NBSP → space
  .replace(/[^a-z0-9]+/g,"")     // drop non-alnum
  .trim();

function tableToRows(table){
  // If labels are missing, use the first non-empty row as headers.
  let labels = (table.cols||[]).map(c => (c.label || c.id || ""));
  const noLabels = labels.every(x => !String(x||"").trim());
  let rows = (table.rows||[]);
  if (noLabels && rows.length){
    const headerCells = rows[0].c || [];
    labels = headerCells.map(c => (c ? c.v : ""));
    rows = rows.slice(1); // drop header row
  }
  const colKeys = labels.map(l => {
    const n = norm(l);
    return n || null;
  });
  return rows.map(r => {
    const obj = {};
    (r.c||[]).forEach((cell,i)=>{
      const key = colKeys[i] || ("col"+i);
      obj[key] = cell ? cell.v : null;
    });
    return obj;
  }).filter(row => Object.values(row).some(v => String(v||"").trim()));
}

function firstOf(row, candidates){
  for (const c of candidates){
    const v = row[norm(c)];
    if (v!=null && String(v).trim()!=="") return v;
  }
  return null;
}

function normalizeQuestion(row){
  const get = (keys) => firstOf(row, keys);
  const question = get(["question","questions","ques","prompt","col0"]);
  const A = get(["a","optiona","opt1","option1"]);
  const B = get(["b","optionb","opt2","option2"]);
  const C = get(["c","optionc","opt3","option3"]);
  const D = get(["d","optiond","opt4","option4"]);
  let correct = (get(["correct","answer","ans"])||"").toString().trim();
  const explanation = get(["explanation","answerexplanation","reason","why"]) || "";

  const options = { A, B, C, D };
  const letters = ["A","B","C","D"];
  if (correct && !/^[ABCD]$/i.test(correct)){
    const m = letters.find(L => (options[L]||"").toString().trim().toLowerCase() === correct.toLowerCase());
    if (m) correct = m;
  }
  if (/^[abcd]$/.test(correct)) correct = correct.toUpperCase();
  return { question, options, correct, explanation };
}

function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }

// Sheets fetchers
function publishBaseFromPubhtml(pubhtml){
  const m = pubhtml.match(/\/d\/e\/([^/]+)\/pubhtml/);
  if (!m) throw new Error("Invalid publish URL");
  return `https://docs.google.com/spreadsheets/d/e/${m[1]}`;
}
async function fetchGVizRows(pubhtml, sheetName){
  const base = publishBaseFromPubhtml(pubhtml);
  const url = `${base}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;
  const r = await tryFetch(url);
  const text = await r.text();
  const json = parseGVizJSON(text);
  return tableToRows(json.table);
}
async function fetchCategories(pubhtml){
  // Try explicit "Categories" sheet first. We tolerate weird headers.
  try{
    let rows = await fetchGVizRows(pubhtml, CATEGORY_SHEET_NAME);
    if (rows.length){
      // Try to map with normalized keys. Fallback to first 2 columns.
      const list = rows.map(r => {
        const name = firstOf(r, ["name (display)","display name","name","title","category","cat","col0"]);
        const tab  = firstOf(r, ["sheet (actual tab name)","sheet","tab","sheetname","actual tab name","gid name","col1"]);
        const desc = firstOf(r, ["desc (optional)","desc","description","about","notes","col2"]) || "";
        return { name: String(name||"").trim(), tab: String(tab||name||"").trim(), desc: String(desc||"").trim() };
      }).filter(x => x.name && x.tab);
      if (list.length) return list;
    }
  }catch(e){
    console.warn("Categories fetch fallback:", e.message);
  }
  // Fallback: parse published HTML for tab names
  const r = await tryFetch(pubhtml);
  const text = await r.text();
  const doc = new DOMParser().parseFromString(text, "text/html");
  const sels = [
    'ul#sheet-menu li a','.sheet-menu li a','a[aria-controls^="sheet"]','a[href^="#gid="]','[id^="sheet-button"] a'
  ];
  let names = [];
  for (const sel of sels){
    names.push(...Array.from(doc.querySelectorAll(sel)).map(a => a.textContent.trim()).filter(Boolean));
  }
  names = Array.from(new Set(names));
  return names.map(n => ({ name:n, tab:n }));
}

// UI
async function showSplash(text="Loading..."){
  const t = cloneTpl("splash-tpl"); $("#splash-text", t).textContent=text; mount(t);
}
async function showHome(){
  const node = cloneTpl("home-tpl"); mount(node);
  $$(".round-card", node).forEach(btn => {
    btn.addEventListener("click", () => { state.round=Number(btn.dataset.round); openCategoryModal(); });
  });
  $(".choose-cat-btn", node).addEventListener("click", openCategoryModal);
  $(".start-btn", node).addEventListener("click", () => { state.round=1; openCategoryModal(); });

  const latest = $("#latest-cats", node); latest.innerHTML="";
  state.categories.slice(-12).reverse().forEach(cat => {
    const chip = document.createElement("button");
    chip.className="chip"; chip.textContent=cat.name; chip.title=cat.desc||"";
    chip.addEventListener("click", ()=> beginRound(cat));
    latest.appendChild(chip);
  });
}
function openCategoryModal(){
  const node = cloneTpl("category-modal-tpl");
  const grid = $("#cat-grid", node), input=$("#cat-search", node);
  const render = (q="") => {
    grid.innerHTML="";
    state.categories.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).forEach(cat=>{
      const card=document.createElement("button"); card.className="cat-card";
      card.innerHTML = `<div style="font-weight:700">${cat.name}</div><div style="opacity:.7;font-size:13px;margin-top:4px">${cat.desc||""}</div>`;
      card.addEventListener("click", ()=>{ document.body.removeChild(node); beginRound(cat); });
      grid.appendChild(card);
    });
  };
  render();
  input.addEventListener("input", e=>render(e.target.value));
  node.addEventListener("click", e=>{ if (e.target.dataset.close) document.body.removeChild(node); });
  $(".close-modal", node).addEventListener("click", ()=> document.body.removeChild(node));
  document.body.appendChild(node);
}

async function beginRound(cat){
  state.selectedCategory = cat.name;
  state.selectedTab = cat.tab || cat.name;
  state.qIndex = 0; state.answers = []; state.selectedOption=null;
  await showSplash("Loading questions...");
  try{
    const rows = await fetchGVizRows(PUBHTML, state.selectedTab);
    const questions = rows.map(normalizeQuestion)
      .filter(q => q.question && (q.options.A||q.options.B||q.options.C||q.options.D));
    state.questions = shuffle(questions).slice(0, ROUND_SIZES[state.round] || 10);
    if (!state.questions.length) throw new Error("No questions found in tab: "+state.selectedTab);
    showQuiz();
  }catch(err){
    console.error(err);
    alert("Failed to load questions. Check sheet/tab name: "+state.selectedTab+"\n"+err.message);
    await showHome();
  }
}

function showQuiz(){
  const node = cloneTpl("quiz-tpl"); mount(node);
  $(".back-btn", node).addEventListener("click", ()=> showHome());
  $(".bookmark-btn", node).addEventListener("click", ()=> showBookmarks());

  const qtotal=state.questions.length;
  $('[data-bind="qtotal"]', node).textContent = qtotal;
  $('[data-bind="round"]', node).textContent = state.round;

  const qText=$("#question-text", node), optionsEl=$("#options", node),
        timeVal=$("#time-val", node), timeFill=$("#time-fill", node),
        submitBtn=$("#submit-btn", node), sheet=$("#explain-sheet", node),
        explainText=$("#explain-text", node), nextBtn=$("#next-btn", node),
        bookmarkBtn=$("#bookmark-this", node);

  function renderQuestion(){
    const i=state.qIndex, q=state.questions[i];
    $('[data-bind="qindex"]').textContent=i+1;
    qText.textContent=q.question;

    optionsEl.innerHTML="";
    ["A","B","C","D"].forEach(L=>{
      const txt=q.options[L]; if (!txt) return;
      const row=document.createElement("label"); row.className="opt";
      row.innerHTML = html`<input type="radio" name="opt" value="${L}" /><div class="letter">${L}</div><div class="text">${txt}</div>`;
      row.addEventListener("click", ()=>{ state.selectedOption=L; $$(".opt",optionsEl).forEach(x=>x.classList.remove("selected")); row.classList.add("selected"); });
      optionsEl.appendChild(row);
    });

    submitBtn.disabled=false; state.selectedOption=null; sheet.hidden=true;
    stopTimer();
    startTimer(TIME_LIMIT, (t,p)=>{ timeVal.textContent = fmtTime(TIME_LIMIT - t); timeFill.style.width=(p*100)+"%"; }, ()=>{
      state.answers.push({ chosen:null, correctLetter:q.correct, isCorrect:false, timedOut:true });
      showExplanation(q,false,true);
    });
  }

  submitBtn.addEventListener("click", ()=>{
    const i=state.qIndex, q=state.questions[i];
    if (!state.selectedOption){ alert("Please select an option."); return; }
    const ok = (state.selectedOption === (q.correct||"").toUpperCase());
    $$(".opt", optionsEl).forEach(el => {
      const val = $("input", el).value;
      if (val === q.correct) el.classList.add("correct");
      if (val === state.selectedOption && !ok) el.classList.add("wrong");
    });
    submitBtn.disabled=true; stopTimer();
    state.answers.push({ chosen:state.selectedOption, correctLetter:q.correct, isCorrect:ok, timedOut:false });
    showExplanation(q, ok, false);
  });

  function showExplanation(q, ok, timedOut){
    explainText.textContent = q.explanation || (ok ? "Correct!" : (timedOut ? "Time's up!" : "Better luck next time."));
    sheet.hidden=false;
    $("#bookmark-this", node).onclick = ()=>{
      const list = JSON.parse(localStorage.getItem("bookmarks")||"[]");
      list.push({ ...q, category: state.selectedCategory, savedAt: Date.now() });
      localStorage.setItem("bookmarks", JSON.stringify(list));
      alert("Saved to bookmarks!");
    };
    $("#next-btn", node).onclick = ()=>{
      state.qIndex++; if (state.qIndex>=qtotal) showResult(); else renderQuestion();
    };
  }
  renderQuestion();
}

function stopTimer(){ if (state.timer.id){ clearInterval(state.timer.id); state.timer.id=null; } }
function startTimer(s, onTick, onEnd){
  let t=0; onTick(0,0);
  state.timer.id=setInterval(()=>{ t++; onTick(t,t/s); if(t>=s){ clearInterval(state.timer.id); state.timer.id=null; onEnd(); } },1000);
}
const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

function showResult(){
  const node=cloneTpl("result-tpl"); mount(node);
  const total=state.questions.length, correct=state.answers.filter(a=>a.isCorrect).length,
        wrong=state.answers.filter(a=>a.chosen && !a.isCorrect).length,
        skipped=total-correct-wrong;
  $('[data-bind="round"]', node).textContent = `Round - ${state.round}`;
  $('[data-bind="category"]', node).textContent = state.selectedCategory;
  $('[data-bind="correct"]', node).textContent = correct;
  $('[data-bind="wrong"]', node).textContent = wrong;
  $('[data-bind="skipped"]', node).textContent = skipped;
  $(".again-btn", node).addEventListener("click", openCategoryModal);
  $(".home-btn", node).addEventListener("click", showHome);
}

function showBookmarks(){
  const list = JSON.parse(localStorage.getItem("bookmarks")||"[]");
  if(!list.length){ alert("No bookmarks yet."); return; }
  alert("Bookmarks:\n\n"+list.map((b,i)=>`${i+1}. [${b.category}] ${b.question}`).join("\n\n"));
}

// Boot
(async function(){
  await showSplash("Loading categories...");
  try{
    state.categories = await fetchCategories(PUBHTML);
    // Filter out helper sheets like 'Categories', 'README', etc.
    const ignore = new Set([CATEGORY_SHEET_NAME.toLowerCase(),"readme","config"]);
    state.categories = state.categories.filter(c => !ignore.has((c.tab||"").toLowerCase()));
    if (!state.categories.length) throw new Error("No categories (sheet tabs) found. Make sure the sheet is 'Published to the web' and has visible tabs.");
    await showHome();
  }catch(err){
    console.error(err);
    const app = document.getElementById("app");
    app.innerHTML = `<div class="wrap"><h2>Setup error</h2><p>${err.message}</p>
    <p>Tips:</p>
    <ul>
      <li>Ensure your Google Sheet is <b>Published to the web</b> (Entire document).</li>
      <li>If you keep a <b>Categories</b> sheet, include columns: <code>name (display)</code>, <code>sheet (actual tab name)</code>, <code>desc (optional)</code> (first row can be the header).</li>
      <li>We also accept using the <b>first two columns</b> as Name and Sheet when headers are absent.</li>
      <li>Make sure each category tab is visible and published.</li>
    </ul></div>`;
  }
})();
