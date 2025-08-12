const fs = require('fs').promises
const path = require('path')
const { getCoinLogo } = require('./getCoinLogo')
const { orderTokens } = require('./orderTokens')
const { OVERRIDE_LOGO } = require('../configs')
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
    extensions: mergeExtensions(existing.extensions, incoming.extensions),
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
    let uniswapTokens = []
    try {
      const temp = JSON.parse(uniswapRaw)
      if (Array.isArray(temp.tokens)) {
        uniswapTokens = temp.tokens
      } else if (Array.isArray(temp)) {
        uniswapTokens = temp
      }
    } catch (err) {
      console.error('Error parsing uniswap.json, assuming direct array:', err)
    }

    // -----------------------------------------------------------------
    // GROUPING TOKENS PER SOURCE
    // -----------------------------------------------------------------

    // 1. Build the normalized map from Across and Stargate tokens.
    const normalizedMap = {}
    const rootTokensMap = {}

    // Process Across tokens.
    for (const symbol in acrossData) {
      const tokenData = acrossData[symbol]
      const normalizedArray = await normalizeAcrossToken(tokenData, normalizedMap, rootTokensMap)
      normalizedArray.forEach((token) => {
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
      if (normalizedToken.chainId === 42161) {
        const rootKey = normalizedToken.address.toLowerCase()
        if (!rootTokensMap[rootKey]) {
          rootTokensMap[rootKey] = normalizedToken
        } else {
          rootTokensMap[rootKey] = mergeTokenData(rootTokensMap[rootKey], normalizedToken)
        }
      } else {
        const key = normalizedToken.address.toLowerCase() + '_' + normalizedToken.chainId
        if (!normalizedMap[key]) {
          normalizedMap[key] = normalizedToken
        } else {
          normalizedMap[key] = mergeTokenData(normalizedMap[key], normalizedToken)
        }
      }
    }

    // 2. Incorporate Uniswap tokens and Ulysses Root Tokens.
    if (Array.isArray(uniswapTokens) && ulyssesData.rootTokens && Array.isArray(ulyssesData.rootTokens)) {
      uniswapTokens.concat(ulyssesData.rootTokens).forEach((token) => {
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
    }

    // 3. Incorporate Ulysses tokens.
    if (ulyssesData.tokens && Array.isArray(ulyssesData.tokens)) {
      ulyssesData.tokens.forEach((token) => {
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
    console.log(
      `✅  token-list.json written with ${finalTokens.length} tokens and ${finalRootTokens.length} root tokens`
    )
  } catch (error) {
    console.error('❌ Error merging tokens:', error)
  }
}

main()
