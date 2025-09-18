const fs = require('fs').promises
const path = require('path')

const { PARTNER_TOKEN_SYMBOLS } = require('../configs')

// Paths (matches original script layout: two levels up)
const TOKEN_LIST_PATH = path.resolve(__dirname, '../token-list.json')
const INACTIVE_TOKEN_LIST_PATH = path.resolve(__dirname, '../inactive-token-list.json')
const BACKUP_SUFFIX = '.bak'

// Threshold (USD).
const MARKETCAP_THRESHOLD = 10_000_000

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8')
  return JSON.parse(txt)
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

async function backupFile(p) {
  const backupPath = p + BACKUP_SUFFIX
  await fs.copyFile(p, backupPath)
  return backupPath
}

async function getOFTsPriceSource() {
  // if (!process.env.OFT_API) throw new Error('Set OFT_API in your environment (process.env.OFT_API)')
  const res = await fetch(
    'https://layerzeroscan.com/api/trpc/ofts.statsOverview,ofts.getOverviewMetrics,chains.top,chains.top,ofts.list?batch=1&input=%7B%222%22%3A%7B%22filters%22%3A%7B%22stage%22%3A%22mainnet%22%7D%7D%2C%223%22%3A%7B%22filters%22%3A%7B%22stage%22%3A%22mainnet%22%2C%22created%22%3A%7B%7D%7D%7D%2C%224%22%3A%7B%22request%22%3A%7B%22filters%22%3A%7B%22period%22%3A%221d%22%7D%2C%22sort%22%3A%7B%22key%22%3A%22transfers_24h%22%2C%22order%22%3A%22desc%22%7D%7D%2C%22pageIndex%22%3A0%2C%22pageSize%22%3A15%7D%7D'
  )
  if (!res.ok) throw new Error(`Failed to fetch OFT API: ${res.status} ${res.statusText}`)
  const json = await res.json()
  // original script used [0].result.data
  return json[0].result.data
}

function normalizeAddress(a) {
  return a ? String(a).toLowerCase() : ''
}

function collectPeerAddressesFromToken(token) {
  const peers = []
  try {
    const pi = token?.extensions?.oftInfo?.peersInfo
    if (!pi) return peers
    for (const k of Object.keys(pi)) {
      const addr = pi[k]?.tokenAddress
      if (addr) peers.push(normalizeAddress(addr))
    }
  } catch (e) {
    // ignore
  }
  return peers
}

async function main() {
  console.log('Loading token lists...')
  const [tokenList, inactiveTokenList] = await Promise.all([
    readJson(TOKEN_LIST_PATH),
    readJson(INACTIVE_TOKEN_LIST_PATH),
  ])

  console.log('Backing up original files...')
  await Promise.all([backupFile(TOKEN_LIST_PATH), backupFile(INACTIVE_TOKEN_LIST_PATH)])

  console.log('Fetching OFT price source...')
  const oftInfo = await getOFTsPriceSource()

  // Build a map symbol -> price entry for quick lookup (case-sensitive as original used exact match)
  const priceBySymbol = new Map()
  for (const e of oftInfo) {
    if (e && e.symbol) priceBySymbol.set(e.symbol, e)
  }

  // Collect addresses to remove
  const removeAddrs = new Set()
  const removeSymbols = new Set()

  function markIfBelowThreshold(token) {
    if (!token?.isOFT) return false
    if (PARTNER_TOKEN_SYMBOLS.includes(token.symbol)) return false
    const symbol = token.symbol
    const priceEntry = priceBySymbol.get(symbol)
    if (!priceEntry) return false
    const cap = Number(priceEntry.marketCap || 0)
    if (isNaN(cap)) return false
    if (cap < MARKETCAP_THRESHOLD) {
      removeSymbols.add(symbol)
      removeAddrs.add(normalizeAddress(token.address))
      // add peers for deletion
      const peers = collectPeerAddressesFromToken(token)
      for (const p of peers) removeAddrs.add(p)
      return true
    }
    return false
  }

  // Scan all three arrays
  const allArrays = [tokenList.tokens || [], tokenList.rootTokens || [], inactiveTokenList.tokens || []]
  for (const arr of allArrays) {
    for (const t of arr) {
      markIfBelowThreshold(t)
    }
  }

  // Now remove tokens whose address is in removeAddrs (case-insensitive)
  function filterOutByAddress(arr) {
    const before = arr.length
    const out = arr.filter((t) => !removeAddrs.has(normalizeAddress(t.address)))
    return { out, removed: before - out.length }
  }

  const tokensResult = filterOutByAddress(tokenList.tokens || [])
  const rootTokensResult = filterOutByAddress(tokenList.rootTokens || [])
  const inactiveResult = filterOutByAddress(inactiveTokenList.tokens || [])

  tokenList.tokens = tokensResult.out
  tokenList.rootTokens = rootTokensResult.out
  inactiveTokenList.tokens = inactiveResult.out

  // Additionally: remove any peer entries inside remaining tokens' extensions.oftInfo.peersInfo
  let peerEntriesRemoved = 0
  function cleanPeersInArray(arr) {
    for (const t of arr) {
      const peers = t?.extensions?.oftInfo?.peersInfo
      if (!peers) continue
      let changed = false
      for (const key of Object.keys(peers)) {
        const peerAddr = normalizeAddress(peers[key]?.tokenAddress)
        if (removeAddrs.has(peerAddr)) {
          delete peers[key]
          changed = true
          peerEntriesRemoved++
        }
      }
      // if peersInfo became empty, remove it
      if (changed && Object.keys(peers).length === 0) {
        delete t.extensions.oftInfo.peersInfo
        // if oftInfo now has no own keys beside known ones, leave oftInfo as-is (could contain adapter/version), we only removed peers
      }
    }
  }

  cleanPeersInArray(tokenList.tokens)
  cleanPeersInArray(tokenList.rootTokens)
  cleanPeersInArray(inactiveTokenList.tokens)

  // Save files
  await Promise.all([writeJson(TOKEN_LIST_PATH, tokenList), writeJson(INACTIVE_TOKEN_LIST_PATH, inactiveTokenList)])

  console.log('Done.')
  console.log(`Market cap threshold: $${MARKETCAP_THRESHOLD.toLocaleString()}`)
  console.log(`Removed symbols (below threshold): ${Array.from(removeSymbols).join(', ') || '(none)'} `)
  console.log(`Removed addresses: ${removeAddrs.size}`)
  console.log(`Removed from token-list.tokens: ${tokensResult.removed}`)
  console.log(`Removed from token-list.rootTokens: ${rootTokensResult.removed}`)
  console.log(`Removed from inactive-token-list.tokens: ${inactiveResult.removed}`)
  console.log(`Peer entries removed from peersInfo: ${peerEntriesRemoved}`)
  console.log(`Backups created with suffix '${BACKUP_SUFFIX}' next to original files`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
