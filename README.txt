PSC Guru – static site bundle (v2)

What's new in v2
- Random Quiz now supports: tab name, gid, or full Google Sheets URL tokens from your Categories.
- Smart question header detection: works with headers like Question/Que/Q and A/B/C/D or OptA-D, and Answer/Ans/Key/Correct/1-4.
- Safer text rendering (textContent) to avoid HTML swallowing your question text.

Files
- index.html (home, category loader UI)
- quiz.html (robust random mode + tolerant headers)
- resources.html / notices.html (shared sticky header)
- header.css / site-header.js (shared header styles & behavior)

Setup tips
- Ensure the whole workbook is Published to the web (File → Share → Publish to web).
- Each questions tab should have at least: Question + two or more options + Answer (text or A/B/C/D or 1..4).
