#!/usr/bin/env node
const fs = require('fs')

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

function mergeExtensions(ext1 = {}, ext2 = {}) {
  const merged = { ...ext1 }
  for (const key in ext2) {
    if (merged[key] && typeof merged[key] === 'object' && typeof ext2[key] === 'object') {
      merged[key] = {
        ...merged[key],
        ...ext2[key],
      }
    } else {
      merged[key] = ext2[key]
    }
  }
  return merged
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

const seen = new Set()

// Generic dedupe+merge for one array
function dedupeAndMerge(arr) {
  // bucket by key
  const buckets = new Map()
  arr.forEach((item) => {
    const cid = item.chainId
    const keys = []
    if (item.address) keys.push(`${item.address.toLowerCase()}_${cid}`)
    if (item.underlyingAddress) keys.push(`${item.underlyingAddress.toLowerCase()}_${cid}`)
    // one item may appear in multiple buckets; we’ll merge inside each bucket
    keys.forEach((k) => {
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(item)
    })
  })

  // build final list, merging duplicates
  const result = []

  buckets.forEach((group) => {
    // pick the “merged” token for this key
    // sort by population ascending: least-populated first
    group.sort((a, b) => populationScore(a) - populationScore(b))
    let merged = group[0]
    for (let i = 1; i < group.length; i++) {
      merged = mergeTokenData(merged, group[i])
    }

    const address = merged.address?.toLowerCase() ?? merged.underlyingAddress?.toLowerCase()

    // ensure we only push each merged token once
    const uniqueId = `${address}_${merged.chainId}`
    if (!seen.has(uniqueId)) {
      if (group.length > 1) {
        console.log("= Duplicate Group:", group)
        console.log("=== Group merge result:", merged)
      }
      result.push(merged)
      seen.add(uniqueId)
    }
  })

  // also include any tokens that never fell into a bucket
  arr.forEach((item) => {
    const cid = item.chainId
    const id = `${item.address?.toLowerCase() ?? item.underlyingAddress?.toLowerCase() ?? ''}_${cid}`
    if (!seen.has(id)) {
      result.push(item)
      seen.add(id)
    }
  })

  return result
}

// Process both lists
const mergedTokens = Array.isArray(dataActiveList.tokens) ? dedupeAndMerge(dataActiveList.tokens) : []
const mergedRootTokens = Array.isArray(dataActiveList.rootTokens) ? dedupeAndMerge(dataActiveList.rootTokens) : []

// Write out
const outData = {
  ...dataActiveList,
  tokens: mergedTokens,
  rootTokens: mergedRootTokens,
}

fs.writeFileSync(ACTIVE_LIST, JSON.stringify(outData, null, 2))
console.log(`✅ Duplicates merged. Output written to ${ACTIVE_LIST}`)

const mergedInactiveTokens = Array.isArray(dataInactiveList.tokens) ? dedupeAndMerge(dataInactiveList.tokens) : []

// Write out
const outInactiveData = {
  ...dataInactiveList,
  tokens: mergedInactiveTokens,
}

fs.writeFileSync(INACTIVE_LIST, JSON.stringify(outInactiveData, null, 2))
console.log(`✅ Inactive duplicates merged. Output written to ${INACTIVE_LIST}`)
