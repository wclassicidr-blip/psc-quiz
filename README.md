
# Purple Quiz (Vite + React + Tailwind)

Quiz UI that loads categories & questions from a public Google Sheet.
- Robust GViz loader with CSV fallback
- **Fix:** Resolves sheet *name → gid* for published `/d/e/2PACX...` links

## Dev
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy (Vercel)
- Import repo in Vercel
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
