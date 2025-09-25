const fs = require('fs').promises
const { SupportedChainId } = require('maia-core-sdk')
const { TOKEN_SYMBOLS_MAP, TOKEN_EQUIVALENCE_REMAPPING } = require('@across-protocol/constants')
const { EXTENDED_SUPPORTED_CHAIN_IDS } = require('../configs')

const ACROSS_API_ENDPOINT = 'https://across.to/api'

async function fetchOriginRoutes(address) {
  const url = `${ACROSS_API_ENDPOINT}/available-routes?originChainId=1&originToken=${address}`
  const response = await fetch(url)
  return await response.json()
}

async function fetchDestRoutes(address) {
  const url = `${ACROSS_API_ENDPOINT}/available-routes?destinationChainId=1&destinationToken=${address}`
  const response = await fetch(url)
  return await response.json()
}

async function fetchRoutes(address) {
  if (!address) return []

  const [originRoutes, destRoutes] = await Promise.all([fetchOriginRoutes(address), fetchDestRoutes(address)])

  return [...originRoutes, ...destRoutes]
}

function mergeRemappings() {
  const tokensMap = Object.entries(TOKEN_SYMBOLS_MAP).reduce((memo, [symbol, tokens]) => {
    memo[symbol] = {
      ...tokens,
      addresses: {
        ...Object.entries(tokens.addresses).reduce((memo, [chain, address]) => {
          if (
            Number(chain) === SupportedChainId.MAINNET &&
            tokens.l1TokenDecimals &&
            tokens.l1TokenDecimals !== tokens.decimals
          ) {
            memo[chain] = { address, decimals: tokens.l1TokenDecimals }
          } else {
            memo[chain] = { address }
          }
          return memo
        }, {}),
      },
    }

    return memo
  }, {})

  const remappings = Object.keys(TOKEN_EQUIVALENCE_REMAPPING)
  return remappings.reduce((memo, symbolToAdd) => {
    const tokensToAdd = memo[symbolToAdd]
    const mainSymbol = TOKEN_EQUIVALENCE_REMAPPING[symbolToAdd]
    if (tokensToAdd) {
      const tokensMain = memo[mainSymbol]
      const sameDecimals = tokensToAdd.decimals === tokensMain.decimals

      const addressesToAdd = sameDecimals
        ? tokensToAdd.addresses
        : Object.entries(tokensToAdd.addresses).reduce((memo, [chain, { address }]) => {
            memo[chain] = { address, decimals: tokensToAdd.decimals }
            return memo
          }, {})

      memo[mainSymbol].addresses = {
        ...addressesToAdd,
        ...tokensMain.addresses,
      }
    }

    return memo
  }, tokensMap)
}

const TOKENS_MAP = mergeRemappings()

const TESTNET_CHAIN_IDS = [
  SupportedChainId.SEPOLIA,
  SupportedChainId.ARBITRUM_SEPOLIA,
  SupportedChainId.OPTIMISM_SEPOLIA,
  SupportedChainId.BASE_SEPOLIA,
  SupportedChainId.POLYGON_AMOY,
]

// Convert SupportedChainId to an array of numbers.
const SUPPORTED_CHAINS = [...Object.values(SupportedChainId), ...EXTENDED_SUPPORTED_CHAIN_IDS]
  .map(Number)
  .filter((value) => !TESTNET_CHAIN_IDS.includes(value))

function tokenHasRoutes(routes, chainId, address) {
  return routes.some(
    ({ originChainId, originToken, destinationChainId, destinationToken }) =>
      (chainId === originChainId && address === originToken) ||
      (chainId === destinationChainId && address === destinationToken)
  )
}

async function filterMap(allAddresses, modifyValueFn) {
  const routes = await fetchRoutes(allAddresses['1']?.address)

  if (!routes || routes.length === 0) {
    return []
  }

  return Object.entries(allAddresses).reduce((memo, [chain, value]) => {
    const chainId = Number(chain)
    if (SUPPORTED_CHAINS.includes(chainId) && tokenHasRoutes(routes, chainId, value.address)) {
      memo[chainId] = modifyValueFn ? modifyValueFn(value) : value
    }
    return memo
  }, {})
}

async function equivalentAddresses(tokens) {
  const equivalent = TOKENS_MAP[TOKEN_EQUIVALENCE_REMAPPING[tokens.symbol]]

  if (!equivalent) return {}

  const differentDecimals = tokens.decimals !== equivalent.decimals

  const createAddressEntryWithDecimals = differentDecimals
    ? ({ address }) => {
        return { address, decimals: equivalent.decimals }
      }
    : undefined

  return await filterMap(equivalent.addresses, createAddressEntryWithDecimals)
}

async function filterAcrossTokens() {
  try {
    // Create an output object with filtered addresses per token.
    const filteredAcross = {}

    // Iterate over each token in across.json.
    for (const symbol in TOKENS_MAP) {
      const token = TOKENS_MAP[symbol]

      // Filter the addresses: only keep keys that are in the supportedChains array.
      const filteredAddresses = await filterMap(token.addresses)

      // Only include token if it has at least one supported address.
      if (Object.keys(filteredAddresses).length > 1) {
        const addresses = {
          ...(await equivalentAddresses(token)),
          ...filteredAddresses,
        }

        filteredAcross[symbol] = {
          ...token,
          addresses,
        }
      }
    }

    // Write the filtered tokens to filteredAcrossTokens.json.
    await fs.writeFile('output/filteredAcrossTokens.json', JSON.stringify(filteredAcross, null, 2))
    console.log('✅ Filtered across tokens saved to output/filteredAcrossTokens.json')
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

filterAcrossTokens()
