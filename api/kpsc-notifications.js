// /api/kpsc-notifications.js
// Fetches latest 2025 Kerala PSC notifications from the official site and returns JSON.

const ORIGIN = "https://www.keralapsc.gov.in";
const INDEX_URL = `${ORIGIN}/notifications`;

function abs(u) { return u.startsWith("http") ? u : ORIGIN + u; }
function pick(re, s) { const m = re.exec(s); return m ? m[1] : null; }

export default async function handler(req, res) {
  try {
    const limit = Math.max(5, Math.min(100, Number(req.query.limit) || 40));

    // 1) Fetch the main notifications index
    const ixResp = await fetch(INDEX_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PSC-Guru/1.0)" }
    });
    const ixHtml = await ixResp.text();

    // 2) Grab the most recent "EXTRA ORDINARY GAZETTE DATE" pages for 2025
    // Example match: <a href="/extra-ordinary-gazette-date-15102025">EXTRA ORDINARY GAZETTE DATE 15/10/2025</a>
    const gazetteLinkRe = /<a[^>]+href="([^"]+extra-ordinary-gazette-date-[^"]+)"[^>]*>\s*EXTRA\s+ORDINARY\s+GAZETTE\s+DATE\s+(\d{2}\/\d{2}\/\d{4})\s*<\/a>/gi;

    const gazettes = [];
    let m;
    while ((m = gazetteLinkRe.exec(ixHtml)) && gazettes.length < 4) {
      const url = abs(m[1]);
      const date = m[2]; // dd/mm/yyyy
      if (date.endsWith("/2025")) gazettes.push({ url, date });
    }

    // 3) For each gazette page, extract the Notification links (PDFs) for 2025
    const items = [];
    for (const g of gazettes) {
      const gzResp = await fetch(g.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PSC-Guru/1.0)" }
      });
      const gzHtml = await gzResp.text();

      // Confirm the gazette date from page (fallback to g.date)
      const pageDate = pick(/GAZETTE DATE\s*(\d{2}\/\d{2}\/\d{4})/i, gzHtml) || g.date;

      // Find PDF anchors and titles
      // Example: <a href=".../noti-382-25.pdf">Junior Assistant ... (Cat.No.382/2025)</a>
      const linkRe = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRe.exec(gzHtml))) {
        const href = abs(lm[1]);
        const title = lm[2].replace(/\s+/g, " ").trim();
        if (!/\/2025\)/i.test(title) && !/2025/.test(title)) continue; // keep 2025 items only

        const catNo = pick(/Cat\.?No\.?\s*[:.]?\s*([0-9]+\/2025)/i, title) || null;
        const lastDate = pick(/Last\s*date[^<:]*[:\s]\s*([0-9]{2}-[0-9]{2}-[0-9]{4})/i, gzHtml) || null;

        items.push({
          title,
          pdfUrl: href,
          catNo,
          gazetteDate: pageDate,
          lastDate,
          source: g.url
        });
      }
    }

    // 4) Sort by gazette date desc, then catNo desc
    const toNum = s => (s ? Number(s.split("/")[0]) : -1);
    const parseDate = d => {
      if (!d) return 0;
      const [dd, mm, yyyy] = d.includes("/") ? d.split("/") : d.split("-");
      return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
    };

    items.sort((a, b) => {
      const dg = parseDate(b.gazetteDate) - parseDate(a.gazetteDate);
      if (dg !== 0) return dg;
      return toNum(b.catNo) - toNum(a.catNo);
    });

    const out = items.slice(0, limit);

    res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=86400");
    res.status(200).json({ updatedAt: new Date().toISOString(), count: out.length, items: out });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
