const fs = require('fs')
const { ethers } = require('ethers')
const { CHAIN_KEY_TO_ID } = require('../configs')
const { MULTICALL3_ABI, MULTICALL3_ADDRESS } = require('../abi')

/**
 * Merge two extensions objects, combining their properties. 
 * @param {object} ext1 - the first extensions object  
 * @param {object} ext2 - the second extensions object
 * @returns {object} a new object with merged properties
 */
function mergeExtensions(ext1 = {}, ext2 = {}) {
  const merged = { ...ext1 }
  for (const key in ext2) {
    if (merged[key] && typeof merged[key] === 'object' && typeof ext2[key] === 'object') {
      merged[key] = { ...merged[key], ...ext2[key] }
    } else {
      merged[key] = ext2[key]
    }
  }
  return orderExtensions(merged)
}

/**
 * Re‐orders an extensions object so that core keys come first,
 * then any custom/passthrough fields afterward.
 *
 * @param {object} ext – the original extensions map
 * @returns {object} a new object with keys ordered:
 *   [ coingeckoId, coinMarketCapId, bridgeInfo, acrossInfo, oftInfo, …rest ]
 */
function orderExtensions(ext = {}) {
  const ordered = {};
  const priority = [
    'coingeckoId',
    'coinMarketCapId',
    'bridgeInfo',
    'acrossInfo',
    'oftInfo'
  ];

  // copy priority keys first (if present)
  for (const key of priority) {
    if (key in ext) {
      ordered[key] = ext[key];
    }
  }

  // then copy all the rest
  for (const key of Object.keys(ext)) {
    if (!(key in ordered)) {
      ordered[key] = ext[key];
    }
  }

  return ordered;
}

/**
 * Orders the attributes of a token object to ensure consistent output.
 * @param {object} token 
 * @returns {object} a new token object with attributes ordered
 */
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

// TODO: Update once non-EVM chains are supported
/**
 * Function to get a clean, normalized address.
 * @param {string} input - the input address string
 * @returns {string|undefined} - a normalized address string or undefined if invalid 
 */
function cleanAddress(input) {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : undefined
}

/**
 * MultiCall function with fallback mechanism. 
 * @param {string} chainKey - the chain key to use for RPC selection 
 * @param {*} calls - an array of calls to make, each with { target: string, callData: string } 
 * @param {*} batchSize - optional batch size for multicall, defaults to all calls in one batch 
 * @param {*} delayMs - optional delay in milliseconds between batches, defaults to 250ms 
 * @returns {Promise<Array>} - resolves to an array of return data from the multicall 
 */
async function multiCallWithFallback(chainKey, calls, batchSize = undefined, delayMs = 250) {
  const chainsMeta = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'))

  // Build mappings / lookups
  const rpcUrls = {}
  for (const [chainKey, meta] of Object.entries(chainsMeta)) {
    if (Array.isArray(meta.rpcs) && meta.rpcs.length) rpcUrls[chainKey] = meta.rpcs.map((rpc) => rpc.url)
  }

  // Fetch missing RPC URLs
  const allChains = await fetch('https://chainid.network/chains.json').then((r) => r.json())
  // build a map: chainId → all RPC URLs
  const extraRpcMap = Object.fromEntries(allChains.map((c) => [c.chainId, c.rpc]))

  // build RPC list
  const rpcList = []
  if (rpcUrls[chainKey]) rpcList.push(...rpcUrls[chainKey])
  const extra = extraRpcMap[CHAIN_KEY_TO_ID[chainKey]]
  if (extra) rpcList.push(...extra)
  if (!rpcList.length) throw new Error(`No RPC URLs available for chain ${chainKey}`)

  const BATCH = batchSize || calls.length

  for (const rpcUrl of rpcList) {
    let provider
    try {
      provider = new ethers.JsonRpcProvider(rpcUrl, null, {
        skipFetchSetup: true,
        batchMaxCount: 1,
      })
      const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
      const returnData = []

      let failedCalls = 0

      for (let i = 0; i < calls.length; i += BATCH) {
        const slice = calls.slice(i, i + BATCH).map((c) => ({ target: c.target, callData: c.callData }))
        const results = await mc.tryAggregate(false, slice)
        for (const [success, data] of results) {
          if (!success) failedCalls++
          returnData.push(data)
        }
        if (i + BATCH < calls.length) await new Promise((r) => setTimeout(r, delayMs))
      }

      console.warn(`${failedCalls} of ${calls.length} Multicall sub-calls failed on ${chainKey}`)
      return returnData
    } catch (err) {
      console.warn(`RPC ${rpcUrl} failed for chain ${chainKey}: ${err.message}`)
      // try next rpcUrl
    } finally {
      if (provider && typeof provider.destroy === 'function') {
        try {
          provider.destroy()
        } catch { }
      }
    }
  }

  throw new Error(`All RPC endpoints failed for chain ${chainKey}`)
}

module.exports = {
  MULTICALL3_ABI,
  MULTICALL3_ADDRESS,
  multiCallWithFallback,
  cleanAddress,
  mergeExtensions,
  orderExtensions,
  orderAttributes,
}
