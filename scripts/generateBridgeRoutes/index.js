const fs = require('fs')
const { ZERO_ADDRESS, SupportedChainId } = require('maia-core-sdk')
const path = require('path')

const { CHAIN_KEYS, CHAIN_KEY_TO_UI_NAME } = require('../../configs')
const { enumKey } = require('../../helpers')

// function generateBridgeRoutes() {
//   try {
//     // Read token lists
//     const tokenList = JSON.parse(fs.readFileSync('./token-list.json', 'utf8'))
//     const inactiveTokenList = JSON.parse(fs.readFileSync('./inactive-token-list.json', 'utf8'))

//     // Combine all tokens from both lists
//     const allTokens = [
//       ...(tokenList.tokens || []),
//       ...(tokenList.rootTokens || []),
//       ...(inactiveTokenList.tokens || []),
//     ]

//     console.log(`Processing ${allTokens.length} tokens...`)

//     // Create BRIDGE_ROUTES mapping
//     const bridgeRoutes = {}

//     // Helper function to ensure chain exists and add bidirectional route
//     const addBidirectionalRoute = (fromChain, toChain, tokenSymbol, bridgeType) => {
//       // Initialize chain entries if they don't exist
//       if (!bridgeRoutes[fromChain]) {
//         bridgeRoutes[fromChain] = new Set()
//       }
//       if (!bridgeRoutes[toChain]) {
//         bridgeRoutes[toChain] = new Set()
//       }

//       // Add both directions
//       bridgeRoutes[fromChain].add(toChain)
//       bridgeRoutes[toChain].add(fromChain)

//       console.log(`${bridgeType}: ${fromChain} <-> ${toChain} via ${tokenSymbol}`)
//     }

//     // Helper function to add unidirectional route
//     const addUnidirectionalRoute = (fromChain, toChain, tokenSymbol, bridgeType) => {
//       if (!bridgeRoutes[fromChain]) {
//         bridgeRoutes[fromChain] = new Set()
//       }
      
//       bridgeRoutes[fromChain].add(toChain)
//       console.log(`${bridgeType}: ${fromChain} -> ${toChain} via ${tokenSymbol}`)
//     }

//     // Process each token
//     allTokens.forEach((token) => {
//       const { chainId, extensions, isOFT, isAcross, noLiquidityOnChain } = token

//       // Skip tokens that have no liquidity on chain (can't be used as intermediary)
//       if (noLiquidityOnChain === true) {
//         console.log(`Skipping token ${token.symbol} on chain ${chainId} - no liquidity`)
//         return
//       }

//       // Process OFT tokens
//       if (isOFT && extensions?.oftInfo?.peersInfo) {
//         const peersInfo = extensions.oftInfo.peersInfo
//         Object.keys(peersInfo).forEach((peerChainId) => {
//           const targetChainId = parseInt(peerChainId)
//           if (targetChainId !== chainId) {
//             // Check if this is a native OFT (zero address)
//             const isNativeOFT = peersInfo[peerChainId].tokenAddress === ZERO_ADDRESS
            
//             if (isNativeOFT) {
//               // Native OFTs are bidirectional
//               addBidirectionalRoute(chainId, targetChainId, token.symbol, 'OFT-Native')
//             } else {
//               // Regular OFTs are also bidirectional - OFT bridges work both ways
//               addBidirectionalRoute(chainId, targetChainId, token.symbol, 'OFT')
//             }
//           }
//         })
//       }

//       // Process Across tokens - these should be bidirectional
//       if (isAcross && extensions?.acrossInfo) {
//         const acrossInfo = extensions.acrossInfo
//         Object.keys(acrossInfo).forEach((targetChainIdStr) => {
//           const targetChainId = parseInt(targetChainIdStr)
//           if (targetChainId !== chainId) {
//             // Across bridges are typically bidirectional
//             addBidirectionalRoute(chainId, targetChainId, token.symbol, 'Across')
//           }
//         })
//       }
//     })

//     // Convert Sets to Arrays and sort for consistent output
//     const finalBridgeRoutes = {}
//     Object.keys(bridgeRoutes).forEach((chainId) => {
//       const sortedChains = Array.from(bridgeRoutes[chainId]).sort((a, b) => a - b)
//       finalBridgeRoutes[parseInt(chainId)] = sortedChains
//     })

//     // Generate TypeScript interface and mapping
//     const tsOutput = generateTypeScriptOutput(finalBridgeRoutes)

//     // Write to file
//     fs.writeFileSync('./scripts/generateBridgeRoutes/bridge-routes.ts', tsOutput)
//     console.log('\n✅ Generated bridge-routes.ts successfully!')

