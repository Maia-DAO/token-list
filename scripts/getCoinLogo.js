const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Path to cache file
const CACHE_PATH = path.resolve(__dirname, './cache/logoCache.json');

// Load or initialize cache
let cache = {};
if (fs.existsSync(CACHE_PATH)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (err) {
    console.warn('Failed to parse cache, starting fresh:', err);
    cache = {};
  }
}

/**
 * Writes current cache to disk.
 */
function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving cache:', err);
  }
}

/**
 * Fetch with retry to avoid rate limits.
 * @param {string} url
 * @param {object} options
 * @param {number} retries
 * @param {number} delayMs
 */
async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 2000) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Status ${res.status}`);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      console.warn(`Fetch failed (${err.message}), retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

/**
 * Fetches the CoinGecko token logo URL by slug (coingeckoId).
 * Caches results to avoid repeated requests.
 * @param {string} slug — e.g. "bitcoin", "polygon"
 * @returns {Promise<string|null>} — Absolute URL to the logo, or null if not found
 */
async function getCoinLogo(slug) {
  // Return from cache if exists
  if (cache[slug]) {
    return cache[slug];
  }

  const pageUrl = `https://www.coingecko.com/en/coins/${slug}`;
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  try {
    const res = await fetchWithRetry(pageUrl, { headers });

    if (!res) {
      console.warn(`No response for ${slug}, returning without logo.`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const img = $('img.tw-rounded-full').first();
    const src = img.attr('src')?.trim() || null;

    // Cache and save
    if (src) {
      cache[slug] = src;
      saveCache();
    }

    return src;
  } catch (err) {
    console.error(`Failed to fetch logo for ${slug}:`, err.message);
    return null;
  }
}

module.exports = getCoinLogo;
module.exports.getCoinLogo = getCoinLogo;