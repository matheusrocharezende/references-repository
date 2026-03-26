const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Vercel filesystem is read-only except /tmp
const CACHE_FILE = process.env.VERCEL
  ? '/tmp/classifications.json'
  : path.join(__dirname, 'classifications.json');

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

// ── Fetch only the <head> of a page (first 25KB, follows redirects) ──
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
          res.destroy();
        }
      });
      res.on('end',   () => done(body));
      res.on('close', () => done(body));
      res.on('error', () => done(body));
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

// ── Claude-powered description + classification ──
const anthropic = new Anthropic();

const VALID_CATEGORIES = ['agency', 'studio', 'brand', 'gallery', 'tool', 'resource', 'portfolio', 'blog', 'strategy'];

async function enrichWithClaude(name, rawDescription, url) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `You are analyzing a design/creative website. Return a JSON object with exactly two keys: "description" and "category".

Rules:
- "description": one short sentence (max 60 chars) describing what the site is or does. Be specific and concise.
- "category": exactly one of: agency, studio, brand, gallery, tool, resource, portfolio, blog, strategy
  - agency: creative/advertising/digital agency
  - studio: independent design or creative studio
  - brand: brand identity, brand guidelines, visual identity
  - gallery: curated inspiration, showcases, design collections
  - tool: apps, software, SaaS, design tools
  - resource: libraries, templates, references, documentation
  - portfolio: personal portfolio, case studies
  - blog: articles, writing, journals
  - strategy: consulting, product strategy, advisory

Site name: ${name}
URL: ${url}
Raw meta: ${rawDescription || 'n/a'}

Reply with only the JSON object, no other text.`
      }]
    });

    let text = response.content[0].text.trim();
    // Extract JSON object robustly — handles markdown fences or extra text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    const parsed = JSON.parse(jsonMatch[0]);
    const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'resource';
    const description = (parsed.description || '').slice(0, 80);
    console.log(`[claude] "${category}" | "${description.slice(0, 40)}"`);
    return { description, category };
  } catch (err) {
    console.warn(`[claude] enrichment failed for ${url}: ${err.message}`);
    return { description: rawDescription.slice(0, 80), category: '' };
  }
}

// ── Main: fetch site metadata + classify with Claude ──
async function fetchSiteMeta(url) {
  const cache = loadCache();
  const cached = cache[url];
  if (cached && cached.name && cached.category) {
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
    // Description + Category: Claude API (single call)
    const { description, category } = await enrichWithClaude(name, rawDesc.slice(0, 200), url);

    const result = { name, description, category };
    console.log(`[meta] ${url} → "${name}" | "${description.slice(0, 40)}" | ${category || '—'}`);

    // Reload cache before saving to avoid race condition with parallel fetches
    const freshCache = loadCache();
    freshCache[url] = result;
    saveCache(freshCache);
    return result;

  } catch (err) {
    console.warn(`[meta] failed ${url}: ${err.message}`);
    const fallback = { name: nameFromUrl(url), description: '', category: '' };
    const freshCache = loadCache();
    freshCache[url] = fallback;
    saveCache(freshCache);
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
