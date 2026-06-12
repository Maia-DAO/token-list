const path = require('path')
const fs = require('fs')

// Import the WRAPPED_NATIVES object from configs/index.js
const { WRAPPED_NATIVES } = require('../../configs/index.js')
const { orderAttributes } = require('../../helpers/index.js')

// Load token-list.json from root
const tokenListPath = path.join(__dirname, '../../token-list.json')
const tokenList = JSON.parse(fs.readFileSync(tokenListPath, 'utf8'))

// Initialize result array
const matchedTokens = []

// Flatten tokens and rootTokens into a single array
const allTokens = [
  ...(Array.isArray(tokenList.tokens) ? tokenList.tokens : []),
  ...(Array.isArray(tokenList.rootTokens) ? tokenList.rootTokens : []),
]

// Preserve order
const orderedChainIds = Reflect.ownKeys(WRAPPED_NATIVES)

// Helper function to find a matching token for a given chainId
function findTokenForChain(chainId, nativeAddress) {
  for (const token of allTokens) {
    if (token.chainId !== Number(chainId)) continue

    const addressMatch = token.address?.toLowerCase() === nativeAddress.toLowerCase()
    const underlyingMatch = token.underlyingAddress?.toLowerCase() === nativeAddress.toLowerCase()

    if (addressMatch || underlyingMatch) {
      const matchedToken = { ...token }

      if (underlyingMatch) {
        matchedToken.address = matchedToken.underlyingAddress
        delete matchedToken.globalAddress
        delete matchedToken.localAddress
        delete matchedToken.underlyingAddress

        if (!matchedToken.isAcross) matchedToken.isAcross = false
        if (!matchedToken.isOFT) matchedToken.isOFT = false
      }

      return orderAttributes(matchedToken)
    }
  }

  return null
}

// Iterate in preserved order
const missingChainIds = []
for (const chainId of orderedChainIds) {
  const nativeAddress = WRAPPED_NATIVES[chainId]
  const match = findTokenForChain(chainId, nativeAddress)
  if (match) matchedTokens.push(match)
  else {
    missingChainIds.push(chainId)
    console.warn(
      `⚠️ No token found for wrapped native ${nativeAddress} on chain ${chainId} — entry will be missing from wrappedNatives.json`
    )
  }
}

const outputPath = path.join(__dirname, '../../wrappedNatives.json')

// A chain present in the existing wrappedNatives.json but unmatched now means a configured
// wrapped native was demoted/dropped upstream — never ship that silently.
let previousChainIds = new Set()
try {
  previousChainIds = new Set(JSON.parse(fs.readFileSync(outputPath, 'utf8')).map((t) => t.chainId))
} catch (e) {
  /* no previous file — nothing to regress against */
}
const regressions = missingChainIds.filter((chainId) => previousChainIds.has(Number(chainId)))

if (regressions.length > 0) {
  console.error(
    `❌ Wrapped native(s) for chain(s) ${regressions.join(', ')} exist in the current wrappedNatives.json but have no match in token-list.json. Leaving wrappedNatives.json untouched.`
  )
  process.exitCode = 1
} else {
  fs.writeFileSync(outputPath, JSON.stringify(matchedTokens, null, 2), 'utf8')
  console.log(`✅ Done. Found ${matchedTokens.length} wrapped native tokens.`)
}
