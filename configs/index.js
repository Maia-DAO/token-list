const {
  networkToEndpointId,
  chainAndStageToNetwork,
  EndpointVersion,
  Stage,
} = require('@layerzerolabs/lz-definitions')


// Tokens to drop
const BLOCKED_TOKEN_SYMBOLS = [
  'STG',
]

// Partner token symbols that should be included in the primary token list
const PARTNER_TOKEN_SYMBOLS = [
  'FRAX',
  'frxUSD',
  'sfrxUSD',
  'frxETH',
  'sfrxETH',
  'WFRAX',
  'FXS',
  'FPI',
  'EUL',
  'ORDER',
  'XDC',
  'WXDC',
  'DMT',
  'WDMT',
  'RBTC',
  'WRBTC',
  'FLOW',
  'WFLOW',
  'NIBI',
  'WNIBI',
  'SEI',
  'WSEI',
  'TAC',
  'WTAC',
  'METIS',
  'MATIC',
  'APE',
  'WAPE',
  'rswETH',
  'WAGMI',
  'Anon',
  'RDNT',
  'MAV',
  'ZRO',
  'WETH',
  'wstETH',
  'ETH',
  'WBTC',
  'BTC',
  'OP',
  'USDC',
  'USDT',
  'USD₮',
  'USD₮0',
  'DAI',
  'xDai',
  'wxDai',
  'WXDAI',
  'PEAQ',
  'WPEAQ',
  'USDe',
  'mETH',
  'Manta mETH',
  'mBTC',
  'Manta mBTC',
  'stBTC',
  'MODE',
  'pxETH',
  'aMAIA',
  'aHERMES',
  'ARA',
  'ARA',
  'WuL1s-USDT',
  'WuL1s-USDC',
  'WuOPs-ETH',
  'WuOPs-USDC',
  'WCORE',
  'HYPE',
  'WHYPE',
  'BNB',
  'WBNB',
  'G',
  'WG',
  'PLUME',
  'WPLUME',
  'FLR',
  'WFLR',
  'MNT',
  'OOE',
  'EURA',
  'agEUR'
]

const CORE_TOKEN_SYMBOLS = [
  'HERMES',
  'bHERMES',
  'bHERMES-G',
  'bHERMES-B',
  'bHERMES-V',
  'MAIA',
  'vMaia',
  'vMAIA-V',
  'ARA',
  'aMAIA',
  'aHERMES',
  'WuOPs-USDC',
  'WuOPs-ETH',
  'WuL1s-USDC',
  'WuL1s-USDT',
  'uOPs-USDC',
  'uOPs-ETH',
  'uL1s-USDC',
  'uL1s-USDT',
  'AUSD'
]

const NATIVE_OFT_ADAPTERS = {
  [33139]: { ['0xe4103e80c967f58591a1d7ca443ed7e392fed862']: '0x0000000000000000000000000000000000000000' }, // APE has native OFT 
  [50]: { ['0x147bffe7074a1b70080e6698542d0d41500a87c3']: '0x0000000000000000000000000000000000000000' }, // XDC has native OFT 
  [30]: { ['0x5ca9fa3e15f0d6841a64e83722898b9a80df7a1e']: '0x0000000000000000000000000000000000000000' }, // RSK has native OFT 
  [1996]: { ['0x7393ae4835fdfed4f25e46a10d6bdb2fd49a2706']: '0x0000000000000000000000000000000000000000' }, // SANKO has native OFT 
  [747]: { ['0xd296588850bee2770136464ffdddd78c32f2a07c']: '0x0000000000000000000000000000000000000000' }, // FLOW has native OFT 
  [1329]: { ['0xbdf43ecadc5cef51b7d1772f722e40596bc1788b']: '0x0000000000000000000000000000000000000000' }, // SEI has native OFT 
}

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
  'STG': { chainName: 'ethereum', address: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6' },
  'ZRO': { chainName: 'ethereum', address: '0x6985884C4392D348587B19cb9eAAf157F13271cd' },
  'ApeCoin': { chainName: 'ape', address: '0x0000000000000000000000000000000000000000' },
}

