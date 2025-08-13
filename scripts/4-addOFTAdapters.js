const fs = require('fs')
const { ZERO_ADDRESS } = require('maia-core-sdk')
const { CHAIN_KEY_TO_ID, CHAIN_KEY_TO_EID, SUPPORTED_CHAINS} = require('../configs')
const { mergeExtensions, cleanAddress } = require('../helpers')

async function main() {
  // Load baseline and OFT data
  const baseEntries = JSON.parse(fs.readFileSync('output/filteredStargateTokens.json', 'utf8'))
  const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'))

  // Build lookup of existing entries
  const existing = new Map()
  for (const e of baseEntries) {
    existing.set(`${e.chainId}:${e.address.toLowerCase()}`, e)
  }

  const results = []
  const missingAdapters = []

  // Iterate each supported chain
  for (const chainKey of SUPPORTED_CHAINS) {
    console.log(`Processing addOFTAdapters chain: ${chainKey}`)

    const chainData = ofts[chainKey]
    const chainId = CHAIN_KEY_TO_ID[chainKey]
    if (!chainData) continue
    // TODO: REVIEW THIS CHECK WE MAY BE MISSING SOME CHAINS
    if (!chainData.addressToOApp || !chainData.tokens) {
      console.warn(`skipping, no addressToOApp or no tokens on chain ${chainKey}`)
      continue
    }

    // Iterate each token entry in OFT
    for (let [adapter, oAppInfo] of Object.entries(chainData.addressToOApp)) {
      let adapterInfo = ofts[chainKey].tokens?.[adapter]
      let adapterAddress = adapter !== ZERO_ADDRESS ? cleanAddress(adapter) : undefined
      let tokenAddress = adapterAddress

      if (!adapterInfo) {
        console.warn(`returning early, no adapterInfo for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`)
        if (adapterAddress) {
          results.push({
            chainId,
            chainKey,
            address: tokenAddress,
            oftAdapter: adapterAddress,
          })
        }
        continue
      }

      if (!adapterAddress) {
        console.warn(`skipping, zero-address adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`)
        continue
      }

      if (adapterInfo?.erc20TokenAddress) {
        // Fallback to erc20TokenAddress if available
        tokenAddress = cleanAddress(adapterInfo.erc20TokenAddress)
      }

      // Skip invalid zero-address placeholders
      if (!tokenAddress || tokenAddress === ZERO_ADDRESS) {
        console.warn(`skipping, zero-address token for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`)
        continue
      }

      // If already processed in results, skip
      const tokenInfo =
        adapterAddress === tokenAddress ? adapterInfo : ofts[chainKey].tokens?.[adapterInfo?.erc20TokenAddress]

      // Skip invalid tokenInfoToUse
      if (!tokenInfo) {
        console.warn(`skipping, undefined tokenInfo for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`)
        continue
      }

      // Get existing or new baseline
      const key = `${chainId}:${tokenAddress}`
      const base = existing.get(key) || {
        chainId,
        address: tokenAddress,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        extensions: {},
      }

      // Build extensions
      let extensions = mergeExtensions(base.extensions, {
        coingeckoId: adapterInfo?.cgId,
        coinMarketCapId: adapterInfo?.cmcId,
      })

      const tokenEid =
        (tokenInfo?.eid ?? (adapterInfo?.oftVersion === 3 || adapterInfo?.endpointVersion === 2))
          ? CHAIN_KEY_TO_EID[chainKey]?.v2
          : CHAIN_KEY_TO_EID[chainKey]?.v1

      if (!tokenEid) {
        console.warn('Skipping, no EID found for chainKey: ', chainKey)
        continue
      }

      // Assemble enriched token
      const enriched = {
        ...base,
        chainId,
        address: tokenAddress,
        chainKey,
        oftAdapter: adapterAddress,
        oftVersion: adapterInfo?.oftVersion,
        endpointVersion: adapterInfo?.endpointVersion,
        oftSharedDecimals: adapterInfo?.sharedDecimals,
        endpointId: tokenEid,
        oAppId: oAppInfo?.id,
        // Ensure essential fields
        symbol: base?.symbol ?? adapterInfo?.symbol ?? tokenInfo?.symbol,
        name: base?.name ?? adapterInfo?.name ?? adapterInfo?.symbol ?? tokenInfo?.symbol,
        decimals: base?.decimals ?? adapterInfo?.decimals ?? tokenInfo?.decimals,
        extensions,
      }
      if (tokenInfo?.fee) enriched.fee = tokenInfo.fee
      if (tokenInfo?.peggedTo) enriched.peggedTo = tokenInfo.peggedTo

      results.push(enriched)
    }
  }

  // Write outputs
  fs.writeFileSync('output/usableStargateTokens.json', JSON.stringify(results, null, 2))
  fs.writeFileSync('output/missingAdapters.json', JSON.stringify(missingAdapters, null, 2))

  console.log(`Done: ${results.length} enriched, ${missingAdapters.length} missing`)
}

main().catch((e) => console.error(e))
