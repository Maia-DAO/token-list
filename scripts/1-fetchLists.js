require('dotenv').config()
const fs = require('fs').promises

/**
 * Fetch token data from a given URL and write it to an output file.
 *
 * @param {string} url - The URL to fetch token data from.
 * @param {string} name - The name used to create the output filename.
 * @param {function} conversionFunction - Optional conversion function to change list output format 
  
 }} name - The name used to create the output filename.
 */
async function fetchList(url, name, conversionFunction, conversionFunctionAdditionalParams) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Error fetching data from ${url}: ${response.statusText}`)
    }
    const tokens = await response.json()

    const tokensToOutput = conversionFunction ? conversionFunction(tokens, conversionFunctionAdditionalParams) : tokens

    await fs.writeFile(`output/${name}.json`, JSON.stringify(tokensToOutput, null, 2))
    console.log(`✅ Tokens data saved to output/${name}.json`)
  } catch (error) {
    console.error(`❌ Error fetching ${name} list:`, error)
  }
}

function convertOpenoceanList(list, chainId) {
  return {
    tokens: list?.data?.map((item) => ({
      ...item,
      logoURI: item.icon,
      chainId,
      extensions: {}
    }))
  }
}

function pruneAttributes(list) {
  return {
    tokens: list?.tokens?.map((item) => {
      const { chainId, address, name, symbol, decimals, logoURI } = item
      return ({
        chainId, address, name, symbol, decimals, logoURI
      })
    })
  }
}


/**
 * Main function to fetch token lists and write across mapping.
 */
(async () => {
  // Active Lists
  await fetchList('https://stargate.finance/api/tokens', 'stargate')
  await fetchList(process.env.STARGATE_API, 'ofts')
  await fetchList('https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/default-tokenlist.json', 'ulysses')
  await fetchList('https://tokens.uniswap.org', 'uniswap')

  // Inactive Lists
  await fetchList('https://extendedtokens.uniswap.org', 'uni_extended')
  await fetchList(
    'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
    'compound'
  )
  await fetchList('https://raw.githubusercontent.com/SetProtocol/uniswap-tokenlist/main/set.tokenlist.json', 'set')
  await fetchList(
    'https://raw.githubusercontent.com/The-Blockchain-Association/sec-notice-list/master/ba-sec-list.json',
    'ba'
  )

  // Fetch List for each chain that supports swapping via Hermes
  await fetchList('https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/arbitrum-one.json', 'TOKEN_LIST_ARBITRUM_ONE', pruneAttributes),
    await fetchList('https://static.optimism.io/optimism.tokenlist.json', 'TOKEN_LIST_SUPERCHAIN', pruneAttributes),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_BLAST'),
    await fetchList('https://raw.githubusercontent.com/InkySwap/swap-token-list/refs/heads/main/inkyswap-mainnet.tokenlist.json', 'TOKEN_LIST_INK', pruneAttributes),
    await fetchList('https://raw.githubusercontent.com/Consensys/linea-token-list/refs/heads/main/json/linea-mainnet-token-shortlist.json', 'TOKEN_LIST_LINEA', pruneAttributes),
    await fetchList('https://raw.githubusercontent.com/balancer/tokenlists/refs/heads/main/generated/balancer.tokenlist.json', 'TOKEN_LIST_BALANCER', pruneAttributes),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_MODE'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_POLYGON'),
    await fetchList('https://raw.githubusercontent.com/scroll-tech/token-list/refs/heads/main/scroll.tokenlist.json', 'TOKEN_LIST_SCROLL', pruneAttributes),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_SONEIUM'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_UNICHAIN'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_WORLDCHAIN'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_ZORA'),
    await fetchList('https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src/tokens/mainnet.json', 'TOKEN_LIST_BERA', pruneAttributes),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_SWELL'),
    await fetchList('https://open-api.openocean.finance/v3/rootstock/tokenList', 'TOKEN_LIST_ROOTSTOCK', convertOpenoceanList, 30),
    await fetchList('https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/apechain.json', 'TOKEN_LIST_APE', pruneAttributes),
    await fetchList('https://raw.githubusercontent.com/celo-org/celo-token-list/refs/heads/main/celo.tokenlist.json', 'TOKEN_LIST_CELO', pruneAttributes),
    await fetchList('https://open-api.openocean.finance/v3/celo/tokenList', 'TOKEN_LIST_CELO_2', convertOpenoceanList, 42220),
    await fetchList('https://open-api.openocean.finance/v3/sei/tokenList', 'TOKEN_LIST_SEI', convertOpenoceanList, 1329),
    await fetchList('https://open-api.openocean.finance/v3/hyperevm/tokenList', 'TOKEN_LIST_HYPERLIQUID', convertOpenoceanList, 999),
    await fetchList('https://open-api.openocean.finance/v3/opbnb/tokenList', 'TOKEN_LIST_OPBNB', convertOpenoceanList, 204),
    await fetchList('https://raw.githubusercontent.com/Manta-Network/manta-pacific-token-list/refs/heads/main/json/manta-pacific-mainnet-token-list.json', 'TOKEN_LIST_MANTA', pruneAttributes),
    await fetchList('https://open-api.openocean.finance/v3/manta/tokenList', 'TOKEN_LIST_MANTA_2', convertOpenoceanList, 169),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_GRAVITY'),
    await fetchList('https://open-api.openocean.finance/v3/flare/tokenList', 'TOKEN_LIST_FLARE', convertOpenoceanList, 14),
    await fetchList('https://raw.githubusercontent.com/mantlenetworkio/mantle-token-lists/refs/heads/main/mantle.tokenlist.json', 'TOKEN_LIST_MANTLE', pruneAttributes),
    await fetchList('https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/plume.json', 'TOKEN_LIST_PLUMEPHOENIX', pruneAttributes),
    await fetchList('https://open-api.openocean.finance/v3/metis/tokenList', 'TOKEN_LIST_METIS', convertOpenoceanList, 1088)
})()
