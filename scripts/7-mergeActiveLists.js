const fs = require('fs').promises
const path = require('path')
const { SupportedChainId, ZERO_ADDRESS } = require('maia-core-sdk')
const { getCoinLogo } = require('./getCoinLogo')
const { orderTokens } = require('./orderTokens')
const { OVERRIDE_LOGO, PARTNER_TOKEN_SYMBOLS, BLOCKED_TOKEN_SYMBOLS, NATIVE_OFT_ADAPTERS, EXTENDED_SUPPORTED_CHAIN_IDS } = require('../configs')
const { mergeExtensions, orderAttributes } = require('../helpers')

// TODO: Add arbitrary Uniswap Token List support

// ---------------------------------------------------------------------
// Normalization functions for tokens to the unified format
// ---------------------------------------------------------------------

function mergeTokenData(existing, incoming) {
  const merged = {
    ...existing,
    ...incoming,
    name: incoming.name,
    symbol: incoming.symbol,
    isAcross: existing.isAcross || incoming.isAcross,
    isOFT: existing.isOFT || incoming.isOFT,
    logoURI: incoming.logoURI || existing.logoURI,
    extensions: mergeExtensions(existing.extensions, incoming.extensions),
  }

  return orderAttributes(merged)
}

function mergeTokenDataUlysses(existing, incoming) {
  // Ensure extensions are merged correctly.
  const newExtensions = mergeExtensions(existing.extensions || {}, incoming.extensions || {})

  // We use Ulysses format if the token is from Ulysses.
  const { address: addressIncoming, ...restIncoming } = existing
  const { address: addressExisting, ...restExisting } = incoming

  const merged = {
    ...restIncoming,
    ...restExisting,
    name: incoming.name,
    symbol: incoming.symbol,
    isAcross: existing.isAcross || incoming.isAcross,
    isOFT: existing.isOFT || incoming.isOFT,
    logoURI: incoming.logoURI || existing.logoURI,
    extensions: newExtensions,
  }

  return orderAttributes(merged)
}

/**
 * Normalize a token from the across list.
 * Input structure (from TOKEN_SYMBOLS_MAP):
 * {
 *    name: string,
 *    symbol: string,
 *    decimals: number,
 *    addresses: { [chainId: string]: string },
 *    coingeckoId: string,
 *    logoURI?: string
 * }
 *
 * Each address entry from across is converted to a separate token.
 */
async function normalizeAcrossToken(data) {
  const tokens = []
  // Convert addresses keys to numbers.
  for (const key in data.addresses) {
    const chainId = Number(key)
    const decimals = data.addresses[key].decimals
    if (decimals) continue
    const address = data.addresses[key].address
    tokens.push({
      chainId,
      address,
      name: data.name,
      decimals: data.decimals,
      symbol: data.symbol,
      logoURI: (await getCoinLogo(address, chainId, data.coingeckoId, undefined)) ?? null,
      tags: [],
      extensions: {
        acrossInfo: Object.entries(data.addresses).reduce((memo, [chain, value]) => {
          if (Number(chain) !== chainId) {
            memo[chain] = value
          }
          return memo
        }, {}),
        coingeckoId: data.coingeckoId,
      },
      isAcross: true, // from across list
      isOFT: false,
    })
  }
  return tokens
}

/**
 * Normalize a token from the filtered stargate tokens list.
 * Expected fields:
 * {
 *   chainKey: string,  // e.g. "aptos" (but we use a default numeric chainId)
 *   address: string,
 *   decimals: number,
 *   symbol: string,
 *   name: string,
 *   icon: string,
 *   extensions?: { ... }
 * }
 *
 * Produces one token entry in the new unified format.
 */
