const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Google Sheets config ──
const SHEET_ID = '1-6Gniw0j4sw9cgXFQjuROVIASf5VCjAAgRAnd-UHQ7E';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let cache = { data: null, ts: 0 };

// ── Fetch CSV via https ──
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects (Google Sheets does a 302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchCSV(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ── Parse name from URL ──
function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const name = hostname.split('.')[0].replace(/-/g, ' ');
    return name;
  } catch {
    return url;
  }
}

// ── Parse CSV → links array ──
// Supports columns: Type, Data, Name (optional), Link
// Sparse rows: Type and Data are only filled on the first row of each group
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const typeIdx = headers.indexOf('type');
  const dateIdx = headers.indexOf('data');
  const nameIdx = headers.indexOf('name');
  const linkIdx = headers.indexOf('link');

  let lastType = '';
  let lastDate = '';

  return lines.slice(1).map(line => {
    // Basic CSV parse: split on commas, strip surrounding quotes
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    const rawType = typeIdx >= 0 ? cols[typeIdx] : '';
    const rawDate = dateIdx >= 0 ? cols[dateIdx] : '';
    const rawName = nameIdx >= 0 ? cols[nameIdx] : '';
    const url     = linkIdx >= 0 ? cols[linkIdx] : '';

    // Propagate sparse values
    if (rawType) lastType = rawType;
    if (rawDate) lastDate = rawDate;

    if (!url) return null;

    return {
      category: lastType.toLowerCase(),
      date:     lastDate,
      name:     rawName || nameFromUrl(url),
      url,
      preview:  ''
    };
  }).filter(Boolean);
}

// ── Fetch + cache links ──
async function getLinks() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  const csv = await fetchCSV(CSV_URL);
  const data = parseCSV(csv);
  cache = { data, ts: now };
  console.log(`[sheets] fetched ${data.length} links`);
  return data;
}

// ── Routes ──
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/links', async (req, res) => {
  try {
    const data = await getLinks();
    res.json(data);
  } catch (err) {
    console.error('[sheets] error:', err.message);
    res.status(500).json({ error: 'Failed to load links from Google Sheets' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
