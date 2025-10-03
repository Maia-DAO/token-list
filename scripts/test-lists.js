const { ethers } = require('ethers')
const dataActiveList = require('../token-list.json')
const dataInactiveList = require('../inactive-token-list.json')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function getAddressFromEntry(token) {
  return token.address ?? token.underlyingAddress
}

function tokensExtensionsAreInSameList(listName, list) {
  function logTokenError(token, msg) {
    console.error(`${listName}: ${token.chainId}-${getAddressFromEntry(token)}: ${msg}`)
  }

  const tokens = [...list.tokens, ...(list.rootTokens ?? [])]
  let issues = 0

  tokens.forEach((token) => {
    const mainAddress = getAddressFromEntry(token)
    try {
      if (mainAddress !== ethers.getAddress(mainAddress)) logTokenError(token, 'address not checksummed')
    } catch (error) {
      logTokenError(token, error)
      issues++
    }

    const extensions = token.extensions
    if (extensions) {
      const oftInfo = extensions.oftInfo
      if (oftInfo) {
        const peersInfo = oftInfo.peersInfo
        if (!peersInfo) {
          logTokenError(token, 'peersInfo undefined')
          issues++
        } else {
          const peers = Object.entries(peersInfo)

          peers.forEach(([chain, { tokenAddress: address }]) => {
            if (address === ZERO_ADDRESS) return

            const tokenFound = tokens.find((tokenEntry) => {
              const tokenAddress = getAddressFromEntry(tokenEntry)
              return Number(chain) === tokenEntry.chainId && address === tokenAddress
            })

            if (!tokenFound) {
              logTokenError(token, `peer not found: ${chain}-${address}`)
              issues++
            }
          })
        }
      }

      const acrossInfo = extensions.acrossInfo
      if (acrossInfo) {
        const peers = Object.entries(acrossInfo)

        peers.forEach(([chain, { address }]) => {
          const tokenFound = tokens.find((tokenEntry) => {
            const tokenAddress = getAddressFromEntry(tokenEntry)
            return Number(chain) === tokenEntry.chainId && address === tokenAddress
          })

          if (!tokenFound) {
            logTokenError(token, `across info not found: ${chain}-${address}`)
            issues++
          }
        })
      }
    }
  })

  return issues
}

/**
 * Checks for duplicate token symbols on the same chain
 * This function identifies tokens with the same symbol on the same chain which can cause routing conflicts
 */
function checkDuplicateSymbols() {
  // Combine all tokens from both lists
  const allTokens = [
    ...(dataActiveList.tokens || []),
    ...(dataActiveList.rootTokens || []),
    ...(dataInactiveList.tokens || []),
  ]

  console.log(`\n🔍 Checking for duplicate symbols across ${allTokens.length} tokens...\n`)

  const chainSymbolMap = new Map()
  let duplicateCount = 0

  // Group tokens by chain and symbol
  allTokens.forEach(token => {
    const key = `${token.chainId}-${token.symbol}`
    
    if (!chainSymbolMap.has(key)) {
      chainSymbolMap.set(key, [])
    }
    
    chainSymbolMap.get(key).push(token)
  })

  console.log('=' .repeat(80))
  console.log('🔄 CHECKING FOR DUPLICATE SYMBOLS PER CHAIN')
  console.log('=' .repeat(80))

  // Check for duplicates
  chainSymbolMap.forEach((tokens, key) => {
    if (tokens.length > 1) {
      const [chainId, symbol] = key.split('-')
      console.log(`❌ DUPLICATE SYMBOL: Chain ${chainId} has ${tokens.length} tokens with symbol "${symbol}"`)
      
      tokens.forEach((token, index) => {
        const address = getAddressFromEntry(token)
        const flags = []
        if (token.isOFT) flags.push('OFT')
        if (token.isAcross) flags.push('Across')
        if (token.noLiquidityOnChain) flags.push('NoLiquidity')
          
        console.log(`    ${index + 1}. Address: ${address} ${flags.length > 0 ? `[${flags.join(', ')}]` : ''}`)
      })
      
      duplicateCount++
      console.log('')
    }
  })

  // Summary
  if (duplicateCount === 0) {
    console.log('✅ NO DUPLICATE SYMBOLS FOUND! All tokens have unique symbols per chain.')
  } else {
    console.log(`🚨 FOUND ${duplicateCount} CHAINS WITH DUPLICATE SYMBOLS`)
    console.log('These duplicates can cause routing conflicts and ambiguous token references.')
  }

  return duplicateCount
}

