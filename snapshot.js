require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

supabase
  .from('links')
  .select('category, date, name, url, preview, description')
  .order('category', { ascending: true })
  .then(({ data, error }) => {
    if (error || !data.length) {
      console.error('snapshot failed:', error ? error.message : 'no rows');
      process.exit(1);
    }
    fs.writeFileSync(path.join(__dirname, 'snapshot.json'), JSON.stringify(data, null, 2) + '\n');
    console.log(`snapshot.json written — ${data.length} links`);
    process.exit(0);
  });
