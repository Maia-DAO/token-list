const fs = require('fs')
const { mergeExtensions } = require('../helpers')

// ── Utilities ───────────────────────────────────────────────────────────────────

function mergeTokenData(existing, incoming) {
  const merged = {
    ...existing,
    ...incoming,
    name: existing.name,
    symbol: existing.symbol,
    isAcross: existing.isAcross || incoming.isAcross,
    isOFT: existing.isOFT || incoming.isOFT,
    logoURI: incoming.logoURI ?? existing.logoURI,
    extensions: mergeExtensions(existing.extensions, incoming.extensions),
  }

  return orderAttributes(merged)
}

// Function to order attributes consistently.
function orderAttributes(token) {
  const ordered = {}
  const keysOrder = [
    'chainId',
    'address',
    'globalAddress',
    'localAddress',
    'underlyingAddress',
    'name',
    'symbol',
    'decimals',
    'logoURI',
    'tags',
    'extensions',
    'isAcross',
    'isOFT',
    'oftAdapter',
    'oftVersion',
    'endpointVersion',
    'endpointId',
    'oftSharedDecimals',
  ]

  keysOrder.forEach((key) => {
    if (key in token) {
      ordered[key] = token[key]
    }
  })

  // Add any remaining keys that are not in the predefined order.
  Object.keys(token).forEach((key) => {
    if (!ordered.hasOwnProperty(key)) {
      ordered[key] = token[key]
    }
  })

  return ordered
}

// Count how “populated” a token is (number of non-null, non-empty fields)
function populationScore(t) {
  return Object.entries(t).reduce((sum, [k, v]) => {
    if (v !== null && v !== undefined && !(typeof v === 'object' && Object.keys(v).length === 0)) {
      return sum + 1
    }
    return sum
  }, 0)
}

// ── Core Logic ────────────────────────────────────────────────────────────────

const ACTIVE_LIST = 'token-list.json'
const INACTIVE_LIST = 'inactive-token-list.json'

let dataActiveList
try {
  dataActiveList = JSON.parse(fs.readFileSync(ACTIVE_LIST, 'utf8'))
} catch (err) {
  console.error(`❌ Failed to read/parse ${ACTIVE_LIST}:`, err.message)
  process.exit(1)
}

let dataInactiveList
try {
  dataInactiveList = JSON.parse(fs.readFileSync(INACTIVE_LIST, 'utf8'))
} catch (err) {
  console.error(`❌ Failed to read/parse ${INACTIVE_LIST}:`, err.message)
  process.exit(1)
}

// Merge and dedupe logic with active/inactive tracking
function dedupeAndMergeCombined(activeTokens, rootTokens, inactiveTokens) {
  const buckets = new Map()

  function addToBuckets(tokens, source) {
    tokens.forEach((item) => {
      const cid = item.chainId
      const keys = []
      if (item.address) keys.push(`${item.address.toLowerCase()}_${cid}`)
      if (item.underlyingAddress) keys.push(`${item.underlyingAddress.toLowerCase()}_${cid}`)
      keys.forEach((k) => {
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k).push({ ...item, __source: source })
      })
    })
  }

  addToBuckets(activeTokens, 'active')
  addToBuckets(rootTokens, 'active-root')
  addToBuckets(inactiveTokens, 'inactive')

  const mergedActive = []
  const mergedActiveRoot = []
  const mergedInactive = []
  const seen = new Set()

  buckets.forEach((group) => {
    group.sort((a, b) => populationScore(a) - populationScore(b))
    let merged = group[0]
    for (let i = 1; i < group.length; i++) {
      merged = mergeTokenData(merged, group[i])
    }

    const address = merged.address?.toLowerCase() ?? merged.underlyingAddress?.toLowerCase()
    const uniqueId = `${address}_${merged.chainId}`

    if (!seen.has(uniqueId)) {
      seen.add(uniqueId)

      // If any part of the group came from active list, keep in active list
      const hasActive = group.some((t) => t.__source === 'active')
      const hasActiveRoot = group.some((t) => t.__source === 'active-root')

      if (group.length > 1) {
        console.log("= Duplicate Group:", group)
        console.log("=== Group merge result:", merged)
      }

      for (const member of group){
        delete member.__source
      }

      if (hasActiveRoot) {
        mergedActiveRoot.push(merged)
      } else if (hasActive) {
        mergedActive.push(merged)
      } else {
        mergedInactive.push(merged)
      }
    }
  })

  return { mergedActive, mergedActiveRoot, mergedInactive }
}

// Handle tokens
const activeTokens = Array.isArray(dataActiveList.tokens) ? dataActiveList.tokens : []
const activeRootTokens = Array.isArray(dataActiveList.rootTokens) ? dataActiveList.rootTokens : []
const inactiveTokens = Array.isArray(dataInactiveList.tokens) ? dataInactiveList.tokens : []

const { mergedActive, mergedActiveRoot, mergedInactive } = dedupeAndMergeCombined(activeTokens, activeRootTokens, inactiveTokens)

const outData = {
  ...dataActiveList,
  tokens: mergedActive,
  rootTokens: mergedActiveRoot,
}

fs.writeFileSync(ACTIVE_LIST, JSON.stringify(outData, null, 2))
console.log(`✅ Merged tokens written to ${ACTIVE_LIST}`)

const outInactiveData = {
  ...dataInactiveList,
  tokens: mergedInactive,
}

fs.writeFileSync(INACTIVE_LIST, JSON.stringify(outInactiveData, null, 2))
console.log(`✅ Remaining inactive tokens written to ${INACTIVE_LIST}`)