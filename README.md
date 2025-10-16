
# Purple Quiz (Vite + React + Tailwind)

Fix for Vercel build error: removed invalid escapes in the regex used to
resolve sheet name → gid. This is production-ready for Vercel.

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
- Framework preset: Vite
- Build: `npm run build`
- Output: `dist`
