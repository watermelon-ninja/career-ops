// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Apple Careers official server-rendered search provider.
// Pages are read-only GETs against jobs.apple.com. The Austin lane walks the
// official pagination and dedupes canonical /details/<role-number>/<slug> URLs.

const DEFAULT_URL = 'https://jobs.apple.com/en-us/search?location=austin-AST';
const DEFAULT_MAX_PAGES = 80;
const DETAIL_RE = /href=["']([^"']*\/details\/(\d{6,}(?:-\d{4})?)\/([a-z0-9][a-z0-9-]*))[^"']*["']/gi;

function titleFromSlug(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function parseAppleSearch(html, entry = {}) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(DETAIL_RE)) {
    const [, href, roleNumber, slug] = m;
    if (seen.has(roleNumber)) continue;
    seen.add(roleNumber);
    let url;
    try { url = new URL(href, 'https://jobs.apple.com').href; } catch { continue; }
    out.push({
      title: titleFromSlug(slug),
      url,
      company: entry.name || 'Apple',
      location: entry.apple?.location || 'Austin, Texas',
      externalId: roleNumber,
    });
  }
  return out;
}

function withPage(raw, page) {
  const u = new URL(raw);
  if (page <= 1) u.searchParams.delete('page');
  else u.searchParams.set('page', String(page));
  return u.href;
}

/** @type {Provider} */
export default {
  id: 'apple',

  detect(entry) {
    if (entry.apple) return { url: entry.careers_url || DEFAULT_URL };
    try {
      const u = new URL(entry.careers_url || '');
      if (u.host === 'jobs.apple.com' && u.pathname.includes('/search')) return { url: u.href };
    } catch { /* not an absolute URL */ }
    return null;
  },

  async fetch(entry, ctx) {
    const base = entry.careers_url || DEFAULT_URL;
    const maxPages = Math.max(1, Math.min(Number(entry.apple?.max_pages || DEFAULT_MAX_PAGES), 200));
    const byId = new Map();
    let emptyStreak = 0;

    for (let page = 1; page <= maxPages; page++) {
      const html = await ctx.fetchText(withPage(base, page), { redirect: 'error' });
      const rows = parseAppleSearch(html, entry);
      let fresh = 0;
      for (const row of rows) {
        if (byId.has(row.externalId)) continue;
        byId.set(row.externalId, row);
        fresh++;
      }
      if (fresh === 0) emptyStreak++;
      else emptyStreak = 0;
      // Two consecutive pages with no new canonical roles means pagination is exhausted
      // (or the site repeated the terminal page). This avoids a false stop on one sparse page.
      if (emptyStreak >= 2) break;
    }

    return [...byId.values()];
  },
};
