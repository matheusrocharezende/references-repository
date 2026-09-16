require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel's runtime caches outgoing fetch() calls by default; disable it so
// Supabase reads always hit the database instead of a stale response.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  global: {
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' })
  }
});

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

// ── Routes ──
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/links', async (req, res) => {
  try {
    const data = await getLinks();
    res.json(data);
  } catch (err) {
    console.error('[error]', err.message);
    res.status(500).json({ error: 'Failed to load links' });
  }
});

// Local dev: start server. Vercel imports this file as a module.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
