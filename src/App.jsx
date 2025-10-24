/* ---- Answer Keys: same UX as Syllabus (flat cards) ---- */
async function loadAnswerKeyList(){
  try{
    // CORS-safe text mirror of the official page
    const SRC = 'https://r.jina.ai/http://www.keralapsc.gov.in/answerkey_onlineexams'
    const res = await fetch(SRC, { cache: 'no-store' })
    if(!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()

    // local helpers (scoped)
    const clean = (s='') => stripMarkdown(s).replace(/\s+/g,' ').trim()
    const firstLinkIn = (s='') => {
      const m1 = s.match(/\[([^\]]*)]\((https?:\/\/[^\s)]+)\)/i)
      if (m1) return normalizeUrl(m1[2])
      const m2 = s.match(/\bhttps?:\/\/[^\s)]+/i)
      return m2 ? normalizeUrl(m2[0]) : ''
    }
    const pickKeyUrl = (finalCell='', keyCell='') => {
      const f = firstLinkIn(finalCell)
      if (f) return { url:f, tag:'Final' }
      const k = firstLinkIn(keyCell)
      return k ? { url:k, tag:'Provisional' } : { url:'', tag:'' }
    }
    const isBare = (t) => /^details?$/i.test((t||'').trim())

    // Try markdown tables first (how r.jina.ai usually exposes it)
    const tables = extractMarkdownTables(md)
    const relevant = tables.filter(t => t.headers.some(h => /post/i.test(h)))

    let items = []
    for (const t of relevant){
      const H = t.headers.map(h => h.toLowerCase())
      const idx = {
        post:  H.findIndex(h => /post/.test(h)),
        details:H.findIndex(h => /detail/.test(h)),
        final: H.findIndex(h => /(final.*answer.*key|final key)/.test(h)),
        key:   H.findIndex(h => /(answer.*key)/.test(h)),
        cat:   H.findIndex(h => /(category\s*no|cat.*no)/.test(h)),
        date:  H.findIndex(h => /(date.*test|date)/.test(h)),
      }
      for (const row of t.rows){
        const post = clean(row[idx.post] || '')
        if (!post) continue
        const { url, tag } = pickKeyUrl(row[idx.final]||'', row[idx.key]||'')
        if (!url) continue

        let desc = clean(row[idx.details] || '')
        if (!desc || isBare(desc)){
          const cat = clean(row[idx.cat] || '')
          const date = clean(row[idx.date] || '')
          desc = [cat && `Category: ${cat}`, date && `Date: ${date}`].filter(Boolean).join(' • ')
        }
        // prefix tag so it feels like the Syllabus “language” label
        const finalDesc = tag ? `${tag} • ${desc}` : desc
        items.push({ title: post, url, desc: finalDesc, date:'', duration:'', questions:'' })
      }
    }

    // Fallback: block-label parser (if tables aren’t present)
    if (!items.length){
      const lines = md.split('\n').map(l => l.trim())
      let cur = null
      const flush = () => {
        if(!cur) return
        const linkInfo = pickKeyUrl(cur.finalCell||'', cur.keyCell||'')
        if (cur.post && linkInfo.url){
          let desc = clean(cur.details||'')
          if (!desc || isBare(desc)){
            const parts = []
            if (cur.cat) parts.push(`Category: ${clean(cur.cat)}`)
            if (cur.date) parts.push(`Date: ${clean(cur.date)}`)
            desc = parts.join(' • ')
          }
          const finalDesc = linkInfo.tag ? `${linkInfo.tag} • ${desc}` : desc
          items.push({ title: clean(cur.post), url: linkInfo.url, desc: finalDesc, date:'', duration:'', questions:'' })
        }
        cur = null
      }
      for (const ln of lines){
        if (/^post\b/i.test(ln)){ flush(); cur = { post: ln.replace(/^post\s*[:|]?\s*/i,'') } }
        else if (/^category\s*no\b/i.test(ln)){ cur ??= {}; cur.cat = ln.replace(/^category\s*no\s*[:|]?\s*/i,'') }
        else if (/^(date|date of test)\b/i.test(ln)){ cur ??= {}; cur.date = ln.replace(/^(date|date of test)\s*[:|]?\s*/i,'') }
        else if (/^final\s*answer\s*key\b/i.test(ln)){ cur ??= {}; cur.finalCell = ln }
        else if (/^answer\s*key\b/i.test(ln)){ cur ??= {}; cur.keyCell = ln }
        else if (/^details\b/i.test(ln)){ cur ??= {}; cur.details = ln.replace(/^details\s*[:|]?\s*/i,'') }
      }
      flush()
    }

    // sanitize + dedupe (by URL) and cap
    items = dedupeBy(items, it => it.url).filter(Boolean).slice(0, 300)

    if (items.length) return items
    // last resort (shouldn’t happen once the page shape is stable)
    return [{
      title: 'Kerala PSC Answer Keys — Official Page',
      url: 'https://www.keralapsc.gov.in/answerkey_onlineexams',
      desc: 'Browse available answer keys for online exams.',
      date:'', duration:'', questions:''
    }]
  } catch (e){
    console.warn('AnswerKey load failed', e)
    return [{
      title: 'Kerala PSC Answer Keys — Official Page',
      url: 'https://www.keralapsc.gov.in/answerkey_onlineexams',
      desc: 'Browse available answer keys for online exams.',
      date:'', duration:'', questions:''
    }]
  }
}
