PSC Guru — Quizo (No-framework, vanilla HTML/CSS/JS)
================================================================

What this is
------------
A single-page web app that mirrors the provided mobile UI and loads *categories* and *questions*
from a Google Spreadsheet that is **Published to the web**. Each sheet/tab in the spreadsheet
acts as a *category*. Questions inside each sheet are parsed via the Google Visualization API.

How to use
----------
1) Publish your Google Sheet to the web.
   - File → Share → Publish to web → Entire document.
   - Copy the "pubhtml" URL.
2) Open `index.html` and set `window.SHEET_PUBLISH_URL` (already set to your link).
3) Deploy to Vercel / GitHub Pages or open locally.

Data format
-----------
Each sheet should contain headers (case-insensitive):
  - question
  - A, B, C, D (or option1..option4 / optionA..optionD)
  - correct (letter A/B/C/D or the full text of the correct answer)
  - explanation (optional)

The parser is tolerant: if 'answer' column exists, it's treated like 'correct'. If the 'correct'
cell contains the full answer text, we auto-map it to a letter by matching A..D option texts.

Notes
-----
- The app *auto-discovers* sheet/tab names (categories) by parsing the published HTML of the sheet.
  If your host blocks CORS when fetching `pubhtml`, you can set a proxy in `window.CORS_PROXY` in `index.html`.
  Example: `window.CORS_PROXY="https://cors.isomorphic-git.org/";`
- Question counts per round are: 10, 15, 20, 25, 30. Time per question is 30s.
- Bookmarks are saved to `localStorage` (simple list).

Generated
---------
This build was generated on 2025-10-15T12:09:46.553282.


Update: Supports a 'Categories' sheet with headers 'name (display)', 'sheet (actual tab name)', 'desc (optional)'. If present, it drives the category list and latest section.