//     // Print summary
//     console.log('\n📊 Summary:')
//     Object.keys(finalBridgeRoutes).forEach((chainId) => {
//       const reachableChains = finalBridgeRoutes[chainId]
//       console.log(`Chain ${chainId}: Can reach ${reachableChains.length} chains -> [${reachableChains.join(', ')}]`)
//     })

//     // Additional debugging: Show chains with no outgoing connections
//     const chainsWithNoOutgoing = Object.keys(finalBridgeRoutes).filter(chainId => 
//       finalBridgeRoutes[chainId].length === 0
//     )
    
//     if (chainsWithNoOutgoing.length > 0) {
//       console.log('\n⚠️  Chains with no outgoing connections:')
//       chainsWithNoOutgoing.forEach(chainId => {
//         console.log(`Chain ${chainId}: 0 outgoing connections`)
//       })
//     }

//     return finalBridgeRoutes
//   } catch (error) {
//     console.error('Error generating bridge routes:', error.message)
//     process.exit(1)
//   }
// }

/**
 * Generates BRIDGE_ROUTES mapping from token lists
 * This mapping shows all chains reachable from each chain via OFT and Across tokens
 */
function generateBridgeRoutes() {
  try {
    // Read token lists
    const tokenList = JSON.parse(fs.readFileSync('./token-list.json', 'utf8'))
    const inactiveTokenList = JSON.parse(fs.readFileSync('./inactive-token-list.json', 'utf8'))

    // Combine all tokens from both lists
    const allTokens = [
      ...(tokenList.tokens || []),
      ...(tokenList.rootTokens || []),
      ...(inactiveTokenList.tokens || []),
    ]

    console.log(`Processing ${allTokens.length} tokens...`)

    // Create BRIDGE_ROUTES mapping
    const bridgeRoutes = {}

    // Process each token
    allTokens.forEach((token) => {
      const { chainId, extensions, isOFT, isAcross, noLiquidityOnChain } = token

      // Skip tokens that have no liquidity on chain (can't be used as intermediary)
      if (noLiquidityOnChain === true) {
        console.log(`Skipping token ${token.symbol} on chain ${chainId} - no liquidity`)
        return
      }

      // Initialize chain entry if it doesn't exist
      if (!bridgeRoutes[chainId]) {
        bridgeRoutes[chainId] = new Set()
      }

      // Process OFT tokens
      if (isOFT && extensions?.oftInfo?.peersInfo) {
        const peersInfo = extensions.oftInfo.peersInfo
        Object.keys(peersInfo).forEach((peerChainId) => {
          const targetChainId = parseInt(peerChainId)
          if (targetChainId !== chainId) {
            bridgeRoutes[chainId].add(targetChainId)

            // Native OFTs need to ve reverse linked and always have liquidity on their origin chain
            if (peersInfo[peerChainId].tokenAddress === ZERO_ADDRESS) {
              // Initialize targetChainId entry if it doesn't exist
              if (!bridgeRoutes[targetChainId]) {
                bridgeRoutes[targetChainId] = new Set()
              }

              bridgeRoutes[targetChainId].add(chainId)
            }

            console.log(`OFT: ${chainId} -> ${targetChainId} via ${token.symbol}`)
          }
        })
      }

      // Process Across tokens
      if (isAcross && extensions?.acrossInfo) {
        const acrossInfo = extensions.acrossInfo
        Object.keys(acrossInfo).forEach((targetChainIdStr) => {
          const targetChainId = parseInt(targetChainIdStr)
          if (targetChainId !== chainId) {
            bridgeRoutes[chainId].add(targetChainId)
            console.log(`Across: ${chainId} -> ${targetChainId} via ${token.symbol}`)
          }
        })
      }
    })

    // Convert Sets to Arrays and sort for consistent output
    const finalBridgeRoutes = {}
    Object.keys(bridgeRoutes).forEach((chainId) => {
      const sortedChains = Array.from(bridgeRoutes[chainId]).sort((a, b) => a - b)
      finalBridgeRoutes[parseInt(chainId)] = sortedChains
    })

    // Generate TypeScript interface and mapping
    const tsOutput = generateTypeScriptOutput(finalBridgeRoutes)

    // Write to file
    fs.writeFileSync('./scripts/generateBridgeRoutes/bridge-routes.ts', tsOutput)
    console.log('\n✅ Generated bridge-routes.ts successfully!')

    // Print summary
    console.log('\n📊 Summary:')
    Object.keys(finalBridgeRoutes).forEach((chainId) => {
      const reachableChains = finalBridgeRoutes[chainId]
      console.log(`Chain ${chainId}: Can reach ${reachableChains.length} chains -> [${reachableChains.join(', ')}]`)
    })

    return finalBridgeRoutes
  } catch (error) {
    console.error('Error generating bridge routes:', error.message)
    process.exit(1)
  }
}

