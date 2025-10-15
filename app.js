// --- CONFIG ---
const PUBHTML = window.SHEET_PUBLISH_URL;
const CORS_PROXY = window.CORS_PROXY || "";            // e.g. "https://cors.isomorphic-git.org/"
const CATEGORY_SHEET_NAME = "Categories";              // Sheet that lists category display + tab names (optional)

// How many questions per round
const ROUND_SIZES = { 1: 10, 2: 15, 3: 20, 4: 25, 5: 30 };
// Per-question time limit in seconds
const TIME_LIMIT = 30;

// --- STATE ---
const state = {
  round: 1,
  categories: [],   // [{name, tab, desc?}]
  selectedCategory: null, // display name
  selectedTab: null,
  questions: [],
  qIndex: 0,
  selectedOption: null,
  answers: [], // {chosen, correctLetter, isCorrect}
  timer: { t: 0, id: null },
};

// --- DOM helpers ---
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const html = (strings, ...vals) => strings.map((s,i)=>s+(i<vals.length?vals[i]:"")).join("");

function mount(node){
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(node);
}
function cloneTpl(id){
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// --- Utilities ---
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const tryFetch = async (url) => {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) throw new Error("HTTP "+r.status);
    return r;
  } catch (e) {
    if (!CORS_PROXY) throw e;
    const proxied = CORS_PROXY + url;
    const r2 = await fetch(proxied, { mode: "cors" });
    if (!r2.ok) throw new Error("HTTP "+r2.status);
    return r2;
  }
};
function parseGVizJSON(text){
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Bad GViz response");
  return JSON.parse(text.slice(start, end+1));
}
function rowsToObjects(table){
  const cols = table.cols.map(c => (c.label || c.id || "").toLowerCase().trim());
  return (table.rows || []).map(r => {
    const obj = {};
    cols.forEach((name, i)=>{
      const cell = r.c[i];
      obj[name || `col${i}`] = cell ? cell.v : null;
    });
    return obj;
  });
}
function normalizeQuestion(row){
  const key = k => Object.keys(row).find(x => x.toLowerCase().replace(/\s+/g,"") === k);
  const get = k => row[key(k)];
  const question = get("question") || get("questions") || row["col0"];
  const A = get("a") || get("optiona") || get("option1");
  const B = get("b") || get("optionb") || get("option2");
  const C = get("c") || get("optionc") || get("option3");
  const D = get("d") || get("optiond") || get("option4");
  let correct = (get("correct") || get("answer") || "").toString().trim();
  const explanation = get("explanation") || get("answerexplanation") || "";

  const options = { A, B, C, D };
  const letters = ["A","B","C","D"];
  if (correct && !/^[ABCD]$/i.test(correct)){
    const matchLetter = letters.find(L => (options[L]||"").toString().trim().toLowerCase() === correct.toLowerCase());
    if (matchLetter) correct = matchLetter;
  }
  if (/^[abcd]$/.test(correct)) correct = correct.toUpperCase();
  return { question, options, correct, explanation };
}
function shuffle(arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random() * (i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// --- Google Sheets fetching ---
function publishBaseFromPubhtml(pubhtml){
  const m = pubhtml.match(/\/d\/e\/([^/]+)\/pubhtml/);
  if (!m) throw new Error("Invalid publish URL");
  return `https://docs.google.com/spreadsheets/d/e/${m[1]}`;
}
async function fetchGVizSheet(pubhtml, sheetName){
  const base = publishBaseFromPubhtml(pubhtml);
  const url = `${base}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;
  const r = await tryFetch(url);
  const text = await r.text();
  const json = parseGVizJSON(text);
  return rowsToObjects(json.table).filter(row => {
    const values = Object.values(row).map(v => (v==null?"":String(v).trim()));
    return values.some(Boolean);
  });
}
async function fetchCategoriesFromCategorySheet(pubhtml){
  try{
    const rows = await fetchGVizSheet(pubhtml, CATEGORY_SHEET_NAME);
    if (!rows.length) return [];
    const list = rows.map(r => {
      // headers seen in screenshot:
      // "name (display)" | "sheet (actual tab name)" | "desc (optional)"
      const nm = r["name (display)"] || r["name"] || r["display"] || r["title"] || r["category"] || r["col0"];
      const tab = r["sheet (actual tab name)"] || r["sheet"] || r["tab"] || r["sheetname"] || r["actual tab name"] || r["col1"];
      const desc = r["desc (optional)"] || r["desc"] || r["description"] || "";
      return { name: String(nm||"").trim(), tab: String(tab||"").trim(), desc: String(desc||"").trim() };
    }).filter(x => x.name && x.tab);
    return list;
  }catch(e){
    // If Categories sheet doesn't exist or isn't published, just return []
    console.warn("Categories sheet fetch failed:", e.message);
    return [];
  }
}
async function fetchSheetTabsFromHtml(pubhtml){
  const r = await tryFetch(pubhtml);
  const text = await r.text();
  const doc = new DOMParser().parseFromString(text, "text/html");

  // Try several selectors because Google changes DOM often
  const selectors = [
    'ul#sheet-menu li a',
    '.sheet-menu li a',
    'a[aria-controls^="sheet"]',
    'a[href^="#gid="]',
    '[id^="sheet-button"] a',
  ];
  let names = [];
  for (const sel of selectors){
    const found = Array.from(doc.querySelectorAll(sel)).map(a => a.textContent.trim()).filter(Boolean);
    names.push(...found);
  }
  names = Array.from(new Set(names));
  // Filter out helper tabs often added like "Categories"
  return names;
}

// --- UI screens ---
async function showSplash(text="Loading..."){
  const tpl = cloneTpl("splash-tpl");
  $("#splash-text", tpl).textContent = text;
  mount(tpl);
}
async function showHome(){
  const node = cloneTpl("home-tpl");
  mount(node);

  $$(".round-card", node).forEach(btn => {
    btn.addEventListener("click", () => {
      state.round = Number(btn.dataset.round);
      openCategoryModal();
    });
  });
  $(".choose-cat-btn", node).addEventListener("click", openCategoryModal);
  $(".start-btn", node).addEventListener("click", () => {
    state.round = 1;
    openCategoryModal();
  });

  const latest = $("#latest-cats", node);
  latest.innerHTML = "";
  // show latest 12: take from end (assuming sheet top rows are older)
  const show = state.categories.slice(-12).reverse();
  show.forEach(cat => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = cat.name;
    chip.title = cat.desc || "";
    chip.addEventListener("click", () => beginRound(cat));
    latest.appendChild(chip);
  });
}

function openCategoryModal(){
  const node = cloneTpl("category-modal-tpl");
  const grid = $("#cat-grid", node);
  const input = $("#cat-search", node);

  function render(filter=""){
    grid.innerHTML = "";
    state.categories
      .filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
      .forEach(cat => {
        const card = document.createElement("button");
        card.className = "cat-card";
        card.innerHTML = html`<div class="title" style="font-weight:700">${cat.name}</div>
                              <div class="desc" style="opacity:.75;font-size:13px;margin-top:4px">${cat.desc||""}</div>`;
        card.addEventListener("click", () => {
          document.body.removeChild(node);
          beginRound(cat);
        });
        grid.appendChild(card);
      });
  }
  render();

  input.addEventListener("input", (e)=> render(e.target.value));
  node.addEventListener("click", (e)=>{ if (e.target.dataset.close) document.body.removeChild(node); });
  $(".close-modal", node).addEventListener("click", ()=> document.body.removeChild(node));
  document.body.appendChild(node);
}

async function beginRound(cat){
  state.selectedCategory = cat.name;
  state.selectedTab = cat.tab || cat.name;
  state.qIndex = 0;
  state.answers = [];
  state.selectedOption = null;

  await showSplash("Loading questions...");
  try{
    const rows = await fetchGVizSheet(PUBHTML, state.selectedTab);
    const questions = rows.map(normalizeQuestion)
      .filter(q => q.question && q.options && (q.options.A||q.options.B||q.options.C||q.options.D));
    state.questions = shuffle(questions).slice(0, ROUND_SIZES[state.round] || 10);
    if (state.questions.length === 0) throw new Error("No questions found");
    showQuiz();
  }catch(err){
    console.error(err);
    alert("Failed to load questions. Check sheet access / names.\n" + err.message);
    await showHome();
  }
}

function showQuiz(){
  const node = cloneTpl("quiz-tpl");
  mount(node);
  $(".back-btn", node).addEventListener("click", ()=> showHome());
  $(".bookmark-btn", node).addEventListener("click", ()=> showBookmarks());

  const qtotal = state.questions.length;
  $('[data-bind="qtotal"]', node).textContent = qtotal;
  $('[data-bind="round"]', node).textContent = state.round;

  const qText = $("#question-text", node);
  const optionsEl = $("#options", node);
  const timeVal = $("#time-val", node);
  const timeFill = $("#time-fill", node);
  const submitBtn = $("#submit-btn", node);
  const sheet = $("#explain-sheet", node);
  const explainText = $("#explain-text", node);
  const nextBtn = $("#next-btn", node);
  const bookmarkBtn = $("#bookmark-this", node);

  function renderQuestion(){
    const i = state.qIndex;
    const q = state.questions[i];
    $('[data-bind="qindex"]').textContent = i+1;
    qText.textContent = q.question;

    const letters = ["A","B","C","D"];
    optionsEl.innerHTML = "";
    letters.forEach(L => {
      const text = q.options[L];
      if (!text) return;
      const row = document.createElement("label");
      row.className = "opt";
      row.innerHTML = html`
        <input type="radio" name="opt" value="${L}" />
        <div class="letter">${L}</div>
        <div class="text">${text}</div>
      `;
      row.addEventListener("click", ()=>{
        state.selectedOption = L;
        $$(".opt", optionsEl).forEach(x=>x.classList.remove("selected"));
        row.classList.add("selected");
      });
      optionsEl.appendChild(row);
    });

    submitBtn.disabled = false;
    state.selectedOption = null;
    sheet.hidden = true;

    stopTimer();
    startTimer(TIME_LIMIT, (t, pct)=>{
      timeVal.textContent = fmtTime(TIME_LIMIT - t);
      timeFill.style.width = `${pct*100}%`;
    }, () => {
      state.answers.push({ chosen: null, correctLetter: q.correct, isCorrect: false, timedOut:true });
      showExplanation(q, false, true);
    });
  }

  submitBtn.addEventListener("click", ()=>{
    const i = state.qIndex;
    const q = state.questions[i];
    if (!state.selectedOption){
      alert("Please select an option.");
      return;
    }
    const isCorrect = (state.selectedOption === (q.correct || "").toUpperCase());
    $$(".opt", optionsEl).forEach(el => {
      const val = $("input", el).value;
      if (val === q.correct) el.classList.add("correct");
      if (val === state.selectedOption && !isCorrect) el.classList.add("wrong");
    });
    submitBtn.disabled = true;
    stopTimer();
    state.answers.push({ chosen: state.selectedOption, correctLetter: q.correct, isCorrect, timedOut:false });
    showExplanation(q, isCorrect, false);
  });

  function showExplanation(q, isCorrect, timedOut){
    explainText.textContent = q.explanation || (isCorrect ? "Correct!" : (timedOut ? "Time's up!" : "Better luck next time."));
    sheet.hidden = false;

    bookmarkBtn.onclick = () => {
      const bookmarks = JSON.parse(localStorage.getItem("bookmarks") || "[]");
      bookmarks.push({ ...q, category: state.selectedCategory, savedAt: Date.now() });
      localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
      alert("Saved to bookmarks!");
    };
    nextBtn.onclick = () => {
      state.qIndex++;
      if (state.qIndex >= qtotal){
        showResult();
      } else {
        renderQuestion();
      }
    };
  }

  renderQuestion();
}

function stopTimer(){ if (state.timer.id){ clearInterval(state.timer.id); state.timer.id = null; } }
function startTimer(seconds, onTick, onEnd){
  let t = 0;
  onTick(0, 0);
  state.timer.id = setInterval(()=>{
    t++;
    onTick(t, t/seconds);
    if (t >= seconds){
      clearInterval(state.timer.id);
      state.timer.id = null;
      onEnd();
    }
  }, 1000);
}
const fmtTime = s => {
  const m = Math.floor(s/60), ss = s%60;
  return String(m).padStart(2,"0") + ":" + String(ss).padStart(2,"0");
};

function showResult(){
  const node = cloneTpl("result-tpl");
  mount(node);

  const total = state.questions.length;
  const correct = state.answers.filter(a=>a.isCorrect).length;
  const wrong = state.answers.filter(a=>a.chosen && !a.isCorrect).length;
  const skipped = total - correct - wrong;

  $('[data-bind="round"]', node).textContent = `Round - ${state.round}`;
  $('[data-bind="category"]', node).textContent = state.selectedCategory;
  $('[data-bind="correct"]', node).textContent = correct;
  $('[data-bind="wrong"]', node).textContent = wrong;
  $('[data-bind="skipped"]', node).textContent = skipped;

  $(".again-btn", node).addEventListener("click", openCategoryModal);
  $(".home-btn", node).addEventListener("click", showHome);
}

function showBookmarks(){
  const list = JSON.parse(localStorage.getItem("bookmarks") || "[]");
  if (!list.length){ alert("No bookmarks yet."); return; }
  const names = list.map((b,i)=> `${i+1}. [${b.category}] ${b.question}` ).join("\n\n");
  alert("Bookmarks:\n\n"+names);
}

// --- Boot ---
(async function boot(){
  await showSplash("Loading categories...");
  try{
    // 1) Try Categories sheet
    let cats = await fetchCategoriesFromCategorySheet(PUBHTML);

    // 2) Fallback to tab discovery
    if (!cats.length){
      const names = await fetchSheetTabsFromHtml(PUBHTML);
      // Ignore helper tabs
      const ignore = new Set([CATEGORY_SHEET_NAME.toLowerCase(), "readme", "config"]);
      cats = names
        .filter(n => !ignore.has(n.toLowerCase()))
        .map(n => ({ name: n, tab: n }));
    }

    state.categories = cats;
    if (!state.categories.length){
      throw new Error("No categories (sheet tabs) found. Make sure the sheet is 'Published to the web' and has visible tabs.");
    }
    await showHome();
  }catch(err){
    console.error(err);
    const app = document.getElementById("app");
    app.innerHTML = `<div class="wrap"><h2>Setup error</h2><p>${err.message}</p>
    <p>Tips:</p>
    <ul>
      <li>Ensure your Google Sheet is <b>Published to the web</b> (Entire document).</li>
      <li>If you keep a <b>Categories</b> sheet, include columns: <code>name (display)</code>, <code>sheet (actual tab name)</code>, <code>desc (optional)</code>.</li>
      <li>Make sure each category's tab is visible and published.</li>
    </ul></div>`;
  }
})();