async function normalizeStargateToken(token) {
  const fallbackLogoTokenAddress = token?.extensions?.bridgeInfo && token.extensions.bridgeInfo.length === 1 ? Array.from(token.extensions.bridgeInfo.values())[0] : undefined
  let tokenLogoURI = token.icon ?? OVERRIDE_LOGO[token.symbol]
  if (!tokenLogoURI) tokenLogoURI = await getCoinLogo(token.address, token.chainId, token.extensions?.coingeckoId, token.extensions?.coinMarketCapId)
  if (!tokenLogoURI && fallbackLogoTokenAddress) tokenLogoURI = await getCoinLogo(fallbackLogoTokenAddress, token.chainId, undefined, undefined)

  if (!token.address || !token.address.length > 0 || token.address === "0x" || token.address === "0x00" || !token.decimals || !token.name || !token.symbol) {
    return undefined
  }


  const result = {
    chainId: token.chainId,
    address: token.address,
    name: token.name ?? token.symbol,
    decimals: token.decimals,
    symbol: token.symbol,
    logoURI: tokenLogoURI ?? null,
    tags: [],
    extensions: token.extensions ? token.extensions : {},
    isAcross: false,
    isOFT: token.isOFT, // not all tokens in stargate list are OFT
  }

  if (token.isOFT) {
    token.extensions = token.extensions || {}
    token.extensions.oftInfo = token.extensions.oftInfo || {}

    if (token.extensions.peersInfo) {
      token.extensions.oftInfo.peersInfo = token.extensions.peersInfo
      delete token.extensions.peersInfo
    }

    if (token.extensions.feeInfo) {
      token.extensions.oftInfo.feeInfo = token.extensions.feeInfo
      delete token.extensions.feeInfo
    }

    if (token.oftAdapter) {
      token.extensions.oftInfo.oftAdapter = token.oftAdapter
    }

    if (token.oftVersion) {
      token.extensions.oftInfo.oftVersion = token.oftVersion
    }

    if (token.endpointVersion) {
      token.extensions.oftInfo.endpointVersion = token.endpointVersion
    }

    if (token.endpointId) {
      token.extensions.oftInfo.endpointId = token.endpointId
    }

    if (token.oftSharedDecimals) {
      token.extensions.oftInfo.oftSharedDecimals = token.oftSharedDecimals
    }
  }

  return result
}

/**
 * Bumps version by incrementing the patch version.
 */
function bumpVersion(oldVersion) {
  return {
    major: oldVersion.major + 1,
    minor: oldVersion.minor,
    patch: oldVersion.patch,
  }
}

/**
 * Compare two objects by stringifying them.
 * We assume the order of keys and arrays is consistent.
 */
function isEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2)
}

/**
 * Parse .tokens from a token list json
 * @param {*} raw - Token list json
 * @returns - Parsed .tokens array
 */
const tryParseTokens = (raw) => {
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.tokens)) return j.tokens;
  } catch (e) { /* ignore */ }
  return [];
};

/**
 * Main merge function.
 */
