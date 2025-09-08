require('dotenv').config()
const fs = require('fs')
const { ethers } = require('ethers')
const { multiCallWithFallback } = require('../helpers')
const { OAPP_ABI, OFT_V3_ABI, OFT_V2_ABI } = require('../abi')

const TOKENS_FILE = 'output/usableStargateTokens.json'
const OUT_FILE = 'output/usableStargateTokensEnhanced.json'

async function main() {
  // Load input data
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))

  // Filter relevant tokens for fee info collection
  const feeInfoTokens = tokens.filter(
    (t) => t.fee || t.oftVersion === 3 || t.endpointVersion === 2 || t.oftVersion === 2
  )

  // OFT Interface
  const ifaceV3 = new ethers.Interface(OFT_V3_ABI)
  const ifaceV2 = new ethers.Interface(OFT_V2_ABI)

  // Prepare multicall inputs for each relevant src-dst pair's fee info grouped by chain
  const feeInfoCallsByChain = {}
  for (const src of feeInfoTokens) {
    const peersInfo = src.extensions?.peersInfo || {}
    for (const [chainId, peerEntry] of Object.entries(peersInfo)) {
      // match by address and peers presence
      const dst = tokens.find(
        (t) =>
          t.chainId === parseInt(chainId) &&
          (t.address.toLowerCase() === peerEntry.tokenAddress.toLowerCase() || t.oftAdapter.toLowerCase() === peerEntry.tokenAddress.toLowerCase()) &&
          t.extensions?.peersInfo?.[src.chainId]?.tokenAddress.toLowerCase() === src.address.toLowerCase()
      )

      // peerEntry should exist and match dst.address
      if (!dst) {
        console.warn(`Didn't find peer for ${src.name}:${src.address} (${src.chainId}) on chain ${chainId}, expected: ${peerEntry.tokenAddress}!!!`)
        continue
      }

      const chainKey = src.chainKey

      let callData
      if (src.oftVersion === 3 || src.endpointVersion === 2) {
        const sendParam = [
          dst.endpointId,
          ethers.zeroPadValue(dst.address, 32),
          ethers.parseUnits('1', src.decimals),
          ethers.parseUnits('0', src.decimals),
          '0x',
          '0x',
          '0x',
        ]
        callData = ifaceV3.encodeFunctionData('quoteOFT', [sendParam])
      } else {
        callData = ifaceV2.encodeFunctionData('quoteOFTFee', [dst.endpointId, ethers.parseUnits('1', src.decimals)])
      }

      feeInfoCallsByChain[chainKey] ||= []
      feeInfoCallsByChain[chainKey].push({ src, dst, callData })
    }
  }

  // Prepare minDstGas calls for each src-dst pair grouped by chain
  const minGasCallsByChain = {}
  const minGasIface = new ethers.Interface([
    'function minDstGasLookup(uint16 dstChainId,uint16 type) view returns (uint)',
  ])
  for (const src of tokens) {
    // Only relevant for OFT v1 and v2 (1.2)
    if (src.oftVersion === 3 || src.endpointVersion === 2) continue
    const peersInfo = src.extensions?.peersInfo || {}
    for (const [chainId, peerEntry] of Object.entries(peersInfo)) {
      // match by address and peers presence
      const dst = tokens.find(
        (t) =>
          t.chainId === parseInt(chainId) &&
          t.address.toLowerCase() === peerEntry.tokenAddress.toLowerCase() &&
          t.extensions?.peersInfo?.[src.chainId]?.tokenAddress.toLowerCase() === src.address.toLowerCase()
      )

      // peerEntry should exist and match dst.address
      if (!dst || !dst.endpointId) {
        console.error(`Missing Token or endpointId for ${src.chainId}_${src.address}: chain:${chainId} peer:${peerEntry.tokenAddress}`)
        continue
      }

      const chainKey = src.chainKey

      const callData = minGasIface.encodeFunctionData('minDstGasLookup', [dst.endpointId, 0])

      // initialize array if needed
      minGasCallsByChain[chainKey] ||= []

      // push the new call
      minGasCallsByChain[chainKey].push({
        src,
        dst,
        callData,
      })
    }
  }

  // Prepare isOApp calls for each token grouped by chain
  const isOAppCallsByChain = {}
  const oAppInterface = new ethers.Interface(OAPP_ABI)
  for (const src of tokens) {
    const chainKey = src.chainKey

    const callData =
      src.oftVersion === 3 || src.endpointVersion === 2
        ? oAppInterface.encodeFunctionData('endpoint', [])
        : oAppInterface.encodeFunctionData('lzEndpoint', [])

    isOAppCallsByChain[chainKey] ||= []
    isOAppCallsByChain[chainKey].push({ src, callData })
  }

  // Output mapping for all fee related info
  const tokenFeeMap = {}

  // Merge all calls by chain
  const allChainKeys = new Set([
    ...Object.keys(feeInfoCallsByChain),
    ...Object.keys(minGasCallsByChain),
    ...Object.keys(isOAppCallsByChain),
  ])

  // Multicall on each chain and decode outputs
  for (const chainKey of allChainKeys) {
    const feeCalls =
      feeInfoCallsByChain[chainKey]?.map((c) => ({ target: c.src.oftAdapter, callData: c.callData })) ?? []
    const gasCalls =
      minGasCallsByChain[chainKey]?.map((c) => ({ target: c.src.oftAdapter, callData: c.callData })) ?? []
    const oAppCalls = isOAppCallsByChain[chainKey].map((c) => ({ target: c.src.oftAdapter, callData: c.callData }))

    // Batch both fee and gas calls together
    const aggregateCalls = feeCalls.concat(gasCalls).concat(oAppCalls)

    console.log(`==> Aggregating on ${chainKey}…`)
    let returnData
    // Use tryAggregate to allow individual call failures without reverting batch
    try {
      returnData = await multiCallWithFallback(chainKey, aggregateCalls, 500, 200)
    } catch (err) {
      console.error(` multicall failed on chain ${chainKey}: ${err.message}`)
      continue
    }

    // Split results
    const feeData = returnData.slice(0, feeCalls.length)
    const gasData = returnData.slice(feeCalls.length, feeCalls.length + gasCalls.length)
    const oAppData = returnData.slice(feeCalls.length + gasCalls.length)

    // Process fee results
    feeData.forEach((hex, idx) => {
      const { src, dst } = feeInfoCallsByChain[chainKey][idx]

      // Skip empty return (call failed)
      if (!hex || hex === '0x') {
        console.warn(`Empty return data for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}, skipping decode.`)
        return
      }

      tokenFeeMap[src.address + src.chainKey] ||= {}

      if (src.oftVersion === 3 || src.endpointVersion === 2) {
        const [, , receipt] = ifaceV3.decodeFunctionResult('quoteOFT', hex)
        const sent = BigInt(receipt.sent)
        const received = BigInt(receipt.received)
        const fee = sent > 0n ? ((sent - received) * 10000n) / sent : 10000n
        if (fee > 0n) tokenFeeMap[src.address + src.chainKey][dst.chainId] = { oftFee: parseInt(fee) }
      } else {
        // For v2, quoteOFTFee returns a single uint256
        let feeBn
        try {
          ;[feeBn] = ifaceV2.decodeFunctionResult('quoteOFTFee', hex)
        } catch (err) {
          console.warn(
            `Failed to decode v2 quoteOFTFee for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}:`,
            err.message
          )
          return
        }
        const feeAmount = BigInt(feeBn)
        const sent = ethers.parseUnits('1', src.decimals)
        const received = sent - feeAmount
        const feeBips = sent > 0n ? ((sent - received) * 10000n) / sent : 10000n

        if (feeBips > 0n) tokenFeeMap[src.address + src.chainKey][dst.chainId] = { oftFee: parseInt(feeBips) }
      }
    })

    // Process minDstGas results
    gasData.forEach((hex, idx) => {
      const { src, dst } = minGasCallsByChain[chainKey][idx]

      // Skip empty return (call failed)
      if (!hex || hex === '0x') {
        console.warn(
          `Empty minDstGas return data for ${src.oftAdapter} from ${src.chainKey} to ${dst.chainKey}, default values being used.`
        )
      }

      let gasValResult

      try {
        const [gasVal] = minGasIface.decodeFunctionResult('minDstGasLookup', hex)
        gasValResult = gasVal && Number(gasVal) > 0 ? parseInt(gasVal) : dst.chainId === 42161 ? 2000000 : 200000
      } catch {
        console.warn(
          `Failed to decode minDstGas for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}, default values being used:`,
          hex
        )
      }

      // Attach gas to feeInfo
      tokenFeeMap[src.address + src.chainKey] ||= {}
      tokenFeeMap[src.address + src.chainKey][dst.chainId] = {
        ...tokenFeeMap[src.address + src.chainKey][dst.chainId],
        minDstGas: gasValResult,
      }
    })

    // Process isOApp results
    oAppData.forEach((hex, idx) => {
      let isOApp = true

      const { src } = isOAppCallsByChain[chainKey][idx]

      if (
        !hex ||
        hex === '0x' ||
        Object.keys(src.extensions?.peersInfo || {}).length === 0
      ) {
        console.warn(`Empty lzEndpoint return for ${src.chainKey} - ${src.oftAdapter}`)
        isOApp = false
      }
      try {
        // No need to decode if already set as false due to no return
        if (hex && hex !== '0x') {
          const [endpointAddr] = oAppInterface.decodeFunctionResult('lzEndpoint', hex)
          isOApp = endpointAddr && endpointAddr !== '' && endpointAddr !== '0x'
        }
        // If it is not an OApp, remove OFT specific fields
        if (!isOApp) {
          console.warn(`Not an OApp for ${src.symbol}: ${src.chainKey} - ${src.oftAdapter}`)
          // Update tokens to reflect it is not an OFT
          const tokenIndex = src.index
          console.warn(`Removing OFT specific fields for ${src.symbol}: ${src.chainKey} - ${src.oftAdapter}`)
          // Remove OFT specific fields
          if (tokens[tokenIndex]?.oftVersion) delete tokens[tokenIndex].oftVersion
          if (tokens[tokenIndex]?.endpointVersion) delete tokens[tokenIndex].endpointVersion
          if (tokens[tokenIndex]?.oftAdapter) delete tokens[tokenIndex].oftAdapter
          if (tokens[tokenIndex]?.endpointId) delete tokens[tokenIndex].endpointId
          if (tokens[tokenIndex]?.oftSharedDecimals) delete tokens[tokenIndex].oftSharedDecimals
          if (tokens[tokenIndex]?.extensions) {
            if (tokens[tokenIndex]?.extensions?.feeInfo) delete tokens[tokenIndex].extensions?.feeInfo
            if (tokens[tokenIndex]?.extensions?.peersInfo) delete tokens[tokenIndex].extensions?.peersInfo
          }
          if (tokens[tokenIndex]?.isBridgeable) delete tokens[tokenIndex].isBridgeable
          // Set isOFT to false
          tokens[tokenIndex].isOFT = false
        }
      } catch (e) {
        console.warn(`Failed to decode lzEndpoint for ${src.chainKey}:`, e.message)
      }
    })
  }

  // Merge and validate extensions
  const enhanced = tokens.map((t) => {
    const existingExt = t?.extensions ?? {}
    let bridgeInfo = existingExt?.bridgeInfo
    let feeInfo = tokenFeeMap?.[t.address + t.chainKey]

    // If no feeInfo and no bridgeInfo, return original token
    if (!bridgeInfo && !feeInfo) {
      return t
    }

    // Remove self-references: token's own chain
    const selfChain = t.chainId.toString()
    if (bridgeInfo?.[selfChain]) delete bridgeInfo[selfChain]
    if (feeInfo?.[selfChain]) delete feeInfo[selfChain]

    // Populate missing OFT fields
    if (t.isOFT !== false) {
      // If endpointVersion === 2 and there is no field for oftVersion we should populate it as version 3
      if (!('oftVersion' in t) && t?.endpointVersion === 2) t.oftVersion = 3
      // If oftVersion === 2 and there is no field for endpointVersion we should populate it as version 1
      if (t?.oftVersion === 2 && !('endpointVersion' in t)) t.endpointVersion = 1
      // If there is no field for endpointVersion and oftVersion we should populate them as version 1
      if (!('oftVersion' in t) && !('endpointVersion' in t)) {
        t.oftVersion = 1
        t.endpointVersion = 1
      }
    }

    // Update extensions
    if (bridgeInfo) existingExt.bridgeInfo = bridgeInfo
    if (t.isOFT !== false && feeInfo) existingExt.feeInfo = feeInfo

    // Fix for error in Layer Zero Metadata - USDT0 preference
    if (t?.address === '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' && t?.chainId === 42161)
      t.oftAdapter = '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92'

    return {
      ...t,
      isOFT: t.isOFT === false ? false : true,
      extensions: {
        ...existingExt,
      },
    }
  })

  // Remove empty extensions.feeInfo and extensions.bridgeInfo
  for (const token of enhanced) {
    if (token.address && token.address !== '0x00') token.address = ethers.getAddress(token.address)
    if (token.oftAdapter && token.oftAdapter !== '0x00') token.oftAdapter = ethers.getAddress(token.oftAdapter)

    const noPeers =
      !token.extensions?.peersInfo ||
      Object.keys(token.extensions.peersInfo).length === 0

    if (noPeers) {
      if (token.extensions) delete token.extensions.peersInfo

      delete token.isOFT
      delete token.oftAdapter
      delete token.oftSharedDecimals
      delete token.oftVersion
      delete token.endpointVersion
      delete token.endpointId
      delete token.isBridgeable
    }

    if (!token.extensions || Object.keys(token.extensions).length === 0) {
      delete token.extensions
    }
    if (token?.extensions?.feeInfo && Object.keys(token.extensions.feeInfo).length === 0) {
      delete token.extensions.feeInfo
    }
    if (token?.extensions?.bridgeInfo && Object.keys(token.extensions.bridgeInfo).length === 0) {
      delete token.extensions.bridgeInfo
    }
    if (!token.icon || !token.extensions?.coingeckoId || !token.extensions?.coinMarketCapId) {
      for (const peer of enhanced) {
        if (peer.name !== token.name) continue
        // if found, copy over the missing properties
        token.extensions = token.extensions || {}
        if (!token.icon && peer.icon) token.icon = peer.icon
        if (peer.extensions?.coingeckoId && !token.extensions.coingeckoId) token.extensions.coingeckoId = peer.extensions.coingeckoId
        if (peer.extensions?.coinMarketCapId && !token.extensions.coinMarketCapId) token.extensions.coinMarketCapId = peer.extensions.coinMarketCapId
      }
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(enhanced, null, 2))
  console.log(`Enhanced tokens saved to ${OUT_FILE}`)
}

main().catch(console.error)
