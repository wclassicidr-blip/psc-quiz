PSC Guru – v4 (Diagnostics build)

What’s new
- Quiz now tries FOUR ways to load a category:
  1) Direct published CSV URL (if your Categories cell contains a full CSV link)
  2) Publish‑to‑Web EKEY (works when you publish the entire workbook)
  3) Direct 'export?format=csv&gid=' (works when the workbook is shared "Anyone with link: Viewer")
  4) GViz fallback (also needs "Anyone with link")

- A visible DEBUG box in quiz.html shows exactly which URL succeeds or fails.
- If all fail, a small DEMO question set is shown so you know the UI is fine.

Required for Google Sheets
1) Best: File → Share → Publish to web → **Entire document**.
2) Or: Share → General access → **Anyone with the link: Viewer**.
3) In your Categories tab, the “sheet/get/tab” column may contain:
   - Tab name (e.g., General Knowledge)
   - gid=123456789 or just 123456789
   - Full Google Sheets link (even a published CSV link).

Troubleshooting
- Open Quiz page, look at the DEBUG block near the title.
- You should see “✅ Loaded: …csv”.
- If you see failures, copy the failing URL and try it in your browser; you will see the Google permission page that needs updating.