async function main() {
  try {
    // Read source files from the output directory.
    // 1. Across tokens from filteredAcrossTokens.json
    const acrossDataRaw = await fs.readFile(path.join('output', 'filteredAcrossTokens.json'), 'utf8')
    const acrossData = JSON.parse(acrossDataRaw)

    // 2. Filtered stargate tokens from filteredStargateTokens.json
    const stargateRaw = await fs.readFile(path.join('output', 'usableStargateTokensEnhanced.json'), 'utf8')
    const stargateTokens = JSON.parse(stargateRaw)

    // 3. Ulysses tokens from ulysses.json
    const ulyssesRaw = await fs.readFile(path.join('output', 'ulysses.json'), 'utf8')
    const ulyssesData = JSON.parse(ulyssesRaw)

    // 4. Uniswap tokens from uniswap.json.
    const uniswapRaw = await fs.readFile(path.join('output', 'uniswap.json'), 'utf8')
    const uniswapTokens = await tryParseTokens(uniswapRaw)

    // 5. Wrapped Native tokens from wrappedNatives.json.
    const wrappedNativesRaw = await fs.readFile('wrappedNatives.json', 'utf8')
    const wrappedNativeTokens = JSON.parse(wrappedNativesRaw)

    // 6. Fetch TOKEN_LIST files
    let tokenListFiles = {};
    try {
      const files = await fs.readdir('output');
      const tokenFiles = files.filter(f => f.startsWith('TOKEN_LIST_'));
      await Promise.all(tokenFiles.map(async (f) => {
        tokenListFiles[f] = await tryParseTokens(await fs.readFile(path.join('output', f), 'utf8'));
      }));
    } catch (e) {
    }

    // -----------------------------------------------------------------
    // GROUPING TOKENS PER SOURCE
    // -----------------------------------------------------------------

    // 1. Build the normalized map from Across and Stargate tokens.
    const normalizedMap = {}
    const rootTokensMap = {}
    const oftsPerChainMap = {}

    let inactiveTokensArray = []

    const activeOFTSet = new Set()
    const inactiveOFTSet = new Set()

    // Process Across tokens.
    for (const symbol in acrossData) {
      const tokenData = acrossData[symbol]
      const normalizedArray = await normalizeAcrossToken(tokenData, normalizedMap, rootTokensMap)
      normalizedArray.forEach((token) => {

        if (BLOCKED_TOKEN_SYMBOLS.includes(token.symbol)) {
          console.warn(`skipping, blocked token ${token.symbol} on chain ${token.chainId}`)
          return
        }

        if (!token.logoURI) delete token.logoURI // Remove empty logoURIs
        if (token.chainId === 42161) {
          // Merge into rootTokensMap.
          const rootKey = token.address.toLowerCase()
          if (!rootTokensMap[rootKey]) {
            rootTokensMap[rootKey] = token
          }
        } else {
          // Merge into normalizedMap.
          const key = token.address.toLowerCase() + '_' + token.chainId
          if (!normalizedMap[key]) {
            normalizedMap[key] = token
          }
        }
      })

    }

    // Process Stargate tokens.
    for (const token of stargateTokens) {
      const normalizedToken = await normalizeStargateToken(token)

      if (!normalizedToken) continue // Skip invalid tokens

      if (!normalizedToken.logoURI) delete normalizedToken.logoURI // Remove empty logoURIs

      if (BLOCKED_TOKEN_SYMBOLS.includes(normalizedToken.symbol)) {
        console.warn(`skipping, blocked token ${normalizedToken.symbol} on chain ${normalizedToken.chainId}`)
        continue
      }

      // Skip if token corresponds to OFT adapter for native token OFT.
      if (NATIVE_OFT_ADAPTERS[normalizedToken.chainId]?.[normalizedToken.address.toLowerCase()]) {
        console.warn(`skipping, native OFT adapter token ${normalizedToken.symbol} on chain ${normalizedToken.chainId}`)
        continue
      }

      if (normalizedToken.chainId === 42161) {
        const rootKey = normalizedToken.address.toLowerCase()

        if (!rootTokensMap[rootKey]) {
          rootTokensMap[rootKey] = normalizedToken
        } else {
          rootTokensMap[rootKey] = mergeTokenData(rootTokensMap[rootKey], normalizedToken)
        }

        const key = normalizedToken.address.toLowerCase() + '_' + 42161
        oftsPerChainMap[42161] = (oftsPerChainMap[42161] || 0)
        if (normalizedToken.isOFT) oftsPerChainMap[42161] = oftsPerChainMap[42161] + 1
        const oftAmount = oftsPerChainMap[42161]

        const hasPeerInActiveSet = (Object.entries(normalizedToken.extensions.peersInfo || {})).some(([, peer]) => activeOFTSet.has(peer.tokenAddress.toLowerCase() + '_' + peer.chain))
        const hasPeerInInactiveSet = (Object.entries(normalizedToken.extensions.peersInfo || {})).some(([, peer]) => inactiveOFTSet.has(peer.tokenAddress.toLowerCase() + '_' + peer.chain))

        // Delete from rootTokensMap if chain OFT count exceeds 5, in exception of partner tokens and already active tokens. If it or any of it's peers are inactive, always delete it.
        if (!PARTNER_TOKEN_SYMBOLS.includes(normalizedToken.symbol) && ((normalizedToken.isOFT && oftAmount >= 20 && !activeOFTSet.has(key) && !hasPeerInActiveSet) || inactiveOFTSet.has(key) || hasPeerInInactiveSet)) {
          const tempToken = rootTokensMap[rootKey]
          delete rootTokensMap[rootKey]
          inactiveTokensArray.push(tempToken)

          // Track has inactive, also track its peers.
          inactiveOFTSet.add(key)
          for (const [chain, peer] of Object.entries(normalizedToken.extensions.peersInfo || {})) {
            const peerKey = peer.tokenAddress.toLowerCase() + '_' + chain
            inactiveOFTSet.add(peerKey)
          }

        } else {
          // Track active OFTs and their peers.
          activeOFTSet.add(key)

          for (const [chain, peer] of Object.entries(normalizedToken.extensions.peersInfo || {})) {
            const peerKey = peer.tokenAddress.toLowerCase() + '_' + chain
            activeOFTSet.add(peerKey)
          }

        }

      } else {
        const key = normalizedToken.address.toLowerCase() + '_' + normalizedToken.chainId

        oftsPerChainMap[normalizedToken.chainId] = (oftsPerChainMap[normalizedToken.chainId] || 0)
        if (normalizedToken.isOFT) oftsPerChainMap[normalizedToken.chainId] = oftsPerChainMap[normalizedToken.chainId] + 1
        const oftAmount = oftsPerChainMap[normalizedToken.chainId]


        const hasPeerInActiveSet = (Object.entries(normalizedToken.extensions.peersInfo || {})).some(([, peer]) => activeOFTSet.has(peer.tokenAddress.toLowerCase() + '_' + peer.chain))
        const hasPeerInInactiveSet = (Object.entries(normalizedToken.extensions.peersInfo || {})).some(([, peer]) => inactiveOFTSet.has(peer.tokenAddress.toLowerCase() + '_' + peer.chain))


        if (!normalizedMap[key]) {
          normalizedMap[key] = normalizedToken
        } else {
          normalizedMap[key] = mergeTokenData(normalizedMap[key], normalizedToken)
        }


        // Delete from normalizedMap if chain OFT count exceeds 5, in exception of partner tokens and already active tokens. If it or any of it's peers are inactive, always delete it.
        if (!PARTNER_TOKEN_SYMBOLS.includes(normalizedToken.symbol) && ((normalizedToken.isOFT && oftAmount >= 5 && !activeOFTSet.has(key) && !hasPeerInActiveSet) || inactiveOFTSet.has(key) || hasPeerInInactiveSet)) {
          const tempToken = normalizedMap[key]
          delete normalizedMap[key]
          inactiveTokensArray.push(tempToken)

          // Track has inactive, also track its peers.
          inactiveOFTSet.add(key)
          for (const [chain, peer] of Object.entries(normalizedToken.extensions.peersInfo || {})) {
            const peerKey = peer.tokenAddress.toLowerCase() + '_' + chain
            inactiveOFTSet.add(peerKey)
          }


        } else {
          // Track active OFTs and their peers.
          activeOFTSet.add(key)

          for (const [chain, peer] of Object.entries(normalizedToken.extensions.peersInfo || {})) {
            const peerKey = peer.tokenAddress.toLowerCase() + '_' + chain
            activeOFTSet.add(peerKey)
          }

        }
      }
      if (normalizedToken?.extensions?.oftInfo?.peersInfo && Object.keys(normalizedToken.extensions.oftInfo.peersInfo).length > 0) {
        for (const [chainId, peerInfo] of Object.entries(normalizedToken.extensions.oftInfo.peersInfo) || {}) {
          const nativeOFTAdapter = NATIVE_OFT_ADAPTERS[parseInt(chainId)]?.[peerInfo.tokenAddress.toLowerCase()]
          if (nativeOFTAdapter) {
            normalizedToken.extensions.oftInfo.peersInfo[chainId] = { tokenAddress: nativeOFTAdapter }
          }
        }
      }
    }

    // Check if there are tokens from activeOFTSet that are still in inactiveTokensArray.
    for (const activeSetKey of activeOFTSet) {
      // Remove from inactiveTokensArray if it is in activeOFTSet.
      inactiveTokensArray = inactiveTokensArray.filter((token) => token.address.toLowerCase() + '_' + token.chainId !== activeSetKey)
    }

    // Check if there are tokens from inactiveOFTSet that are still in normalizedMap.
    for (const inactiveToken of inactiveTokensArray) {
      const inactiveTokenKey = inactiveToken.address.toLowerCase() + '_' + inactiveToken.chainId
      if (normalizedMap[inactiveTokenKey]) {
        delete normalizedMap[inactiveTokenKey]
      } else if (rootTokensMap[inactiveTokenKey]) {
        delete rootTokensMap[inactiveTokenKey]
      }
    }


    // 2. Incorporate Uniswap tokens, Ulysses Root Tokens and Wrapped Native Tokens.
    const allUniswapFormatTokens = [
      ...uniswapTokens,
      ...wrappedNativeTokens,
      ...ulyssesData.rootTokens,
      ...Object.values(tokenListFiles).flat()
    ];

    const SUPPORTED_CHAINS = [...Object.values(SupportedChainId), ...EXTENDED_SUPPORTED_CHAIN_IDS].map(Number)

    allUniswapFormatTokens.forEach((token) => {
      if (BLOCKED_TOKEN_SYMBOLS.includes(token.symbol)) {
        console.warn(`skipping, blocked token ${token.symbol} on chain ${token.chainId}`)
        return
      }
      if (!SUPPORTED_CHAINS.includes(token.chainId)) return
      if (token.address === ZERO_ADDRESS) return
      if (!token.logoURI) delete token.logoURI // Remove empty logoURIs
      // Default flags if undefined.
      if (typeof token.isAcross === 'undefined') token.isAcross = false
      if (typeof token.isOFT === 'undefined') token.isOFT = false
      if (token.chainId === 42161) {
        const rootKey = token.address.toLowerCase()
        if (rootTokensMap[rootKey]) {
          const existing = rootTokensMap[rootKey]
          rootTokensMap[rootKey] = mergeTokenData(existing, token)
        } else {
          rootTokensMap[rootKey] = token
        }
      } else {
        const key = token.address.toLowerCase() + '_' + token.chainId
        if (normalizedMap[key]) {
          const existing = normalizedMap[key]
          normalizedMap[key] = mergeTokenData(existing, token)
        } else {
          normalizedMap[key] = token
        }
      }
    })

    // 3. Incorporate Ulysses tokens.
    if (ulyssesData.tokens && Array.isArray(ulyssesData.tokens)) {
      ulyssesData.tokens.forEach((token) => {
        if (BLOCKED_TOKEN_SYMBOLS.includes(token.symbol)) {
          console.warn(`skipping, blocked token ${token.symbol} on chain ${token.chainId}`)
          return
        }
        if (!token.logoURI) delete token.logoURI // Remove empty logoURIs
        const key = token.underlyingAddress.toLowerCase() + '_' + token.chainId
        if (normalizedMap[key]) {
          const existing = normalizedMap[key]
          normalizedMap[key] = mergeTokenDataUlysses(existing, token)
        } else {
          normalizedMap[key] = token
        }
      })
    }

    // 4. Final tokens and rootTokens arrays.
    const finalTokens = Object.values(normalizedMap).sort(orderTokens)
    const finalRootTokens = Object.values(rootTokensMap).sort(orderTokens)

    // -----------------------------------------------------------------
    // Build new merged output in complete token list format.
    // -----------------------------------------------------------------
    const newOutput = {
      name: 'Hermes Omnichain Token List',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      version: { major: 1, minor: 0, patch: 0 }, // default version if no previous exists
      tokens: finalTokens,
      rootTokens: finalRootTokens,
      tags: {},
      keywords: ['hermes', 'default'],
      logoURI: 'https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/logos/Hermes-color.svg',
    }

    // Read previous file if it exists to check for differences.
    let finalOutput = newOutput
    try {
      const existingDataRaw = await fs.readFile('token-list.json', 'utf8')
      const existingData = JSON.parse(existingDataRaw)
      // Remove version and timestamp from both outputs for comparison.
      const oldComparable = { ...existingData, version: undefined, timestamp: undefined }
      const newComparable = { ...newOutput, version: undefined, timestamp: undefined }
      if (
        !isEqual(oldComparable, newComparable) ||
        finalTokens.length !== existingData.tokens.length ||
        finalRootTokens.length !== existingData.rootTokens.length
      ) {
        // If differences exist, bump patch version.
        finalOutput.version = bumpVersion(existingData.version)
        finalOutput.timestamp = Math.floor(Date.now() / 1000).toString()
      } else {
        // No meaningful changes; keep previous version.
        finalOutput.version = existingData.version
        finalOutput.timestamp = existingData.timestamp
      }
    } catch (err) {
      // File doesn't exist; we'll use the default version.
    }

    // Write final merged output to token-list.json.
    await fs.writeFile('token-list.json', JSON.stringify(finalOutput, null, 2))
    await fs.writeFile('output/inactives.json', JSON.stringify(inactiveTokensArray, null, 2))
    console.log(
      `✅  token-list.json written with ${finalTokens.length} tokens and ${finalRootTokens.length} root tokens`
    )
  } catch (error) {
    console.error('❌ Error merging tokens:', error)
  }
}

main()
