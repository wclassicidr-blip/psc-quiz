PSC Guru – v3 (CSV-first loader)

What changed
- Quiz now fetches question tabs via Publish‑to‑Web CSV first (works even if the doc is not set to “Anyone with link”). 
- Supports tokens in Categories as: Tab Name, 'gid=123456', or plain gid '123456'.
- Falls back to GViz if CSV is unavailable.
- Tolerant header mapping (Question/Que/Q; A/B/C/D or OptA–D; Answer/Ans/Key/Correct/1-4).

Checklist
1) In Google Sheets: File → Share → **Publish to web** → Entire document.
2) Keep your existing E‑key in the code (GS_PUB_EKEY).
3) In Categories, the column for “get/sheet/tab” can contain either the **tab name** or **gid**.
