// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Tesla Careers official search-page provider.
// Tesla's public Austin search is server-rendered enough to expose canonical
// /careers/search/job/<slug>-<id> links. This provider only reads that official
// listing page; it does not click, apply, or bypass access controls.

const DEFAULT_URL = 'https://www.tesla.com/careers/search/?location=Austin&site=US&state=TX';
const JOB_RE = /href=["']([^"']*\/careers\/search\/job\/([a-z0-9][a-z0-9-]*?)-(\d+)(?:\?[^"']*)?)["']/gi;

function titleFromSlug(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function parseTeslaSearch(html, entry = {}) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(JOB_RE)) {
    const [, href, slug, id] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    let url;
    try { url = new URL(href, 'https://www.tesla.com').href; } catch { continue; }
    out.push({
      title: titleFromSlug(slug),
      url,
      company: entry.name || 'Tesla',
      location: entry.tesla?.location || 'Austin, Texas',
      externalId: id,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'tesla',

  detect(entry) {
    if (entry.tesla) return { url: entry.careers_url || DEFAULT_URL };
    try {
      const u = new URL(entry.careers_url || '');
      if ((u.host === 'tesla.com' || u.host === 'www.tesla.com') && u.pathname.includes('/careers/search')) {
        return { url: u.href };
      }
    } catch { /* not an absolute URL */ }
    return null;
  },

  async fetch(entry, ctx) {
    const url = entry.careers_url || DEFAULT_URL;
    const html = await ctx.fetchText(url, { redirect: 'error' });
    return parseTeslaSearch(html, entry);
  },
};
