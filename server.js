require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { classifyAll } = require('./classifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel's runtime caches outgoing fetch() calls by default; disable it so
// Supabase reads always hit the database instead of a stale response.
const noCacheFetch = (url, options = {}) => fetch(url, { ...options, cache: 'no-store' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  global: { fetch: noCacheFetch }
});

// Service-role client — only used server-side, for the admin write endpoint.
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: noCacheFetch }
    })
  : null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cache = { data: null, ts: 0 };

// ── Fetch links from Supabase and cache ──
async function getLinks() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  console.log('[supabase] fetching links…');
  const { data, error } = await supabase
    .from('links')
    .select('category, date, name, url, preview, description')
    .order('category', { ascending: true });

  if (error) throw error;

  cache = { data, ts: now };
  console.log(`[supabase] ready — ${data.length} links loaded`);
  return data;
}

// ── Derive display name from URL (fallback when classifier can't reach the site) ──
function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname.split('.')[0].replace(/-/g, ' ');
  } catch {
    return url;
  }
}

// ── Routes ──
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/links', async (req, res) => {
  try {
    const data = await getLinks();
    res.json(data);
  } catch (err) {
    console.error('[error]', err.message);
    res.status(500).json({ error: 'Failed to load links' });
  }
});

// ── Admin: verify password (gates the add-link screen client-side) ──
app.post('/api/admin/verify', (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin add-link is not configured' });
  }
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ ok: true });
});

// ── Admin: add a single link (fetches metadata + classifies with Claude, then saves) ──
app.post('/api/admin/links', async (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !supabaseAdmin) {
    return res.status(500).json({ error: 'Admin add-link is not configured' });
  }
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const url = (req.body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid url' }); }

  const date = (req.body.date || '').trim() ||
    `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;

  try {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('links')
      .select('name, category')
      .eq('url', url)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      return res.status(409).json({
        error: 'Link already exists',
        existing: true,
        name: existing.name,
        category: existing.category
      });
    }

    const [enriched] = await classifyAll([{ category: '', date, name: '', url, preview: '' }]);

    const row = {
      category: enriched.category || '',
      date,
      name: enriched.name || nameFromUrl(url),
      url,
      preview: '',
      description: enriched.description || ''
    };

    const { error } = await supabaseAdmin.from('links').upsert(row, { onConflict: 'url' });
    if (error) throw error;

    cache = { data: null, ts: 0 }; // force next read to refetch
    console.log(`[admin] added ${url} → ${row.category || '—'}`);
    res.json(row);
  } catch (err) {
    console.error('[admin] error', err.message);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// Local dev: start server. Vercel imports this file as a module.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
