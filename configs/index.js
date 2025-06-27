const {
  networkToEndpointId,
  chainAndStageToNetwork,
  EndpointVersion,
  Stage,
} = require('@layerzerolabs/lz-definitions')


// Coingecko and CoinMarketCap ID mappings for specific tokens
const OVERRIDE_CG_CMC_ID = {
  'frxUSD': { coingeckoId: 'frax-usd', coinMarketCapId: 36039 },
  'sfrxUSD': { coingeckoId: 'staked-frax-usd', coinMarketCapId: 36038 },
}

// Override OFT Metadata Pegged To Info
const OVERRIDE_PEG = {
  'USD₮0': { chainName: 'arbitrum', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
  'frxUSD': { chainName: 'ethereum', address: '0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29' },
  'sfrxUSD': { chainName: 'ethereum', address: '0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6' },
}

// Override logos for specific tokens
const OVERRIDE_LOGO = {
  'REUNI': 'https://s2.coinmarketcap.com/static/img/coins/128x128/23996.png',
  'sUSDa': 'https://s2.coinmarketcap.com/static/img/coins/128x128/35538.png',
  'UNB': 'https://s2.coinmarketcap.com/static/img/coins/128x128/7846.png',
  'BAI': 'https://s2.coinmarketcap.com/static/img/coins/128x128/28503.png',
  'USBD': 'https://s2.coinmarketcap.com/static/img/coins/128x128/36149.png',
  'IRL': 'https://s2.coinmarketcap.com/static/img/coins/128x128/20858.png',
  'LYM': 'https://s2.coinmarketcap.com/static/img/coins/128x128/2554.png',
  'FRAX': 'https://raw.githubusercontent.com/trustwallet/assets/refs/heads/master/blockchains/ethereum/assets/0x853d955aCEf822Db058eb8505911ED77F175b99e/logo.png',
}

// Supported chains List.
const SUPPORTED_CHAINS = [
  'ethereum',
  'arbitrum',
  'base',
  'bsc',
  'bera',
  'optimism',
  'metis',
  'avalanche',
  'sonic',
  'polygon',
  'swell',
  'fraxtal',
]

// Maps chainId to chainKey in ofts.json
const CHAIN_KEYS = {
  1: 'ethereum',
  42161: 'arbitrum',
  8453: 'base',
  56: 'bsc',
  80094: 'bera',
  10: 'optimism',
  1088: 'metis',
  43114: 'avalanche',
  146: 'sonic',
  137: 'polygon',
  1923: 'swell',
  252: 'fraxtal',
}

// Mapping of chainKey to chain ID
const CHAIN_KEY_TO_ID = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  bsc: 56,
  bera: 80094,
  optimism: 10,
  metis: 1088,
  avalanche: 43114,
  sonic: 146,
  polygon: 137,
  swell: 1923,
  fraxtal: 252,
}

// Convert chain name to endpoint ID
const CHAIN_KEY_TO_EID = {
  ethereum: {
    v1: networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V2),
  },
  arbitrum: {
    v1: networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V2),
  },
  base: {
    v1: networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V2),
  },
  bsc: {
    v1: networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V2),
  },
  bera: {
    v1: networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V2),
  },
  optimism: {
    v1: networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V2),
  },
  metis: {
    v1: networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V2),
  },
  avalanche: {
    v1: networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V2),
  },
  sonic: {
    v1: networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V2),
  },
  polygon: {
    v1: networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V2),
  },
  swell: {
    v1: networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V2),
  },
  fraxtal: {
    v1: networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V1),
    v2: networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V2),
  },
}

// Convert eid to version
const EID_TO_VERSION = {
  [networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V2)]: 2,
  [networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V1)]: 1,
  [networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V2)]: 2,
}

module.exports = {
  CHAIN_KEYS,
  CHAIN_KEY_TO_ID,
  CHAIN_KEY_TO_EID,
  EID_TO_VERSION,
  SUPPORTED_CHAINS,
  OVERRIDE_PEG,
  OVERRIDE_LOGO,
  OVERRIDE_CG_CMC_ID
}