/**
 * Checks for data inconsistencies in OFT and Across bridge configurations
 * This function validates that peer relationships are symmetrical across both lists
 */
function checkBridgeDataConsistency() {
  // Combine all tokens from both lists
  const allTokens = [
    ...(dataActiveList.tokens || []),
    ...(dataActiveList.rootTokens || []),
    ...(dataInactiveList.tokens || []),
  ]

  console.log(`\n🔍 Checking consistency of ${allTokens.length} tokens...\n`)

  // Track all inconsistencies
  let oftInconsistencies = 0
  let acrossInconsistencies = 0

  // Create lookup maps for faster searching
  const tokensByChainAndAddress = new Map()

  allTokens.forEach(token => {
    // By chain and symbol
    const key = `${token.chainId}-${getAddressFromEntry(token)}`
    if (!tokensByChainAndAddress.has(key)) {
      tokensByChainAndAddress.set(key, [])
    }
    tokensByChainAndAddress.get(key).push(token)
  })

  // Helper function to find token on a chain
  const findTokenOnChain = (chainId, address) => {
    // Try by symbol first
    const tokenKey = `${chainId}-${address}`
    const tokensByAddress = tokensByChainAndAddress.get(tokenKey) || []
    
    // Return first match by symbol (if any)
    return tokensByAddress[0] || null
  }

  console.log('=' .repeat(80))
  console.log('🌉 CHECKING OFT PEER CONSISTENCY')
  console.log('=' .repeat(80))

  // Check OFT peer consistency
  allTokens.forEach(token => {
    if (!token.isOFT || !token.extensions?.oftInfo?.peersInfo) return

    const { chainId, symbol, extensions, noLiquidityOnChain } = token
    const peersInfo = extensions.oftInfo.peersInfo

    Object.entries(peersInfo).forEach(([peerChainIdStr, peerInfo]) => {
      const peerChainId = parseInt(peerChainIdStr)
      const peerTokenAddress = peerInfo.tokenAddress

      // Skip native OFTs
      if (peerTokenAddress === ZERO_ADDRESS) return

      // Skip self-references
      if (peerChainId === chainId) return

      // Find the peer token on the target chain
      const peerToken = findTokenOnChain(peerChainId, peerTokenAddress)

      // Check reverse peer relationship
      if (peerToken?.isOFT && peerToken?.extensions?.oftInfo?.peersInfo) {
        const reversePeersInfo = peerToken.extensions.oftInfo.peersInfo
        const reverseReference = reversePeersInfo[chainId.toString()]

        if (!reverseReference) {
          console.log(`❌ ASYMMETRIC OFT: ${symbol} chain ${chainId} -> ${peerChainId}, but chain ${peerChainId} doesn't reference back to ${chainId}`)
          oftInconsistencies++
        } else {
          // Check if the addresses match (for non-native tokens)
          const currentTokenAddr = getAddressFromEntry(token)
          if (currentTokenAddr && reverseReference.tokenAddress !== ZERO_ADDRESS) {
            if (currentTokenAddr.toLowerCase() !== reverseReference.tokenAddress.toLowerCase()) {
              console.log(`⚠️  ADDRESS MISMATCH: ${symbol} addresses don't match between chains ${chainId} and ${peerChainId}`)
              console.log(`    Chain ${chainId}: ${currentTokenAddr}`)
              console.log(`    Chain ${peerChainId} references: ${reverseReference.tokenAddress}`)
            }
          }
        }
      } else {
        console.log(`❌ PEER NOT OFT: ${symbol} on chain ${chainId} references ${peerChainId}, but peer token is not marked as OFT`)
        oftInconsistencies++
      }
    })
  })

  console.log('\n' + '=' .repeat(80))
  console.log('🌊 CHECKING ACROSS INFO CONSISTENCY')
  console.log('=' .repeat(80))

  // Check Across consistency
  allTokens.forEach(token => {
    if (!token.isAcross || !token.extensions?.acrossInfo) return

    const { chainId, symbol, extensions } = token
    const acrossInfo = extensions.acrossInfo

    Object.entries(acrossInfo).forEach(([targetChainIdStr, targetChainInfo]) => {
      const targetChainId = parseInt(targetChainIdStr)

      // Skip self-references
      if (targetChainId === chainId) return

      // Find the corresponding token on the target chain
      const targetToken = findTokenOnChain(targetChainId, targetChainInfo.address)

      // Check reverse Across relationship
      if (targetToken?.isAcross && targetToken?.extensions?.acrossInfo) {
        const reverseAcrossInfo = targetToken.extensions.acrossInfo
        
        if (!reverseAcrossInfo[chainId.toString()]) {
          console.log(`❌ ASYMMETRIC ACROSS: ${symbol} chain ${chainId} -> ${targetChainId} (Across), but chain ${targetChainId} doesn't reference back to ${chainId}`)
          acrossInconsistencies++
        }
      } else {
        console.log(`❌ TARGET NOT ACROSS: ${symbol} on chain ${chainId} has Across info for ${targetChainId}, but target token is not marked as Across`)
        acrossInconsistencies++
      }
    })
  })

  // Summary report
  console.log('\n' + '=' .repeat(80))
  console.log('📊 CONSISTENCY REPORT')
  console.log('=' .repeat(80))
  console.log(`Total tokens processed: ${allTokens.length}`)
  console.log(`OFT tokens: ${allTokens.filter(t => t.isOFT).length}`)
  console.log(`Across tokens: ${allTokens.filter(t => t.isAcross).length}`)
  console.log(`Tokens with no liquidity: ${allTokens.filter(t => t.noLiquidityOnChain === true).length}`)
  console.log('')
  console.log('INCONSISTENCIES FOUND:')
  console.log(`❌ OFT asymmetric relationships: ${oftInconsistencies}`)
  console.log(`❌ Across asymmetric relationships: ${acrossInconsistencies}`)
  console.log('')
  
  const totalIssues = oftInconsistencies + acrossInconsistencies
  if (totalIssues === 0) {
    console.log('✅ ALL BRIDGE DATA IS CONSISTENT! 🎉')
  } else {
    console.log(`🚨 FOUND ${totalIssues} CRITICAL ISSUES THAT WILL CAUSE ROUTING PROBLEMS`)
  }

  // Chain-specific summary
  console.log('\n' + '=' .repeat(80))
  console.log('📍 CHAINS WITH POTENTIAL ISSUES')
  console.log('=' .repeat(80))
  
  const chainIssues = new Map()
  
  allTokens.forEach(token => {
    if (token.noLiquidityOnChain === true) {
      if (!chainIssues.has(token.chainId)) {
        chainIssues.set(token.chainId, { noLiquidity: 0, tokens: [] })
      }
      chainIssues.get(token.chainId).noLiquidity++
      chainIssues.get(token.chainId).tokens.push(token.symbol)
    }
  })
  
  if (chainIssues.size > 0) {
    chainIssues.forEach((issues, chainId) => {
      console.log(`Chain ${chainId}: ${issues.noLiquidity} tokens with no liquidity [${issues.tokens.join(', ')}]`)
    })
  } else {
    console.log('No chains with liquidity issues found.')
  }
}

const activeListWithIssues = tokensExtensionsAreInSameList('ActiveList', dataActiveList)
const inactiveListWithIssues = tokensExtensionsAreInSameList('InactiveList', dataInactiveList)

console.log('Active list issues:', activeListWithIssues)
console.log('Inactive list issues:', inactiveListWithIssues)
console.log('Total list issues:', activeListWithIssues + inactiveListWithIssues)

checkBridgeDataConsistency()
checkDuplicateSymbols()