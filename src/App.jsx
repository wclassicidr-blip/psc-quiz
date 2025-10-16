// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";

/** ===================== CONFIG ===================== */
// PASTE YOUR PUBLISHED SHEET ID BELOW (2PACX-...).
// Ensure: File → Share → Publish to web (the entire doc) is ON.
const PUB_ID = "2PACX-1vR4PuWTfq2838_kUaKcwmeWlKb5OtEmL6YqUX4DjPcrb6EaJfW-monSIqbZTiI3ZFrE6GBFHaP7k95A";

// Published endpoints
const PUB_HTML  = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pubhtml?widget=true&headers=false`;
const CSV_URL   = (gid) =>
  `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?gid=${gid}&single=true&output=csv`;

/** ===================== UTILITIES ===================== */
// Robust CSV parser (handles quotes, commas, newlines)
function parseCSV(text) {
  const rows = [];
  let i = 0, s = text, cell = "", row = [], inq = false;
  while (i < s.length) {
    const ch = s[i++];
    if (inq) {
      if (ch === '"' && s[i] === '"') { cell += '"'; i++; }
      else if (ch === '"') inq = false;
      else cell += ch;
    } else {
      if (ch === '"') inq = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* ignore */ }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function fetchSheetTabs() {
  // Parse pubhtml safely (no regex literals that break esbuild)
  const res  = await fetch(PUB_HTML, { credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to load pubhtml (${res.status})`);
  const html = await res.text();
  const doc  = new DOMParser().parseFromString(html, "text/html");
  const map = {};
  [...doc.querySelectorAll('a[href*="gid="]')].forEach(a => {
    const href = a.getAttribute("href") || "";
    const m = /gid=(\d+)/.exec(href);
    if (m) {
      const gid   = m[1];
      const title = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (title) map[title] = gid;
    }
  });
  if (!Object.keys(map).length) {
    throw new Error("No tabs found. Check if the sheet is Published to the web.");
  }
  return map; // { "Category Title": "123456789", ... }
}

async function fetchSheetRowsCSV(gid) {
  const r = await fetch(CSV_URL(gid), { credentials: "omit" });
  if (!r.ok) throw new Error(`Failed CSV for gid=${gid} (${r.status})`);
  const text = await r.text();
  const rows = parseCSV(text);
  if (!rows.length) return { header: [], rows: [] };
  const [header, ...body] = rows;
  return { header, rows: body };
}

function rowsToQuestions(header, rows) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const idx = Object.fromEntries(header.map((h, i) => [norm(h), i]));
  const get = (r, k) => r[idx[k]] ?? "";

  return rows
    .filter(r => r.some(c => (c || "").trim()))
    .map((r, i) => {
      const q = get(r, "question") || get(r, "q") || get(r, "questions") || "";
      const ans = get(r, "answer") || get(r, "ans") || "";
      const id  = get(r, "id") || String(i + 1);

      const optKeys = [
        "a","b","c","d","e",
        "option a","option b","option c","option d","option e",
        "option1","option2","option3","option4","option5"
      ];
      const opts = optKeys.map(k => get(r, k)).filter(Boolean);

      return { id, question: q, options: opts, answer: ans };
    })
    .filter(x => x.question); // keep only valid questions
}

