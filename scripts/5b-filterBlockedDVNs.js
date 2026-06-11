require('dotenv').config()
const fs = require('fs')
const { ethers } = require('ethers')
const { multiCallWithFallback } = require('../helpers')
const { ENDPOINT_V2_ABI } = require('../abi')
const { CHAIN_KEYS, CHAIN_KEY_TO_EID } = require('../configs')

const TOKENS_FILE = 'output/usableStargateTokens.json'

// ULN config type on EndpointV2.getConfig
const CONFIG_TYPE_ULN = 2

// UlnConfig struct returned by getConfig as ABI-encoded bytes
const ULN_CONFIG_TYPE =
  'tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)'

async function main() {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
  const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'))

  // ─── Per-chain lookups: EndpointV2 address + LayerZero Labs / Stargate DVN sets ───
  const endpointV2ByChain = {}
  const lzDVNsByChain = {}
  const stargateDVNsByChain = {}

  for (const chainKey of new Set(Object.values(CHAIN_KEYS))) {
    const meta = ofts[chainKey]
    if (!meta) continue

    const v2Deployment = (meta.deployments || []).find((d) => d.version === 2 && d.endpointV2?.address)
    if (v2Deployment) endpointV2ByChain[chainKey] = v2Deployment.endpointV2.address

    const lz = new Set()
    const sg = new Set()
    for (const [addr, info] of Object.entries(meta.dvns || {})) {
      if (info.id === 'layerzero-labs') lz.add(addr.toLowerCase())
      if (info.id === 'stargate') sg.add(addr.toLowerCase())
    }
    lzDVNsByChain[chainKey] = lz
    stargateDVNsByChain[chainKey] = sg
  }

  // ─── Build getSendLibrary calls per chain for every V2 token × pathway ─────────
  const iface = new ethers.Interface(ENDPOINT_V2_ABI)
  const pathwaysByChain = {}

  for (const token of tokens) {
    if (!(token.endpointVersion === 2 || token.oftVersion === 3)) continue

    const peersInfo = token.extensions?.peersInfo || {}
    if (Object.keys(peersInfo).length === 0) continue

    const chainKey = token.chainKey
    const endpoint = endpointV2ByChain[chainKey]
    if (!endpoint) {
      console.warn(`No EndpointV2 deployment found for chain ${chainKey}, skipping DVN check for ${token.symbol}`)
      continue
    }
    if (lzDVNsByChain[chainKey].size === 0) {
      console.warn(`No LayerZero Labs DVN metadata for chain ${chainKey}, skipping DVN check for ${token.symbol}`)
      continue
    }

    for (const dstChainId of Object.keys(peersInfo)) {
      const dstChainKey = CHAIN_KEYS[dstChainId]
      const dstEid = dstChainKey ? CHAIN_KEY_TO_EID[dstChainKey]?.v2 : undefined
      if (!dstEid) {
        console.warn(`No V2 EID for destination chainId ${dstChainId}, skipping pathway of ${token.symbol}`)
        continue
      }

      pathwaysByChain[chainKey] ||= []
      pathwaysByChain[chainKey].push({ token, endpoint, dstChainId, dstEid })
    }
  }

  // ─── Query send libraries + ULN configs and flag blocked pathways ──────────────
  const blockedPathways = [] // { token, dstChainId }
  let blocked1of1 = 0
  let blocked2of2 = 0

  for (const [chainKey, pathways] of Object.entries(pathwaysByChain)) {
    console.log(`==> Checking ${pathways.length} pathway DVN config(s) on ${chainKey}…`)

    // Round 1: getSendLibrary(oftAdapter, dstEid)
    const sendLibCalls = pathways.map((p) => ({
      target: p.endpoint,
      callData: iface.encodeFunctionData('getSendLibrary', [p.token.oftAdapter, p.dstEid]),
    }))

    let sendLibData
    try {
      sendLibData = await multiCallWithFallback(chainKey, sendLibCalls, 50, 300)
    } catch (err) {
      console.error(`  getSendLibrary multicall failed on chain ${chainKey}: ${err.message}`)
      continue
    }

    // Round 2: getConfig(oftAdapter, sendLib, dstEid, CONFIG_TYPE_ULN)
    const configCalls = []
    const configPathways = []
    sendLibData.forEach((hex, idx) => {
      const pathway = pathways[idx]
      if (!hex || hex === '0x') {
        console.warn(
          `  Empty getSendLibrary return for ${pathway.token.symbol} (${chainKey} → ${pathway.dstChainId}), keeping pathway`
        )
        return
      }

      let sendLib
      try {
        ;[sendLib] = iface.decodeFunctionResult('getSendLibrary', hex)
      } catch {
        console.warn(
          `  Failed to decode getSendLibrary for ${pathway.token.symbol} (${chainKey} → ${pathway.dstChainId}), keeping pathway`
        )
        return
      }

      configCalls.push({
        target: pathway.endpoint,
        callData: iface.encodeFunctionData('getConfig', [
          pathway.token.oftAdapter,
          sendLib,
          pathway.dstEid,
          CONFIG_TYPE_ULN,
        ]),
      })
      configPathways.push(pathway)
    })

    if (configCalls.length === 0) continue

    let configData
    try {
      configData = await multiCallWithFallback(chainKey, configCalls, 50, 300)
    } catch (err) {
      console.error(`  getConfig multicall failed on chain ${chainKey}: ${err.message}`)
      continue
    }

    const lzDVNs = lzDVNsByChain[chainKey]
    const stargateDVNs = stargateDVNsByChain[chainKey]

    configData.forEach((hex, idx) => {
      const pathway = configPathways[idx]
      if (!hex || hex === '0x') {
        console.warn(
          `  Empty getConfig return for ${pathway.token.symbol} (${chainKey} → ${pathway.dstChainId}), keeping pathway`
        )
        return
      }

      let ulnConfig
      try {
        const [configBytes] = iface.decodeFunctionResult('getConfig', hex)
        ;[ulnConfig] = ethers.AbiCoder.defaultAbiCoder().decode([ULN_CONFIG_TYPE], configBytes)
      } catch {
        console.warn(
          `  Failed to decode UlnConfig for ${pathway.token.symbol} (${chainKey} → ${pathway.dstChainId}), keeping pathway`
        )
        return
      }

      if (Number(ulnConfig.optionalDVNCount) !== 0) return

      const requiredDVNs = ulnConfig.requiredDVNs.map((a) => a.toLowerCase())

      // Blocked by LayerZero post-exploit: 1/1 LayerZero Labs DVN
      const is1of1LZ = Number(ulnConfig.requiredDVNCount) === 1 && lzDVNs.has(requiredDVNs[0])
      // Blocked by LayerZero post-exploit: 2/2 LayerZero Labs + Stargate DVNs
      const is2of2LZStargate =
        Number(ulnConfig.requiredDVNCount) === 2 &&
        requiredDVNs.some((a) => lzDVNs.has(a)) &&
        requiredDVNs.some((a) => stargateDVNs.has(a))

      if (is1of1LZ || is2of2LZStargate) {
        if (is1of1LZ) blocked1of1++
        else blocked2of2++
        blockedPathways.push({ token: pathway.token, dstChainId: pathway.dstChainId })
        console.log(
          `  ❌ Blocked DVN config (${is1of1LZ ? '1/1 LayerZero Labs' : '2/2 LayerZero Labs + Stargate'}): ${pathway.token.symbol} ${chainKey} → ${CHAIN_KEYS[pathway.dstChainId]}`
        )
      }
    })
  }

  // ─── Remove blocked pathways (both directions, to keep pairs bidirectional) ────
  for (const { token, dstChainId } of blockedPathways) {
    const peerEntry = token.extensions?.peersInfo?.[dstChainId]
    if (!peerEntry) continue

    delete token.extensions.peersInfo[dstChainId]

    // Remove the reverse direction from the peer token
    const peerAddr = peerEntry.tokenAddress.toLowerCase()
    const reverse = tokens.find(
      (t) =>
        t.chainId === parseInt(dstChainId) &&
        (t.oftAdapter?.toLowerCase() === peerAddr || t.address?.toLowerCase() === peerAddr) &&
        t.extensions?.peersInfo?.[token.chainId]
    )
    if (reverse) delete reverse.extensions.peersInfo[token.chainId]
  }

  // Drop empty peersInfo objects so step 6 strips OFT fields for those tokens
  for (const token of tokens) {
    if (token.extensions?.peersInfo && Object.keys(token.extensions.peersInfo).length === 0) {
      delete token.extensions.peersInfo
    }
  }

  console.log(
    `\n📊 Summary: ${blockedPathways.length} pathway(s) with blocked DVN configs removed (1/1 LayerZero Labs: ${blocked1of1}, 2/2 LayerZero Labs + Stargate: ${blocked2of2})`
  )

  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
  console.log(`✅ Finished. Wrote ${tokens.length} tokens to ${TOKENS_FILE}.`)
}

main().catch((e) => {
  console.error('Fatal error in main():', e)
  process.exit(1)
})
