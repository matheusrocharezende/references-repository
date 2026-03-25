const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const CACHE_FILE = path.join(__dirname, 'classifications.json');

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ── Simple HTML entity decoder ──
function decode(str) {
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .trim();
}

// ── Fallback name from URL hostname ──
function nameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, ' ');
  } catch { return url; }
}

// ── Fetch only the <head> of a page (first 20KB, follows redirects) ──
function fetchHead(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };

    const req = mod.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return fetchHead(next, redirects - 1).then(done).catch(fail);
      }
      let body = '';
      res.on('data', chunk => {
        body += chunk;
        if (body.includes('</head>') || body.length > 25000) {
          done(body);
          res.destroy(); // stop reading but don't trigger req error
        }
      });
      res.on('end',   () => done(body));
      res.on('close', () => done(body));
      res.on('error', () => done(body)); // partial body is fine
    });
    req.on('timeout', () => { req.destroy(); fail(new Error('timeout')); });
    req.on('error',   (err) => fail(err));
  });
}

// ── Extract meta value by attribute pair ──
function getMeta(html, ...patterns) {
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) return decode(m[1]);
  }
  return '';
}

// ── Infer category from page content ──
const CATEGORY_KEYWORDS = {
  agency:     ['agency', 'advertising', 'creative agency', 'digital agency'],
  studio:     ['studio', 'design studio', 'independent studio'],
  gallery:    ['gallery', 'showcase', 'collection', 'inspiration', 'curated'],
  brand:      ['brand', 'brand identity', 'brand guidelines', 'visual identity'],
  strategy:   ['strategy', 'product strategy', 'consulting', 'advisor'],
  tool:       ['tool', 'app', 'software', 'platform', 'saas'],
  resource:   ['resource', 'library', 'reference', 'documentation'],
  portfolio:  ['portfolio', 'work', 'case studies', 'projects'],
  blog:       ['blog', 'articles', 'writing', 'posts', 'journal'],
};

function inferCategory(text) {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return '';
}

// ── Main: fetch site metadata ──
async function fetchSiteMeta(url) {
  const cache = loadCache();
  const cached = cache[url];
  if (cached && cached.name && cached.description !== undefined) {
    console.log(`[meta] cache hit: ${url}`);
    return cached;
  }

  try {
    const html = await fetchHead(url);

    // Name: og:site_name → title tag → fallback
    const siteName = getMeta(html,
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,80})["']/i,
      /<meta[^>]+content=["']([^"']{1,80})["'][^>]+property=["']og:site_name["']/i
    );
    const titleTag = getMeta(html,
      /<title[^>]*>([^<]{1,100})<\/title>/i
    );
    const name = (siteName || titleTag || nameFromUrl(url)).slice(0, 60);

    // Description: meta description → og:description
    const rawDesc = getMeta(html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i
    );
    const description = rawDesc.slice(0, 64);

    // Category: infer from combined text
    const combined = [name, description, titleTag].join(' ');
    const category = inferCategory(combined);

    const result = { name, description, category };
    console.log(`[meta] ${url} → "${name}" | "${description}" | ${category || '—'}`);

    cache[url] = result;
    saveCache(cache);
    return result;

  } catch (err) {
    console.warn(`[meta] failed ${url}: ${err.message}`);
    const fallback = { name: nameFromUrl(url), description: '', category: '' };
    cache[url] = fallback;
    saveCache(cache);
    return fallback;
  }
}

// ── Enrich all links (parallel, cached) ──
async function classifyAll(links) {
  return Promise.all(
    links.map(async (link) => {
      if (link.url) {
        const meta = await fetchSiteMeta(link.url);
        link.name        = link.name || meta.name;
        link.description = meta.description;
        link.category    = meta.category;
      }
      return link;
    })
  );
}

module.exports = { classifyAll };