/** ===================== APP ===================== */
export default function App() {
  const [tabMap, setTabMap] = useState({});
  const [categories, setCategories] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [catError, setCatError] = useState("");

  const [mode, setMode] = useState("category"); // "category" | "random"
  const [selectedCategory, setSelectedCategory] = useState("");
  const [count, setCount] = useState(10);

  const [loadingQs, setLoadingQs] = useState(false);
  const [qsError, setQsError] = useState("");
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [responses, setResponses] = useState({}); // id -> chosen option index

  // Load categories (tab titles)
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoadingCats(true);
        setCatError("");
        const map = await fetchSheetTabs();
        if (!on) return;
        setTabMap(map);
        setCategories(Object.keys(map).sort());
      } catch (e) {
        setCatError(
          (e && e.message) || "Failed to load categories. Ensure the sheet is Published to the web."
        );
      } finally {
        if (on) setLoadingCats(false);
      }
    })();
    return () => { on = false; };
  }, []);

  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return Math.round(((idx + 1) / questions.length) * 100);
  }, [idx, questions.length]);

  async function loadCategoryQuestions(name) {
    const gid = tabMap[name];
    if (!gid) throw new Error(`Unknown category: ${name}`);
    const { header, rows } = await fetchSheetRowsCSV(gid);
    return rowsToQuestions(header, rows);
  }

  async function handleStart() {
    try {
      setQsError("");
      setLoadingQs(true);
      setQuestions([]);
      setIdx(0);
      setShowAnswer(false);
      setResponses({});

      if (mode === "category") {
        if (!selectedCategory) {
          setQsError("Please select a category.");
          return;
        }
        const qs = await loadCategoryQuestions(selectedCategory);
        const final = qs.slice(0, Number(count) || 10);
        setQuestions(final);
      } else {
        // Random: pick a random category, then randomize questions
        const cats = Object.keys(tabMap);
        if (!cats.length) throw new Error("No categories available.");
        const pick = cats[Math.floor(Math.random() * cats.length)];
        const qs = await loadCategoryQuestions(pick);
        const shuffled = qs.sort(() => Math.random() - 0.5).slice(0, Number(count) || 10);
        setSelectedCategory(pick); // Show which category got picked
        setQuestions(shuffled);
      }
    } catch (e) {
      setQsError((e && e.message) || "Failed to load questions. Check sheet access / names.");
    } finally {
      setLoadingQs(false);
    }
  }

  function handleChoose(optionIndex) {
    const q = questions[idx];
    if (!q) return;
    setResponses(prev => ({ ...prev, [q.id]: optionIndex }));
  }

  function handleNext() {
    setShowAnswer(false);
    if (idx < questions.length - 1) setIdx(idx + 1);
  }

  function handlePrev() {
    setShowAnswer(false);
    if (idx > 0) setIdx(idx - 1);
  }

  function handleQuit() {
    setQuestions([]);
    setIdx(0);
    setShowAnswer(false);
    setResponses({});
  }

  const result = useMemo(() => {
    if (!questions.length) return null;
    let correct = 0;
    questions.forEach(q => {
      const chosen = responses[q.id];
      const ans = (q.answer || "").trim().toLowerCase();
      const chosenText = Number.isInteger(chosen) ? (q.options[chosen] || "").trim().toLowerCase() : "";
      // If no options sheet, allow direct text compare
      if (q.options.length) {
        if (chosenText && (chosenText === ans)) correct += 1;
      } else {
        // No options; treat any non-empty response as incorrect here
        // (Can be extended to accept free-text answers)
      }
    });
    return { correct, total: questions.length };
  }, [questions, responses]);

  return (
    <div style={{maxWidth: 960, margin: "0 auto", padding: "20px"}}>
      <h1 style={{fontSize: 28, fontWeight: 700, marginBottom: 12}}>PSC Quiz</h1>

      {/* Category Loader */}
      {loadingCats && <p>Loading categories…</p>}
      {!loadingCats && catError && (
        <div style={{background:"#fee2e2", border:"1px solid #fecaca", padding:"10px", borderRadius:8, color:"#7f1d1d", marginBottom:12}}>
          {catError}<br/>
          <small>Tip: Make sure your Google Sheet is published (File → Share → Publish to web). Then redeploy.</small>
        </div>
      )}

      {/* Start Panel */}
      {!questions.length && !loadingCats && !catError && (
        <div style={{display:"grid", gap:12, padding:"12px", border:"1px solid #e5e7eb", borderRadius:12}}>
          <div>
            <label style={{display:"block", fontSize:14, color:"#6b7280"}}>Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              style={{padding:"10px", width:"100%"}}
            >
              <option value="category">Pick a Category</option>
              <option value="random">Random Quiz</option>
            </select>
          </div>

          {mode === "category" && (
            <div>
              <label style={{display:"block", fontSize:14, color:"#6b7280"}}>Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{padding:"10px", width:"100%"}}
              >
                <option value="">— Select —</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{display:"block", fontSize:14, color:"#6b7280"}}>Number of Questions</label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              style={{padding:"10px", width:"100%"}}
            />
          </div>

          <button
            onClick={handleStart}
            disabled={loadingQs}
            style={{padding:"12px", borderRadius:10, background:"#0f172a", color:"#fff", fontWeight:700}}
          >
            {loadingQs ? "Starting…" : "Start Quiz"}
          </button>

          {mode === "random" && selectedCategory && (
            <div style={{fontSize:12, color:"#6b7280"}}>Random picked category: <b>{selectedCategory}</b></div>
          )}

          {qsError && (
            <div style={{background:"#fee2e2", border:"1px solid #fecaca", padding:"10px", borderRadius:8, color:"#7f1d1d"}}>
              {qsError}
            </div>
          )}
        </div>
      )}

      {/* Quiz Panel */}
      {!!questions.length && (
        <div style={{marginTop:16}}>
          {/* Progress bar */}
          <div style={{background:"#e5e7eb", height:10, borderRadius:8, overflow:"hidden", marginBottom:12}}>
            <div style={{width:`${progress}%`, height:"100%", background:"#10b981"}} />
          </div>

          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
            <div style={{fontSize:14, color:"#6b7280"}}>
              Question {idx + 1} / {questions.length}
              {mode === "random" && selectedCategory ? (
                <span style={{marginLeft:8, fontSize:12, color:"#6b7280"}}>• {selectedCategory}</span>
              ) : null}
            </div>
            <button
              onClick={handleQuit}
              style={{padding:"8px 12px", background:"#fee2e2", color:"#7f1d1d", border:"1px solid #fecaca", borderRadius:8}}
            >
              Quit Quiz
            </button>
          </div>

          {/* Question card */}
          <div style={{border:"1px solid #e5e7eb", borderRadius:12, padding:16}}>
            <div style={{fontWeight:700, marginBottom:10}}>
              {questions[idx]?.question || "—"}
            </div>
            {/* Options (if any) */}
            {questions[idx]?.options?.length ? (
              <div style={{display:"grid", gap:8}}>
                {questions[idx].options.map((opt, i) => {
                  const chosen = responses[questions[idx].id];
                  const isChosen = chosen === i;
                  return (
                    <button
                      key={i}
                      onClick={() => handleChoose(i)}
                      style={{
                        textAlign:"left",
                        padding:"10px",
                        borderRadius:10,
                        border: isChosen ? "2px solid #0ea5e9" : "1px solid #e5e7eb",
                        background: "#fff"
                      }}
                    >
                      {opt || "(blank)"}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{fontSize:14, color:"#6b7280"}}>No options provided for this question.</div>
            )}

            {/* Controls */}
            <div style={{display:"flex", gap:8, marginTop:12}}>
              <button onClick={handlePrev} disabled={idx===0} style={{padding:"10px 14px", borderRadius:10, border:"1px solid #e5e7eb"}}>Prev</button>
              <button onClick={() => setShowAnswer(s => !s)} style={{padding:"10px 14px", borderRadius:10, border:"1px solid #e5e7eb"}}>
                {showAnswer ? "Hide Answer" : "Show Answer"}
              </button>
              <button onClick={handleNext} disabled={idx===questions.length-1} style={{padding:"10px 14px", borderRadius:10, background:"#0f172a", color:"#fff"}}>
                Next
              </button>
            </div>

            {showAnswer && (
              <div style={{marginTop:10, padding:10, border:"1px dashed #10b981", borderRadius:10, background:"#ecfdf5"}}>
                <div style={{fontSize:14, color:"#065f46"}}>
                  Correct answer: <b>{questions[idx]?.answer || "(none provided)"}</b>
                </div>
              </div>
            )}
          </div>

          {/* Results (when finished) */}
          {idx === questions.length - 1 && (
            <div style={{marginTop:12, fontSize:14}}>
              <b>Summary:</b> {result?.correct ?? 0} / {result?.total ?? 0} correct
            </div>
          )}
        </div>
      )}
    </div>
  );
}
