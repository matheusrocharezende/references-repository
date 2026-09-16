require('dotenv').config({ override: true });
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { classifyAll } = require('./classifier');

const SHEET_ID = '1-6Gniw0j4sw9cgXFQjuROVIASf5VCjAAgRAnd-UHQ7E';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname.split('.')[0].replace(/-/g, ' ');
  } catch {
    return url;
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const dateIdx = headers.indexOf('data');
  const linkIdx = headers.indexOf('link');
  const nameIdx = headers.indexOf('name');
  const typeIdx = headers.indexOf('type');

  let lastDate = '';

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    const rawDate = dateIdx >= 0 ? cols[dateIdx] : '';
    const url     = linkIdx >= 0 ? cols[linkIdx] : '';
    const rawName = nameIdx >= 0 ? cols[nameIdx] : '';
    const rawType = typeIdx >= 0 ? cols[typeIdx].toLowerCase() : '';

    if (rawDate) lastDate = rawDate;
    if (!url) return null;

    return {
      category: rawType,
      date:     lastDate,
      name:     rawName || nameFromUrl(url),
      url,
      preview:  ''
    };
  }).filter(Boolean);
}

async function main() {
  console.log('[sheet] fetching CSV…');
  const csv = await fetchCSV(CSV_URL);
  const raw = parseCSV(csv);
  console.log(`[sheet] parsed ${raw.length} links`);

  const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sua_chave_aqui';
  let data = raw;
  if (hasClaudeKey) {
    console.log(`[classifier] classifying ${raw.length} links…`);
    data = await classifyAll(raw);
  } else {
    console.log('[classifier] ANTHROPIC_API_KEY not set — skipping classification (category/description left blank)');
    data = raw.map(link => ({ ...link, description: '' }));
  }

  const seen = new Set();
  const rows = [];
  for (const { category, date, name, url, preview, description } of data) {
    if (seen.has(url)) continue;
    seen.add(url);
    rows.push({
      category: category || '',
      date,
      name,
      url,
      preview: preview || '',
      description: description || ''
    });
  }
  if (rows.length < data.length) {
    console.log(`[sheet] dropped ${data.length - rows.length} duplicate URL row(s)`);
  }

  console.log(`[supabase] upserting ${rows.length} rows…`);
  const { error, count } = await supabase
    .from('links')
    .upsert(rows, { onConflict: 'url', count: 'exact' });

  if (error) {
    console.error('[supabase] upsert failed:', error.message);
    process.exit(1);
  }

  console.log(`[supabase] done — upserted ${count ?? rows.length} rows`);
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
