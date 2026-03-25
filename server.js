require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const https = require('https');
const { classifyAll } = require('./classifier');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Google Sheets config ──
const SHEET_ID = '1-6Gniw0j4sw9cgXFQjuROVIASf5VCjAAgRAnd-UHQ7E';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let cache = { data: null, ts: 0 };

// ── Fetch CSV via https (follows redirects) ──
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchCSV(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ── Derive display name from URL ──
function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname.split('.')[0].replace(/-/g, ' ');
  } catch {
    return url;
  }
}

// ── Parse CSV → links array ──
// Spreadsheet columns (in order): Data, Link
// Type is assigned automatically by Claude. Name is derived from URL.
// Sparse rows: Data is filled only on the first row of each group.
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const dateIdx = headers.indexOf('data');
  const linkIdx = headers.indexOf('link');
  const nameIdx = headers.indexOf('name'); // optional column

  let lastDate = '';

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    const rawDate = dateIdx >= 0 ? cols[dateIdx] : '';
    const url     = linkIdx >= 0 ? cols[linkIdx] : '';
    const rawName = nameIdx >= 0 ? cols[nameIdx] : '';

    if (rawDate) lastDate = rawDate;
    if (!url) return null;

    return {
      category: '', // will be filled by classifier
      date:     lastDate,
      name:     rawName || nameFromUrl(url),
      url,
      preview:  ''
    };
  }).filter(Boolean);
}

// ── Fetch, parse, classify, and cache links ──
async function getLinks() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  console.log('[sheets] fetching CSV…');
  const csv = await fetchCSV(CSV_URL);
  const raw = parseCSV(csv);

  console.log(`[classifier] classifying ${raw.length} links…`);
  const data = await classifyAll(raw);

  cache = { data, ts: now };
  console.log(`[sheets] ready — ${data.length} links loaded`);
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
