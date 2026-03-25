const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'classifications.json');

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Classify + describe a URL in one Claude call
async function classifyAndDescribe(url) {
  const cache = loadCache();
  const cached = cache[url];

  if (cached && cached.category && cached.description !== undefined) {
    console.log(`[classifier] cache hit: ${url} → ${cached.category}`);
    return cached;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 80,
    messages: [{
      role: 'user',
      content: `Analyze this website and respond in EXACTLY this format (nothing else):
category: [one lowercase word: agency, studio, gallery, brand, strategy, tool, resource, blog, portfolio]
description: [max 64 chars describing what the site does]

URL: ${url}`
    }]
  });

  const text = response.content[0].text.trim();
  const catMatch = text.match(/category:\s*(\S+)/i);
  const descMatch = text.match(/description:\s*(.+)/i);

  const result = {
    category:    catMatch  ? catMatch[1].toLowerCase()         : 'resource',
    description: descMatch ? descMatch[1].trim().slice(0, 64)  : ''
  };

  console.log(`[classifier] ${url} → ${result.category} | "${result.description}"`);

  cache[url] = result;
  saveCache(cache);
  return result;
}

// Enrich all links with category + description (parallel, cached)
async function classifyAll(links) {
  return Promise.all(
    links.map(async (link) => {
      if (link.url) {
        const result = await classifyAndDescribe(link.url);
        link.category    = result.category;
        link.description = result.description;
      }
      return link;
    })
  );
}

module.exports = { classifyAll };
