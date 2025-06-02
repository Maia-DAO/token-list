const fs = require('fs');
const { CHAIN_KEY_TO_ID, SUPPORTED_CHAINS, CHAIN_KEYS, OVERRIDE_PEG, mergeExtensions, cleanAddress } = require('../constants');
const { ZERO_ADDRESS } = require('maia-core-sdk');

async function main() {
  // Load baseline and OFT data
  const baseEntries = JSON.parse(
    fs.readFileSync('output/filteredStargateTokens.json', 'utf8')
  );
  const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'));

  // Build lookup of existing entries
  const existing = new Map();
  for (const e of baseEntries) {
    existing.set(`${e.chainId}:${e.address.toLowerCase()}`, e);
  }

  const results = [];
  const missingAdapters = [];
  const bridgeMap = {};
  const oappMap = {};

  // Iterate each supported chain
  for (const chainKey of SUPPORTED_CHAINS) {
    const chainData = ofts[chainKey];
    const chainId = CHAIN_KEY_TO_ID[chainKey];
    if (!chainData) continue;

    // Iterate each token entry in OFT
    for (let [adapter, oAppInfo] of Object.entries(
      chainData.addressToOApp
    )) {

      let adapterInfo = ofts[chainKey].tokens?.[adapter];

      if (!adapterInfo) {
        console.warn(`no adapterInfo for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`);
      }

      let adapterAddress = adapter !== ZERO_ADDRESS ? cleanAddress(adapter) : undefined;
      let tokenAddress = adapterAddress;

      if (!adapterAddress) {
        console.warn(`skipping zero-address adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`);
        continue;
      }

      if (adapterInfo?.erc20TokenAddress) {
        // Fallback to erc20TokenAddress if available
        tokenAddress = cleanAddress(adapterInfo.erc20TokenAddress);
      }

      // Skip invalid zero-address placeholders
      if (!tokenAddress || tokenAddress === ZERO_ADDRESS) {
        console.warn(`skipping zero-address token for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`);
        continue;
      }

      // If already processed in results, skip
      const tokenInfo = adapterAddress === tokenAddress ? adapterInfo : ofts[chainKey].tokens?.[adapterInfo?.erc20TokenAddress];

      // Skip invalid tokenInfoToUse
      if (!tokenInfo) {
        console.warn(`skipping undefined tokenInfo for adapter ${oAppInfo.id} - ${adapter} on chain ${chainKey}`);
        continue;
      }

      // Get existing or new baseline
      const key = `${chainId}:${tokenAddress}`;
      const base = existing.get(key) || { chainId, address: tokenAddress, name: tokenInfo.name, symbol: tokenInfo.symbol, decimals: tokenInfo.decimals, extensions: {} };

      // Build extensions
      let extensions = mergeExtensions(base.extensions, {
        coingeckoId: adapterInfo?.cgId,
        coinMarketCapId: adapterInfo?.cmcId
      });

      // Bridge mapping
      const peg = OVERRIDE_PEG[base.symbol] ?? tokenInfo?.peggedTo;
      if (peg?.address) {
        const pegKey = peg.address.toLowerCase() + peg.chainName;
        bridgeMap[pegKey] = bridgeMap[pegKey] || {};
        bridgeMap[pegKey][chainId] = { tokenAddress: tokenAddress };
        if (SUPPORTED_CHAINS.includes(peg.chainName)) {
          extensions = mergeExtensions(extensions, {
            bridgeInfo: {
              [CHAIN_KEY_TO_ID[peg.chainName]]: { tokenAddress: peg.address }
            }
          });
        }
      }

      if (tokenInfo?.symbol === 'weETH') {
        console.log('weETH token', oAppInfo.id, chainId, tokenAddress, tokenInfo, oAppInfo);
      }

      // Record oApp peers
      if (oAppInfo) {
        if (!oappMap[oAppInfo.id]?.[chainId]) {
          oappMap[oAppInfo.id] = oappMap[oAppInfo.id] || [];
          oappMap[oAppInfo.id].push({ chainId, address: tokenAddress });
        }
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
        // Ensure essential fields
        symbol: base?.symbol ?? adapterInfo?.symbol ?? tokenInfo?.symbol,
        name: base?.name ?? adapterInfo?.name ?? adapterInfo?.symbol ?? tokenInfo?.symbol,
        decimals: base?.decimals ?? adapterInfo?.decimals ?? tokenInfo?.decimals,
        extensions,
        oAppId: oAppInfo?.id
      };
      if (tokenInfo?.fee) enriched.fee = tokenInfo.fee;

      results.push(enriched);
    }
  }

  // Attach bridgeInfo from mapping
  for (const token of results) {
    const mapKey = token.address?.toLowerCase() + token.chainKey;
    const bi = bridgeMap[mapKey];
    if (bi && Object.keys(bi).length) {
      token.extensions = mergeExtensions(token.extensions, { bridgeInfo: bi });
    }
  }

  // Attach peersInfo
  for (const token of results) {
    // Get oApp peers
    const peers = oappMap[token.oAppId];
    if (!peers) continue;

    // If no peers, skip
    if (!peers.length) {
      console.warn(`No peers found for token ${token.symbol} on chain ${token.chainKey}`);
      continue;
    }

    // If only self, skip
    if (peers.length === 1 && peers[0].chainId === token.chainId && peers[0].address === token.address) {
      console.warn(`Only self peer found for token ${token.symbol} on chain ${token.chainKey}`);
      continue;
    }

    // Filter self peer and merge to extensions
    const others = peers.filter(
      (p) => p.chainId !== token.chainId
    );

    if (others.length) {
      token.extensions = mergeExtensions(token.extensions, {
        peersInfo: Object.fromEntries(
          others.map((p) => [p.chainId, { tokenAddress: p.address }])
        )
      });
    }
  }

  // Write outputs
  fs.writeFileSync(
    'output/usableStargateTokens.json',
    JSON.stringify(results, null, 2)
  );
  fs.writeFileSync(
    'output/missingAdapters.json',
    JSON.stringify(missingAdapters, null, 2)
  );

  console.log(
    `Done: ${results.length} enriched, ${missingAdapters.length} missing`
  );
}



main().catch(e => console.error(e));
