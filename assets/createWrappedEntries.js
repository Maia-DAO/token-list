// download-logos.js
const fs = require('fs')
const path = require('path')
const tokens = require('../wrappedNatives.json')

// Define mappings inline
const CHAIN_ID_TO_NETWORK = {
  // --- base networks ---
  42161: 'arbitrum', // SupportedChainId.ARBITRUM_ONE
  11155111: 'sepolia', // SupportedChainId.SEPOLIA
  1: 'ethereum', // SupportedChainId.MAINNET
  10: 'optimism', // SupportedChainId.OPTIMISM
  8453: 'base', // SupportedChainId.BASE
  137: 'polygon', // SupportedChainId.POLYGON
  56: 'smartchain', // SupportedChainId.BSC (Uniswap/trustwallet name)
  43114: 'avalanchec', // SupportedChainId.AVAX
  1088: 'metis', // SupportedChainId.METIS

  // --- extended ---
  42220: 'celo', // ExtendedSupportedChainId.CELO
  50: 'xdc', // ExtendedSupportedChainId.XDC
  130: 'unichain', // ExtendedSupportedChainId.UNICHAIN
  100: 'xdai', // ExtendedSupportedChainId.GNOSIS
  1868: 'soneium', // ExtendedSupportedChainId.SONEIUM
  81457: 'blast', // ExtendedSupportedChainId.BLAST
  7777777: 'zora', // ExtendedSupportedChainId.ZORA
  34443: 'mode', // ExtendedSupportedChainId.MODE

  // --- defiLlama-specific extras ---
  //   56: 'bsc', // same chainId, DefiLlama naming
  //   43114: 'avax', // same chainId, DefiLlama naming
  1923: 'swellchain', // SupportedChainId.SWELL
  146: 'sonic', // SupportedChainId.SONIC
  80094: 'berachain', // SupportedChainId.BERA
  252: 'fraxtal', // SupportedChainId.FRAXTAL
  534352: 'scroll', // ExtendedSupportedChainId.SCROLL
  1329: 'sei', // ExtendedSupportedChainId.SEI
  169: 'manta', // ExtendedSupportedChainId.MANTA
  59144: 'linea', // ExtendedSupportedChainId.LINEA
  5000: 'mantle', // ExtendedSupportedChainId.MANTLE
  30: 'rsk', // ExtendedSupportedChainId.ROOTSTOCK
  60808: 'bob', // ExtendedSupportedChainId.BOB
  747: 'flow', // ExtendedSupportedChainId.FLOW
  57073: 'ink', // ExtendedSupportedChainId.INK
  1116: 'core', // ExtendedSupportedChainId.COREDAO
  1996: 'sanko', // ExtendedSupportedChainId.SANKO
  33139: 'apechain', // ExtendedSupportedChainId.APE
  239: 'tac', // ExtendedSupportedChainId.TAC
  747474: 'katana', // ExtendedSupportedChainId.KATANA
  999: 'hyperliquid', // ExtendedSupportedChainId.HYPERLIQUID
  204: 'op_bnb', // ExtendedSupportedChainId.OPBNB
  1625: 'gravity', // ExtendedSupportedChainId.GRAVITY
  2345: 'goat', // ExtendedSupportedChainId.GOAT
  2818: 'morph', // ExtendedSupportedChainId.MORPH
  6900: 'nibiru', // ExtendedSupportedChainId.NIBIRU
  167000: 'taiko', // ExtendedSupportedChainId.TAIKO
  98866: 'plume_mainnet', // ExtendedSupportedChainId.PLUMEPHOENIX
  14: 'flare', // ExtendedSupportedChainId.FLARE
}

async function downloadLogo(token) {
  const networkName = CHAIN_ID_TO_NETWORK[token.chainId]
  if (!networkName) {
    console.warn(`⚠️  No mapping for chainId ${token.chainId}, skipping ${token.symbol}`)
    return
  }

  try {
    const res = await fetch(token.logoURI)
    if (!res.ok) {
      console.warn(`❌ Failed to fetch ${token.symbol} from ${token.logoURI}`)
      return
    }

    const buffer = await res.bytes()
    const saveDir = path.join('assets', networkName, token.address)
    const savePath = path.join(saveDir, 'logo.png')

    fs.mkdirSync(saveDir, { recursive: true })
    fs.writeFileSync(savePath, buffer)

    console.log(`✅ Saved ${token.symbol} logo to ${savePath}`)
  } catch (err) {
    console.error(`🔥 Error downloading ${token.symbol}:`, err.message)
  }
}

async function main() {
  for (const token of tokens) {
    await downloadLogo(token)
  }
}

main()
