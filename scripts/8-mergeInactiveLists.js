const fs = require('fs').promises
const path = require('path')
const { SupportedChainId } = require('maia-core-sdk')
const { orderTokens } = require('./orderTokens')

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

async function main() {
  try {
    // 1. Uniswap format lists here:
    const inputFiles = ['output/uni_extended.json', 'output/compound.json', 'output/set.json', 'output/ba.json']

    // --- Step 1 & 2: Load and merge all input lists ---
    const mergedMap = new Map()

    for (const filePath of inputFiles) {
      let list
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        list = JSON.parse(raw)
      } catch (err) {
        console.error(`❌  Failed to read or parse ${filePath}:`, err.message)
        continue
      }

      // Extract the tokens array (Uniswap format)
      const tokens = Array.isArray(list.tokens) ? list.tokens : Array.isArray(list) ? list : []

      for (const token of tokens) {
        if (!Object.values(SupportedChainId).includes(token.chainId)) continue // Skip unsupported chain 
        const key = `${token.chainId}_${token.address.toLowerCase()}`
        if (!mergedMap.has(key)) {
          mergedMap.set(key, { ...token }) // clone to avoid mutating original
        }
      }
    }

    const mergedTokens = Array.from(mergedMap.values())

    // --- Step 3: Enrich from existing token-list.json ---
    let existingList
    try {
      const existingRaw = await fs.readFile(path.join('token-list.json'), 'utf8')
      existingList = JSON.parse(existingRaw)
    } catch (err) {
      console.error('❌  Could not read token-list.json:', err.message)
      process.exit(1)
    }

    // Move tokens without logos to the inactive list
    const tokensWithoutLogo = existingList.tokens.filter((token) => !token.logoURI || token.logoURI === '')
    const rootTokensWithoutLogo = existingList.rootTokens.filter((token) => !token.logoURI || token.logoURI === '')
    const allTokens = mergedTokens.concat(tokensWithoutLogo).concat(rootTokensWithoutLogo)

    // Delete tokens without logos from the main list
    existingList.tokens = existingList.tokens.filter((token) => token.logoURI && token.logoURI !== '')
    existingList.rootTokens = existingList.rootTokens.filter((token) => token.logoURI && token.logoURI !== '')

    const existingMap = new Map(
      (existingList.tokens || [])
        .filter((t) => typeof t.address === 'string' && t.address.length > 0)
        .map((t) => [`${t.chainId}_${t.address.toLowerCase()}`, t])
    )

    // Copy over extensions, isAcross, isOFT
    const finalTokens = allTokens
      .reduce((memo, token) => {
        const key = `${token.chainId}_${token.address.toLowerCase()}`
        const existing = existingMap.get(key)
        if (!existing) {
          memo.push({
            ...token,
            extensions: token.extensions || {},
            isAcross: token.isAcross,
            isOFT: token.isOFT,
          })
        }
        return memo
      }, [])
      .sort(orderTokens)

    // --- Write out the combined list ---
    const newInactiveOutput = {
      name: 'Hermes Omnichain Inactive Token List',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      version: { major: 1, minor: 0, patch: 0 }, // default version if no previous exists
      tokens: finalTokens,
      tags: {},
      keywords: ['hermes', 'default'],
      logoURI: 'https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/logos/Hermes-color.svg',
    }

    let finalInactiveOutput = newInactiveOutput

    try {
      const existingInactiveRaw = await fs.readFile('inactive-token-list.json', 'utf8')
      const existingInactive = JSON.parse(existingInactiveRaw)

      const oldComparable = {
        ...existingInactive,
        version: undefined,
        timestamp: undefined,
      }
      const newComparable = {
        ...newInactiveOutput,
        version: undefined,
        timestamp: undefined,
      }

      if (!isEqual(oldComparable, newComparable) || finalTokens.length !== existingInactive.tokens.length) {
        // Differences exist – bump patch version
        finalInactiveOutput.version = bumpVersion(existingInactive.version)
        finalInactiveOutput.timestamp = Math.floor(Date.now() / 1000).toString()
      } else {
        // No change – keep version
        finalInactiveOutput.version = existingInactive.version
        finalInactiveOutput.timestamp = existingInactive.timestamp
      }
    } catch (err) {
      // File doesn't exist; we'll use the default version.
      console.log('Error with inactive list:', err)
    }

    await fs.writeFile('inactive-token-list.json', JSON.stringify(finalInactiveOutput, null, 2))
    console.log(`✅  inactive-token-list.json written with ${finalTokens.length} tokens`)

    await fs.writeFile('token-list.json', JSON.stringify(existingList, null, 2))
    console.log(`✅  removed tokens without logos from token-list.json`)
  } catch (err) {
    console.error('❌  Error merging inactive tokens:', err.message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
