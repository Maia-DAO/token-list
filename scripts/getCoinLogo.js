const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')

// Path to cache file
const CACHE_PATH = path.resolve(__dirname, './cache/logoCache.json')

// Load or initialize cache
let cache = {}
if (fs.existsSync(CACHE_PATH)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch (err) {
    console.warn('⚠️ Failed to parse cache, starting fresh:', err)
    cache = {}
  }
}

/**
 * Writes current cache to disk.
 */
function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.error('Error saving cache:', err)
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
    const res = await fetch(url, options)
    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`Status ${res.status}`)
    }
    return res
  } catch (err) {
    if (retries > 0) {
      console.warn(`Fetch failed (${err.message}), retrying in ${delayMs}ms...`)
      await new Promise((r) => setTimeout(r, delayMs))
      return fetchWithRetry(url, options, retries - 1, delayMs * 2)
    }
    throw err
  }
}

/**
 * Attempts to get a token logo URI from multiple sources.
 * @param {string} address 
 * @param {number} chainId
 * @param {string} coingeckoId
 * @param {string} coinmarketcapId
 * @returns {Promise<string|undefined>}
 */
async function getCoinLogo(address, chainId, coingeckoId, coinmarketcapId) {
  const key = `${chainId}:${address}`
  if (cache[key]) return cache[key]
  // return undefined

  // 1) Uniswap assets
  const uniNetworkMap = {
    1: 'ethereum',
    56: 'binance',
    10: 'optimism',
    42161: 'arbitrum',
    43114: 'avalanchec',
    137: 'polygon',
    8453: 'base',
  }

  const network = uniNetworkMap[chainId]
  console.log("🚀 ~ getCoinLogo ~ network:", network)
  if (network) {
    const url = `https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/${network}/assets/${address}/logo.png`
    const res = await fetchWithRetry(url)
    if (res) {
      console.log("🚀 ~ uniNetworkMap ~ url:", res)
      cache[key] = url
      saveCache()
      return url
    }
  }

  // 2) TrustWallet assets
  const trustwalletNetworkMap = {
    1: 'ethereum',
    56: 'binance',
    10: 'optimism',
    1088: 'metis',
    42161: 'arbitrum',
    43114: 'avalanchec',
    137: 'polygon',
    8453: 'base',
    146: 'sonic',
  }

  const networkTrust = trustwalletNetworkMap[chainId]
  console.log("🚀 ~ getCoinLogo ~ networkTrust:", networkTrust)
  if (networkTrust) {
    const url = `https://raw.githubusercontent.com/trustwallet/assets/refs/heads/master/blockchains/${networkTrust}/assets/${address}/logo.png`
    const res = await fetchWithRetry(url)
    if (res) {
      console.log("🚀 ~ trustwalletNetworkMap ~ url:", res)
      cache[key] = url
      saveCache()
      return url
    }
  }

  // 3) CoinMarketCap static 128x128
  if (coinmarketcapId) {
    const url = `https://s2.coinmarketcap.com/static/img/coins/128x128/${coinmarketcapId}.png`
    const res = await fetchWithRetry(url)
    if (res) {
      console.log("🚀 ~ coinmarketcapId ~ url:", res)
      cache[key] = url
      saveCache()
      return url
    }
  }

  // 4) CoinGecko API lookup
  if (coingeckoId) {
    try {
      const res = await fetchWithRetry(
        `https://api.coingecko.com/api/v3/coins/${coingeckoId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`
      )
      if (res) {
        const data = await res.json()
        const url = data.image?.small || data.image?.thumb || null
        if (url) {
          cache[key] = url
          saveCache()
          return url
        }
      }
    } catch (err) {
      console.warn(`CoinGecko API failed for ${coingeckoId}: ${err.message}`)
    }
  }

  // 5) CoinGecko scraped
  if (coingeckoId) {
    const page = await fetchWithRetry(`https://www.coingecko.com/en/coins/${coingeckoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (page) {
      const html = await page.text()
      const $ = cheerio.load(html)
      const img = $('img.tw-rounded-full').first()
      const src = img.attr('src')
      if (src) {
        console.log("🚀 ~ coinmarketcapId ~ url:", src)
        cache[key] = src
        saveCache()
        return src
      }
    }
  }

  // 6) Jumper Coins List
  try {
    const jumperUrl = `https://raw.githubusercontent.com/jumperexchange/jumper-exchange/cf0bc19be474f2bcb0b908007531837b89de1bfc/src/utils/coins.ts`
    const resJ = await fetchWithRetry(jumperUrl);
    if (resJ) {
      const text = await resJ.text();
      // Extract the TypeScript array literal
      const match = text.match(/const coins = \[((?:\{[\s\S]*?\},?)+)\]/m);
      if (match) {
        const arrText = '[' + match[1] + ']';
        // Convert TS-like objects to valid JSON
        const jsonText = arrText
          .replace(/([\{,]\s*)([a-zA-Z0-9_]+):/g, '$1"$2":')
          .replace(/'/g, '"');
        const coins = JSON.parse(jsonText);
        const entry = coins.find(
          (c) => c.chainId === chainId && c.address.toLowerCase() === address.toLowerCase()
        );
        if (entry?.logoURI) {
          cache[key] = entry.logoURI;
          saveCache();
          return entry.logoURI;
        }
      }
    }
  } catch (err) {
    console.warn(`Jumper list failed for ${key}: ${err.message}`);
  }

  // nothing found
  console.warn(`No response for ${key}, returning without logo.`)
  return undefined
}

module.exports = { getCoinLogo }