function chainIdToUIType(chainId) {
  const key = CHAIN_KEYS[chainId]
  const name = CHAIN_KEY_TO_UI_NAME[key]

  if (!key || !name) {
    console.warn('CHAIN NOT FOUND', chainId, key, name)
    return 'UNRECOGNIZED CHAIN'
  }

  const identifier = enumKey(name)

  if (SupportedChainId[chainId]) return `SupportedChainId.${identifier}`

  return `ExtendedSupportedChainId.${identifier}`
}

/**
 * Generates TypeScript output with proper types and formatting
 */
function generateTypeScriptOutput(bridgeRoutes) {
  // Filter out unrecognized chains before generating output
  const recognizedBridgeRoutes = {}

  Object.keys(bridgeRoutes).forEach((chainIdStr) => {
    const chainId = Number(chainIdStr)
    const uiType = chainIdToUIType(chainId)

    if (uiType === 'UNRECOGNIZED CHAIN') {
      console.log(`⚠️  Skipping unrecognized chain: ${chainId}`)
      return
    }

    // Filter destination chains as well
    const recognizedDestinations = bridgeRoutes[chainId].filter((destChainId) => {
      const destUIType = chainIdToUIType(destChainId)
      if (destUIType === 'UNRECOGNIZED CHAIN') {
        console.log(`⚠️  Skipping unrecognized destination chain: ${destChainId} from source: ${chainId}`)
        return false
      }
      return true
    })

    if (recognizedDestinations.length > 0) {
      recognizedBridgeRoutes[chainId] = recognizedDestinations
    }
  })

  const chains = Object.keys(recognizedBridgeRoutes)
    .map(Number)
    .sort((a, b) => a - b)

  return `// Auto-generated bridge routes mapping
// This file maps each chain ID to all chains reachable via OFT and Across tokens
// Generated on: ${new Date().toISOString()}

import { ExtendedSupportedChainId, UISupportedChainId } from 'constants/chainInfo'
import { SupportedChainId } from 'maia-core-sdk'

export interface BridgeRoutesMapping {
  [chainId: number]: UISupportedChainId[];
}

/**
 * BRIDGE_ROUTES mapping showing all chains reachable from each chain
 * via OFT (Omnichain Fungible Tokens) and Across protocol tokens
 * 
 * Key: Source chain ID (UISupportedChainId)
 * Value: Array of reachable destination chain IDs (as UISupportedChainId[])
 * 
 * Note: Only includes tokens with liquidity (noLiquidityOnChain !== true)
 */

export const BRIDGE_ROUTES: BridgeRoutesMapping = {
${chains
  .map((chainId) => {
    const routes = recognizedBridgeRoutes[chainId]
    const sourceUIType = chainIdToUIType(chainId)
    const routesStr =
      routes.length > 0 ? `[${routes.map((destChainId) => chainIdToUIType(destChainId)).join(', ')}]` : '[]'
    return `  [${sourceUIType}]: ${routesStr}`
  })
  .join(',\n')}
} as const;

/**
 * Helper function to get all chains reachable from a given chain ID
 * @param fromChainId - The source chain ID
 * @returns Array of reachable chain IDs
 */
export function getReachableChains(fromChainId: UISupportedChainId): UISupportedChainId[] {
  return BRIDGE_ROUTES[fromChainId] || [];
}

/**
 * Helper function to check if two chains are connected via bridge
 * @param fromChainId - The source chain ID
 * @param toChainId - The destination chain ID
 * @returns Boolean indicating if the chains are connected
 */
export function canBridge(fromChainId: UISupportedChainId, toChainId: UISupportedChainId): boolean {
  const reachableChains = BRIDGE_ROUTES[fromChainId] || [];
  return reachableChains.includes(toChainId);
}

/**
 * Helper function to get all unique chain IDs that have bridge routes
 * @returns Array of all chain IDs with bridge capabilities
 */
export function getAllBridgeChains(): UISupportedChainId[] {
  return Object.keys(BRIDGE_ROUTES)
    .map(Number)
    .filter((id): id is UISupportedChainId => !isNaN(id));
}
`
}

// Run the script
if (require.main === module) {
  console.log('🚀 Starting bridge routes generation...\n')
  generateBridgeRoutes()
}

module.exports = { generateBridgeRoutes }
