// download-logos.js
const fs = require('fs')
const path = require('path')
const nativeTokens = require('../wrappedNatives.json')
const activeList = require('../token-list.json')
const inactiveList = require('../inactive-token-list.json')
const { CHAIN_ID_TO_NETWORK } = require('./CHAIN_ID_TO_NETWORK')

// TODO: Remove duplicate fn and use the same from test-lists.js
function getAddressFromEntry(token) {
  return token.address ?? token.underlyingAddress
}

async function downloadLogo(token) {
  const networkName = CHAIN_ID_TO_NETWORK[token.chainId]
  if (!networkName) {
    console.warn(`⚠️  No mapping for chainId ${token.chainId} - skipping ${token.symbol}`)
    return
  }

  try {
    const saveDir = path.join('assets', networkName, getAddressFromEntry(token))
    const savePath = path.join(saveDir, 'logo.png')

    if (fs.existsSync(savePath)) return
    if (!token.logoURI) return

    const res = await fetch(token.logoURI)
    if (!res.ok) {
      console.warn(`❌ Failed to fetch ${token.chainId} ${token.symbol} from ${token.logoURI}`)
      return
    }

    const buffer = await res.bytes()

    fs.mkdirSync(saveDir, { recursive: true })
    fs.writeFileSync(savePath, buffer)

    console.log(`✅ Saved ${token.chainId} ${token.symbol} logo to ${savePath}`)
  } catch (err) {
    console.error(`🔥 Error downloading ${token.chainId} ${token.symbol}:`, err.message)
  }
}

async function downloadLogosForList(tokens) {
  for (const token of tokens) {
    await downloadLogo(token)
  }
}

async function main() {
  downloadLogosForList(nativeTokens)
  downloadLogosForList(activeList.rootTokens)
  downloadLogosForList(activeList.tokens)
  downloadLogosForList(inactiveList.tokens)
}

main()
