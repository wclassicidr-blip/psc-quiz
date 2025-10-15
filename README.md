
# Purple Quiz (Vite + React + Tailwind)

Frontend-only quiz UI that loads categories & questions from a public Google Sheet.
Deploys perfectly to Vercel.

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
- Push this repo to GitHub, then import it in Vercel.
- Framework preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Done.
```

## Google Sheets
Ensure your sheet tabs are published to the web. You can edit the constants at the top of `src/App.jsx` to match different tab names.