// Override logos for specific tokens
const OVERRIDE_LOGO = {
  'AUKI': 'https://assets.coingecko.com/coins/images/39811/standard/COINGECKO-200-x-200_%281%29.png?1724166209',
  'agEUR': 'https://assets.coingecko.com/coins/images/19479/large/agEUR-4.png?1710726218',
  'EURA': 'https://assets.coingecko.com/coins/images/19479/large/agEUR-4.png?1710726218',
  'pxETH': 'https://raw.githubusercontent.com/balancer/tokenlists/main/src/assets/images/tokens/0x04c154b66cb340f3ae24111cc767e0184ed00cc6.png',
  'stBTC': 'https://raw.githubusercontent.com/trustwallet/assets/refs/heads/master/blockchains/ethereum/assets/0xf6718b2701D4a6498eF77D7c152b2137Ab28b8A3/logo.png',
  'WBTC': 'https://s2.coinmarketcap.com/static/img/coins/128x128/3717.png',
  'RBTC': 'https://s2.coinmarketcap.com/static/img/coins/128x128/3626.png',
  'REUNI': 'https://s2.coinmarketcap.com/static/img/coins/128x128/23996.png',
  'sUSDa': 'https://s2.coinmarketcap.com/static/img/coins/128x128/35538.png',
  'UNB': 'https://s2.coinmarketcap.com/static/img/coins/128x128/7846.png',
  'BAI': 'https://s2.coinmarketcap.com/static/img/coins/128x128/28503.png',
  'USBD': 'https://s2.coinmarketcap.com/static/img/coins/128x128/36149.png',
  'IRL': 'https://s2.coinmarketcap.com/static/img/coins/128x128/20858.png',
  'LYM': 'https://s2.coinmarketcap.com/static/img/coins/128x128/2554.png',
  'FRAX': 'https://raw.githubusercontent.com/trustwallet/assets/refs/heads/master/blockchains/ethereum/assets/0x853d955aCEf822Db058eb8505911ED77F175b99e/logo.png',
  'SPELL': 'https://assets.coingecko.com/coins/images/15861/thumb/abracadabra-3.png?1622544862',
  'WNIBI': 'https://images-ext-1.discordapp.net/external/tM3n2iub1SLOqiey4mkfnl4Lfe4LR6ijT-Ixv7juEu8/https/silverswap.io/tokens/nibiru/WNIBI.png?format=webp&quality=lossless&width=450&height=450',
}

// Wrapped Native Token Address Per Chain
// @dev copied from hermes UI frontend wrappedNative.ts 
const WRAPPED_NATIVES = {
  [1]:
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  [42161]:
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  [8453]:
    '0x4200000000000000000000000000000000000006',
  [56]:
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  [80094]:
    '0x6969696969696969696969696969696969696969',
  [10]:
  '0x4200000000000000000000000000000000000006',
  [1088]:
    '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000',
  [43114]:
    '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  [146]:
    '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
  [137]:
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  [1923]:
    '0x4200000000000000000000000000000000000006',
  [252]:
    '0xFc00000000000000000000000000000000000002',
  [30]:
    '0x542fDA317318eBF1d3DEAf76E0b632741A7e677d',
  [60808]:
    '0x4200000000000000000000000000000000000006',
  [747]:
    '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e',
  [200901]:
    '0x0E4cF4Affdb72b39Ea91fA726D291781cBd020bF',
  [57073]:
    '0x4200000000000000000000000000000000000006',
  [1116]:
    '0x40375C92d9FAf44d2f9db9Bd9ba41a3317a2404f',
  [1996]:
    '0x754cDAd6f5821077d6915004Be2cE05f93d176f8',
  [534352]:
    '0x5300000000000000000000000000000000000004',
  [33139]:
    '0x48b62137EdfA95a428D35C09E44256a739F6B557',
  [42220]:
    '0x471EcE3750Da237f93B8E339c536989b8978a438',
  [239]:
    '0xB63B9f0eb4A6E6f191529D71d4D88cc8900Df2C9',
  [1329]:
    '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7',
  [50]:
    '0x951857744785E80e2De051c32EE7b25f9c458C42',
  [480]:
    '0x4200000000000000000000000000000000000006',
  [747474]:
    '0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62',
  [130]:
    '0x4200000000000000000000000000000000000006',
  [999]:
    '0x5555555555555555555555555555555555555555',
  [291]:
    '0x4200000000000000000000000000000000000006',
  [7777777]:
    '0x4200000000000000000000000000000000000006',
  [3338]:
    '0x0000000000000000000000000000000000000809',
  [204]:
    '0x4200000000000000000000000000000000000006',
  [55244]:
    '0x1fB719f10b56d7a85DCD32f27f897375fB21cfdd',
  [169]:
    '0x0Dc808adcE2099A9F62AA87D9670745AbA741746',
  [1625]:
    '0xBB859E225ac8Fb6BE1C7e38D87b767e95Fef0EbD',
  [2345]:
    '0xbC10000000000000000000000000000000000000',
  [100]:
    '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
  [2818]:
    '0x5300000000000000000000000000000000000011',
  [59144]:
    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
  [1868]:
    '0x4200000000000000000000000000000000000006',
  [6900]:
    '0x0CaCF669f8446BeCA826913a3c6B96aCD4b02a97',
  [167000]:
    '0xA51894664A773981C6C112C43ce576f315d5b1B6',
  [98866]:
    '0xEa237441c92CAe6FC17Caaf9a7acB3f953be4bd1',
  [14]:
    '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  [34443]:
    '0x4200000000000000000000000000000000000006',
  [81457]:
    '0x4300000000000000000000000000000000000004',
  [5000]:
    '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000',
}

