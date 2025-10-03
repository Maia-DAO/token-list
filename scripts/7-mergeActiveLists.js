const fs = require('fs').promises
const path = require('path')
const { SupportedChainId, ZERO_ADDRESS } = require('maia-core-sdk')

const {
  OVERRIDE_LOGO,
  OVERRIDE_LOGO_BY_URL,
  PARTNER_TOKEN_SYMBOLS,
  CORE_TOKEN_SYMBOLS,
  BLOCKED_TOKEN_SYMBOLS,
  NATIVE_OFT_ADAPTERS,
  CHAINS_WITH_NO_SWAPPING,
  EXTENDED_SUPPORTED_CHAIN_IDS,
} = require('../configs')
const { getCoinLogo } = require('./getCoinLogo')
const { mergeExtensions, orderAttributes, orderTokens } = require('../helpers')
const { getAddress } = require('ethers')

// ---------------------------------------------------------------------
// Normalization functions for tokens to the unified format
// ---------------------------------------------------------------------

function encodeSpaces(url) {
  return url.replace(/ /g, '%20')
}

function finalCleanTokens(tokenMap, wrappedNativeTokens) {
  return Object.values(tokenMap)
    .filter(
      (t) =>
        t.isAcross ||
        t.isOFT ||
        wrappedNativeTokens.some(
          (w) =>
            w.chainId === t.chainId &&
            ((t.address && w.address.toLowerCase() === t.address.toLowerCase()) ||
              (t.underlyingAddress && w.underlyingAddress?.toLowerCase() === t.underlyingAddress?.toLowerCase()))
        ) ||
        !CHAINS_WITH_NO_SWAPPING.includes(t.chainId)
    )
    .map((t) => {
      if (t.logoURI) t.logoURI = encodeSpaces(t.logoURI)
      if (t.address) t.address = getAddress(t.address)
      return t
    })
    .sort(orderTokens)
}

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
async function normalizeAcrossToken(data, supportedChains) {
  const tokens = []
  // Convert addresses keys to numbers.
  for (const key in data.addresses) {
    const chainId = Number(key)
    const decimals = data.addresses[key].decimals
    if (decimals) continue
    const address = getAddress(data.addresses[key].address.toLowerCase())
    tokens.push({
      chainId,
      address,
      name: data.name,
      decimals: data.decimals,
      symbol: data.symbol,
      logoURI: (await getCoinLogo(address, chainId, data.coingeckoId, undefined)) ?? null,
      tags: [],
      extensions: {
        acrossInfo: Object.fromEntries(
          Object.entries(data.addresses)
            .filter(([chain]) => {
              const chainNumber = Number(chain)
              return chainNumber !== chainId && supportedChains.includes(chainNumber)
            })
            .map(([chain, value]) => [
              chain,
              {
                ...value,
                address: getAddress(value.address.toLowerCase()),
              },
            ])
        ),
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
  const fallbackLogoTokenAddress =
    token?.extensions?.bridgeInfo && token.extensions.bridgeInfo.length === 1
      ? Array.from(token.extensions.bridgeInfo.values())[0]
      : undefined
  let tokenLogoURI = OVERRIDE_LOGO_BY_URL[token.icon] ?? token.icon ?? OVERRIDE_LOGO[token.symbol]
  if (!tokenLogoURI)
    tokenLogoURI = await getCoinLogo(
      token.address,
      token.chainId,
      token.extensions?.coingeckoId,
      token.extensions?.coinMarketCapId
    )
  if (!tokenLogoURI && fallbackLogoTokenAddress)
    tokenLogoURI = await getCoinLogo(fallbackLogoTokenAddress, token.chainId, undefined, undefined)

  if (
    !token.address ||
    !token.address.length > 0 ||
    token.address === '0x' ||
    token.address === '0x00' ||
    !token.decimals ||
    !token.name ||
    !token.symbol
  ) {
    return undefined
  }

  const result = {
    chainId: token.chainId,
    address: getAddress(token.address.toLowerCase()),
    name: token.name ?? token.symbol,
    decimals: token.decimals,
    symbol: token.symbol,
    logoURI: tokenLogoURI ?? null,
    tags: [],
    isAcross: false,
    isOFT: token.isOFT, // not all tokens in stargate list are OFT
  }

  if (token.extensions) result.extensions = token.extensions

  if (token.isOFT) {
    result.extensions = token.extensions || {}
    result.extensions.oftInfo = token.extensions.oftInfo || {}

    if (token.extensions.peersInfo) {
      result.extensions.oftInfo.peersInfo = token.extensions.peersInfo
      delete token.extensions.peersInfo
    }

    if (token.extensions.feeInfo) {
      result.extensions.oftInfo.feeInfo = token.extensions.feeInfo
      delete token.extensions.feeInfo
    }

    if (token.oftAdapter) {
      result.extensions.oftInfo.oftAdapter = getAddress(token.oftAdapter)
      delete token.oftAdapter
    }

    if (token.oftVersion) {
      result.extensions.oftInfo.oftVersion = token.oftVersion
      delete token.oftVersion
    }

    if (token.endpointVersion) {
      result.extensions.oftInfo.endpointVersion = token.endpointVersion
      delete token.endpointVersion
    }

    if (token.endpointId) {
      result.extensions.oftInfo.endpointId = token.endpointId
      delete token.endpointId
    }

    if (token.oftSharedDecimals) {
      result.extensions.oftInfo.oftSharedDecimals = token.oftSharedDecimals
      delete token.oftSharedDecimals
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
    const j = JSON.parse(raw)
    if (Array.isArray(j)) return j
    if (j && Array.isArray(j.tokens)) return j.tokens.map((t) => {
      t.address = getAddress(t.address)
      return t
    })
  } catch (e) {
    /* ignore */
  }
  return []
}

/**
 * Main merge function.
 */
async function main() {
  // Supported Chains
  const SUPPORTED_CHAINS = [...Object.values(SupportedChainId), ...EXTENDED_SUPPORTED_CHAIN_IDS].map(Number)

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
    const ulyssesTokens = [...ulyssesData.tokens, ...ulyssesData.rootTokens]

    // 4. Uniswap tokens from uniswap.json.
    const uniswapRaw = await fs.readFile(path.join('output', 'uniswap.json'), 'utf8')
    const uniswapTokens = await tryParseTokens(uniswapRaw)

    // 5. Wrapped Native tokens from wrappedNatives.json.
    const wrappedNativesRaw = await fs.readFile('wrappedNatives.json', 'utf8')
    const wrappedNativeTokens = JSON.parse(wrappedNativesRaw)

    // 6. Additional tokens from additionalTokens.json.
    const additionalTokensRaw = await fs.readFile('additionalTokens.json', 'utf8')
    const additionalTokens = JSON.parse(additionalTokensRaw)

    // 7. Fetch TOKEN_LIST files
    let tokenListFiles = {}
    try {
      const files = await fs.readdir('output')
      const tokenFiles = files.filter((f) => f.startsWith('TOKEN_LIST_'))
      await Promise.all(
        tokenFiles.map(async (f) => {
          tokenListFiles[f] = await tryParseTokens(await fs.readFile(path.join('output', f), 'utf8'))
        })
      )
    } catch (e) {}

    // -----------------------------------------------------------------
    // GROUPING TOKENS PER SOURCE
    // -----------------------------------------------------------------

    // 1. Build the normalized map from Across, Stargate and other tokens.
    const normalizedMap = {}
    const rootTokensMap = {}

    // Process Across tokens.
    for (const symbol in acrossData) {
      const tokenData = acrossData[symbol]
      const normalizedArray = await normalizeAcrossToken(tokenData, SUPPORTED_CHAINS)
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
            rootTokensMap[rootKey] = orderAttributes(token)
          }
        } else {
          // Merge into normalizedMap.
          const key = token.address.toLowerCase() + '_' + token.chainId
          if (!normalizedMap[key]) {
            normalizedMap[key] = orderAttributes(token)
          }
        }
      })
    }

    // First pass: collect all OFT tokens and build peer relationship maps
    const allOFTTokens = []
    const peerRelationships = new Map() // tokenKey -> Set of peer keys

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

      const key = normalizedToken.address.toLowerCase() + '_' + normalizedToken.chainId
      allOFTTokens.push({ token: normalizedToken, key })

      // Build peer relationships for OFT tokens
      if (normalizedToken.isOFT && normalizedToken.extensions?.oftInfo?.peersInfo) {
        const peers = new Set()
        for (const [chainId, peerInfo] of Object.entries(normalizedToken.extensions.oftInfo.peersInfo)) {
          const peerKey = peerInfo.tokenAddress.toLowerCase() + '_' + chainId
          peers.add(peerKey)
        }
        peerRelationships.set(key, peers)
      }
    }

    // Second pass: determine which OFTs should be active/inactive based on peer relationships and limits
    const oftsPerChainMap = {}
    const activeOFTSet = new Set()
    const inactiveOFTSet = new Set()
    const vipTokens = new Set()

    // Build bidirectional peer relationships map
    const fullPeerGroups = new Map() // Maps each token to its full peer group

    // First build all peer groups
    for (const { token, key } of allOFTTokens) {
      if (!fullPeerGroups.has(key)) {
        fullPeerGroups.set(key, new Set([key]))
      }

      if (token.isOFT && token.extensions?.oftInfo?.peersInfo) {
        const currentGroup = fullPeerGroups.get(key)

        for (const [chainId, peerInfo] of Object.entries(token.extensions.oftInfo.peersInfo)) {
          const peerKey = peerInfo.tokenAddress.toLowerCase() + '_' + chainId
          currentGroup.add(peerKey)

          // Ensure peer also has this token in its group
          if (!fullPeerGroups.has(peerKey)) {
            fullPeerGroups.set(peerKey, new Set([peerKey]))
          }
          fullPeerGroups.get(peerKey).add(key)
        }
      }
    }

    // Merge overlapping peer groups (transitive closure)
    let changed = true
    while (changed) {
      changed = false
      for (const [key1, group1] of fullPeerGroups) {
        for (const [key2, group2] of fullPeerGroups) {
          if (key1 !== key2) {
            // Check if groups overlap
            const hasOverlap = Array.from(group1).some((k) => group2.has(k))
            if (hasOverlap) {
              // Merge groups
              const beforeSize = group1.size
              group2.forEach((k) => group1.add(k))
              if (group1.size > beforeSize) {
                changed = true
                // Update all members to point to the merged group
                group1.forEach((k) => fullPeerGroups.set(k, group1))
              }
            }
          }
        }
      }
    }

    // First, identify VIP tokens and their entire peer groups (always active)
    for (const { token, key } of allOFTTokens) {
      if (
        PARTNER_TOKEN_SYMBOLS.includes(token.symbol) ||
        CORE_TOKEN_SYMBOLS.includes(token.symbol) ||
        ulyssesTokens.some(
          (ulyssesToken) =>
            (ulyssesToken.address?.toLowerCase() === token.address?.toLowerCase() ||
              ulyssesToken.underlyingAddress?.toLowerCase() === token.address?.toLowerCase()) &&
            ulyssesToken.chainId === token.chainId
        )
      ) {
        vipTokens.add(key)
        // Mark entire peer group as active
        const peerGroup = fullPeerGroups.get(key) || new Set([key])
        peerGroup.forEach((peerKey) => activeOFTSet.add(peerKey))
      }
    }

    // Process tokens by chain and apply limits
    const tokensByChain = new Map()
    for (const { token, key } of allOFTTokens) {
      if (!tokensByChain.has(token.chainId)) {
        tokensByChain.set(token.chainId, [])
      }
      tokensByChain.get(token.chainId).push({ token, key })
    }

    // Track which peer groups have been processed
    const processedGroups = new Set()

    for (const [chainId, tokens] of tokensByChain) {
      const limit = chainId === 42161 ? 20 : 5
      let oftCount = 0

      for (const { token, key } of tokens) {
        if (!token.isOFT) continue

        // Skip if already marked as active (VIP or peer of VIP)
        if (activeOFTSet.has(key)) {
          oftCount++
          continue
        }

        // Skip if already processed as inactive
        if (inactiveOFTSet.has(key)) {
          continue
        }

        // Get the full peer group for this token
        const peerGroup = fullPeerGroups.get(key) || new Set([key])

        // Check if ANY token in the peer group is already active
        const hasActivePeer = Array.from(peerGroup).some((peerKey) => activeOFTSet.has(peerKey))

        if (hasActivePeer) {
          // If any peer is active, entire group should be active
          peerGroup.forEach((peerKey) => activeOFTSet.add(peerKey))
          oftCount++
        } else if (oftCount < limit) {
          // Within limit, mark entire peer group as active
          peerGroup.forEach((peerKey) => activeOFTSet.add(peerKey))
          processedGroups.add(peerGroup)
          oftCount++
        } else {
          // Exceeds limit, mark entire peer group as inactive
          // But ONLY if no peer is active on ANY chain
          let shouldMarkInactive = true
          for (const peerKey of peerGroup) {
            if (activeOFTSet.has(peerKey)) {
              shouldMarkInactive = false
              break
            }
          }

          if (shouldMarkInactive) {
            peerGroup.forEach((peerKey) => inactiveOFTSet.add(peerKey))
            processedGroups.add(peerGroup)
          } else {
            // Some peer is active, so mark all as active
            peerGroup.forEach((peerKey) => activeOFTSet.add(peerKey))
            oftCount++
          }
        }
      }

      oftsPerChainMap[chainId] = oftCount
    }

    // Final validation: ensure no token is both active and inactive
    for (const key of inactiveOFTSet) {
      if (activeOFTSet.has(key)) {
        inactiveOFTSet.delete(key)
      }
    }

    // Third pass: actually place tokens in maps and build inactive array
    let inactiveTokensArray = []
    const inactiveTokensMap = {} // Use a map to prevent duplicates and allow merging

    for (const { token, key } of allOFTTokens) {
      // Handle native OFT adapters
      if (token?.extensions?.oftInfo?.peersInfo && Object.keys(token.extensions.oftInfo.peersInfo).length > 0) {
        for (const [chainId, peerInfo] of Object.entries(token.extensions.oftInfo.peersInfo) || {}) {
          const nativeOFTAdapter = NATIVE_OFT_ADAPTERS[parseInt(chainId)]?.[peerInfo.tokenAddress.toLowerCase()]
          if (nativeOFTAdapter) {
            token.extensions.oftInfo.peersInfo[chainId] = { tokenAddress: nativeOFTAdapter }
          }
        }
      }

      if (token.chainId === 42161) {
        const rootKey = token.address.toLowerCase()

        if (inactiveOFTSet.has(key) && !activeOFTSet.has(key)) {
          // Store in inactive map to handle duplicates
          const inactiveKey = token.address.toLowerCase() + '_' + token.chainId
          if (!inactiveTokensMap[inactiveKey]) {
            inactiveTokensMap[inactiveKey] = orderAttributes(token)
          } else {
            // Merge with existing inactive token entry, preserving OFT info
            inactiveTokensMap[inactiveKey] = mergeTokenData(inactiveTokensMap[inactiveKey], token)
          }
        } else {
          if (!rootTokensMap[rootKey]) {
            rootTokensMap[rootKey] = orderAttributes(token)
          } else {
            rootTokensMap[rootKey] = mergeTokenData(rootTokensMap[rootKey], token)
          }
        }
      } else {
        if (inactiveOFTSet.has(key) && !activeOFTSet.has(key)) {
          // Store in inactive map to handle duplicates
          const inactiveKey = token.address.toLowerCase() + '_' + token.chainId
          if (!inactiveTokensMap[inactiveKey]) {
            inactiveTokensMap[inactiveKey] = orderAttributes(token)
          } else {
            // Merge with existing inactive token entry, preserving OFT info
            inactiveTokensMap[inactiveKey] = mergeTokenData(inactiveTokensMap[inactiveKey], token)
          }
        } else {
          if (!normalizedMap[key]) {
            normalizedMap[key] = orderAttributes(token)
          } else {
            normalizedMap[key] = mergeTokenData(normalizedMap[key], token)
          }
        }
      }
    }

    // Convert inactive map to array
    inactiveTokensArray = Object.values(inactiveTokensMap)

    // 2. Incorporate Uniswap tokens, Ulysses Root Tokens and Wrapped Native Tokens.
    const allUniswapFormatTokens = [
      ...uniswapTokens,
      ...wrappedNativeTokens,
      ...ulyssesData.rootTokens,
      ...additionalTokens,
      ...Object.values(tokenListFiles).flat(),
    ]

    allUniswapFormatTokens.forEach((token) => {
      if (BLOCKED_TOKEN_SYMBOLS.includes(token.symbol)) {
        console.warn(`skipping, blocked token ${token.symbol} on chain ${token.chainId}`)
        return
      }
      if (!SUPPORTED_CHAINS.includes(token.chainId)) return
      if (token.address === ZERO_ADDRESS) return

      token.address = getAddress(token.address)

      if (
        inactiveTokensArray.some(
          (inactive) =>
            (inactive.address === token.address || inactive.underlyingAddress === token.address) &&
            inactive.chainId === token.chainId
        )
      ) {
        return
      }

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
          rootTokensMap[rootKey] = orderAttributes(token)
        }
      } else {
        const key = token.address.toLowerCase() + '_' + token.chainId
        if (normalizedMap[key]) {
          const existing = normalizedMap[key]
          normalizedMap[key] = mergeTokenData(existing, token)
        } else {
          normalizedMap[key] = orderAttributes(token)
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

        token.underlyingAddress = getAddress(token.underlyingAddress)
        token.globalAddress = getAddress(token.globalAddress)

        const key = token.underlyingAddress.toLowerCase() + '_' + token.chainId

        if (normalizedMap[key]) {
          const existing = normalizedMap[key]
          normalizedMap[key] = mergeTokenDataUlysses(existing, token)
        } else {
          normalizedMap[key] = orderAttributes(token)
        }
      })
    }

    // 4. Final tokens and rootTokens arrays.
    const finalTokens = finalCleanTokens(normalizedMap, wrappedNativeTokens)
    const finalRootTokens = finalCleanTokens(rootTokensMap, wrappedNativeTokens)

    // -----------------------------------------------------------------
    // Build new merged output in complete token list format.
    // -----------------------------------------------------------------
    const newOutput = {
      name: 'Hermes Omnichain Token List',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      version: { major: 1, minor: 0, patch: 0 }, // default version if no previous exists
      tokens: finalTokens,
      rootTokens: finalRootTokens,
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