// List of chainIds without DEX Aggregation support in Hermes UI
// @dev copied from hermes UI frontend bridging.ts
const CHAINS_WITH_NO_SWAPPING = [
  252,
  200901,
  60808,
  1116,
  2345,
  57073,
  747474,
  2818,
  6900,
  291,
  3338,
  1868,
  239,
  167000,
  480,
  7777777,
]

// Extended supported chain IDs 
// @dev copied from hermes UI frontend chainInfo.ts 
const EXTENDED_SUPPORTED_CHAIN_IDS = [
  // 196,
  30,
  60808,
  // 957,
  747,
  200901,
  // 7700,
  57073,
  1116,
  1996,
  // 1729,
  534352,
  33139,
  42220,
  239,
  1329,
  // 295,
  // 4200,
  50,
  480,
  747474,
  // 42170,
  // 1890,
  // 1313161554,
  // 43111,
  // 388,
  // 8822,
  130,
  999,
  291,
  7777777,
  3338,
  204,
  // 111188,
  55244,
  169,
  1625,
  2345,
  100,
  2818,
  59144,
  // 122,
  1868,
  // 1030,
  6900,
  // 25,
  // 42793,
  // 232,
  // 1514,
  167000,
  // 50104,
  98866,
  // 1135,
  // 6001,
  // 41923,
  14,
  // 1380012617,
  34443,
  81457,
  // 11501,
  5000,
]

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
  // Extended chain IDs
  // @dev copied from hermes UI frontend chains.ts
  // 'xlayer',
  'rootstock',
  'bob',
  // 'lyra',
  'flow',
  'bitlayer',
  // 'canto',
  'ink',
  'coredao',
  'sanko',
  // 'reya',
  'scroll',
  'ape',
  'celo',
  'tac',
  'sei',
  // 'hedera',
  // 'merlin',
  'xdc',
  'worldchain',
  'katana',
  // 'nova',
  // 'lightlink',
  // 'aurora',
  // 'hemi',
  // 'cronoszkevm',
  // 'iota',
  'unichain',
  'hyperliquid',
  'orderly',
  'zora',
  'peaq',
  'opbnb',
  // 'real',
  'superposition',
  'manta',
  'gravity',
  'goat',
  'gnosis',
  'morph',
  'linea',
  // 'fuse',
  'soneium',
  // 'conflux',
  'nibiru',
  // 'cronosevm',
  // 'etherlink',
  // 'lens',
  // 'story',
  'taiko',
  // 'sophon',
  'plumephoenix',
  // 'lisk',
  // 'bouncebit',
  // 'edu',
  'flare',
  // 'rarible',
  'mode',
  'blast',
  // 'bevm',
  'mantle',
]

// Maps chainId to chainKey in ofts.json
const CHAIN_KEYS = {
  // Supported chain IDs
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
  // Extended chain IDs
  // @dev copied from hermes UI frontend chains.ts
  // 196: 'xlayer',
  30: 'rootstock',
  60808: 'bob',
  // 957: 'lyra',
  747: 'flow',
  200901: 'bitlayer',
  // 7700: 'canto',
  57073: 'ink',
  1116: 'coredao',
  1996: 'sanko',
  // 1729: 'reya',
  534352: 'scroll',
  33139: 'ape',
  42220: 'celo',
  239: 'tac',
  1329: 'sei',
  // 295: 'hedera',
  // 4200: 'merlin',
  50: 'xdc',
  480: 'worldchain',
  747474: 'katana',
  // 42170: 'nova',
  // 1890: 'lightlink',
  // 1313161554: 'aurora',
  // 43111: 'hemi',
  // 388: 'cronoszkevm',
  // 8822: 'iota',
  130: 'unichain',
  999: 'hyperliquid',
  291: 'orderly',
  7777777: 'zora',
  3338: 'peaq',
  204: 'opbnb',
  // 111188: 'real',
  55244: 'superposition',
  169: 'manta',
  1625: 'gravity',
  2345: 'goat',
  100: 'gnosis',
  2818: 'goat',
  2818: 'morph',
  59144: 'linea',
  // 122: 'fuse',
  1868: 'soneium',
  // 1030: 'conflux',
  6900: 'nibiru',
  // 25: 'cronosevm',
  // 42793: 'etherlink',
  // 232: 'lens',
  // 1514: 'story',
  167000: 'taiko',
  // 50104: 'sophon',
  98866: 'plumephoenix',
  // 1135: 'lisk',
  // 6001: 'bouncebit',
  // 41923: 'edu',
  14: 'flare',
  // 1380012617: 'rarible',
  34443: 'mode',
  81457: 'blast',
  // 11501: 'bevm',
  5000: 'mantle',
}

// Mapping of chainKey to chain ID
const CHAIN_KEY_TO_ID = {
  // Supported chain IDs
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
  // Extended chain IDs
  // xlayer: 196,
  rootstock: 30,
  bob: 60808,
  // lyra: 957,
  flow: 747,
  bitlayer: 200901,
  // canto: 7700,
  ink: 57073,
  coredao: 1116,
  sanko: 1996,
  // reya: 1729,
  scroll: 534352,
  ape: 33139,
  celo: 42220,
  tac: 239,
  sei: 1329,
  // hedera: 295,
  // merlin: 4200,
  xdc: 50,
  worldchain: 480,
  katana: 747474,
  // nova: 42170,
  // lightlink: 1890,
  // aurora: 1313161554,
  // hemi: 43111,
  // cronoszkevm: 388,
  // iota: 8822,
  unichain: 130,
  hyperliquid: 999,
  orderly: 291,
  zora: 7777777,
  peaq: 3338,
  opbnb: 204,
  // real: 111188,
  superposition: 55244,
  manta: 169,
  gravity: 1625,
  goat: 2345,
  gnosis: 100,
  morph: 2818,
  linea: 59144,
  // fuse: 122,
  soneium: 1868,
  // conflux: 1030,
  nibiru: 6900,
  // cronosevm: 25,
  // etherlink: 42793,
  // lens: 232,
  // story: 1514,
  taiko: 167000,
  // sophon: 50104,
  plumephoenix: 98866,
  // lisk: 1135,
  // bouncebit: 6001,
  // edu: 41923,
  flare: 14,
  // rarible: 1380012617,
  mode: 34443,
  blast: 81457,
  // bevm: 11501,
  mantle: 5000,
}              

const OVERRIDE_LZNETWORKS = {
  'linea': 'zkconsensys-mainnet',
}

const CHAIN_KEY_TO_EID = Object.values(CHAIN_KEYS).reduce((map, chainKey) => {
  const net = OVERRIDE_LZNETWORKS[chainKey] ?? chainAndStageToNetwork(chainKey, Stage.MAINNET)
  map[chainKey] = {
    v1: networkToEndpointId(net, EndpointVersion.V1),
    v2: networkToEndpointId(net, EndpointVersion.V2),
  }
  return map
}, {})

const EID_TO_VERSION = Object.values(CHAIN_KEY_TO_EID).reduce((map, { v1, v2 }) => {
  map[v1] = 1
  map[v2] = 2
  return map
}, {})


module.exports = {
  CHAIN_KEYS,
  CHAIN_KEY_TO_ID,
  CHAIN_KEY_TO_EID,
  EID_TO_VERSION,
  WRAPPED_NATIVES,
  SUPPORTED_CHAINS,
  CHAINS_WITH_NO_SWAPPING,
  EXTENDED_SUPPORTED_CHAIN_IDS,
  OVERRIDE_PEG,
  OVERRIDE_LOGO,
  OVERRIDE_CG_CMC_ID,
  CORE_TOKEN_SYMBOLS,
  PARTNER_TOKEN_SYMBOLS,
  BLOCKED_TOKEN_SYMBOLS,
  NATIVE_OFT_ADAPTERS
}
