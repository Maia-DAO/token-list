/**
 * Updated Script: enrichOFTTokens.js
 * Description: Expands from `ofts.json` instead of limiting to `filteredStargateTokens.json`.
 * - Covers all tokens on supported chains.
 * - Builds adapter, version, bridgeInfo, and peersInfo.
 * - Output:
 *   - output/usableStargateTokens.json
 *   - output/missingAdapters.json
 */

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
    for (let [adapterAddr, oAppInfo] of Object.entries(
      chainData.addressToOApp
    )) {

      let tokenInfo = ofts[chainKey].tokens?.[adapterAddr.toLowerCase()];

      if (!tokenInfo) {
        console.warn(`no token info for adapter ${adapterAddr} on chain ${chainKey}`);
      }

      let adapter = adapterAddr !== ZERO_ADDRESS ? cleanAddress(adapterAddr) : undefined;
      let tokenAddress = adapter;

      if (!adapter) {
        console.warn(`skipping zero-address adapter for chain ${chainKey}`);
        continue;
      }

      // Determine output token address: native vs proxy
      // if (
      //   tokenInfo.type !== 'NativeOFT' &&
      //   Array.isArray(tokenInfo.proxyAddresses) &&
      //   tokenInfo.proxyAddresses.length > 0
      // ) {
      //   adapter = cleanAddress(tokenInfo.proxyAddresses[
      //     tokenInfo.proxyAddresses.length - 1
      //   ]);
      // } else 

      if (tokenInfo?.erc20TokenAddress) {
        // Fallback to erc20TokenAddress if available
        tokenAddress = cleanAddress(tokenInfo.erc20TokenAddress);
      }

      // If already processed in results, skip
      const tokenInfoToUse = adapter === tokenAddress ? tokenInfo : ofts[chainKey].tokens?.[adapter.toLowerCase()];

      // Skip invalid zero-address placeholders
      if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
        console.warn(`skipping zero-address token for adapter ${adapterAddr} on chain ${chainKey}`);
        continue;
      }

      // Get existing or new baseline
      const key = `${chainId}:${tokenAddress}`;
      const base = existing.get(key) || { chainId, address: tokenAddress, extensions: {} };

      // Build extensions
      let extensions = mergeExtensions(base.extensions, {
        coingeckoId: tokenInfoToUse?.cgId,
        coinMarketCapId: tokenInfoToUse?.cmcId
      });

      // Bridge mapping
      const peg = OVERRIDE_PEG[base.symbol] ?? tokenInfoToUse?.peggedTo;
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

      // Record oApp peers
      if (oAppInfo) {
        oappMap[oAppInfo.id] = oappMap[oAppInfo.id] || [];
        oappMap[oAppInfo.id].push({ chainId, address: tokenAddress });
      }

      // Assemble enriched token
      const enriched = {
        ...base,
        chainId,
        address: tokenAddress,
        chainKey,
        oftAdapter: adapter,
        oftVersion: tokenInfoToUse?.oftVersion,
        endpointVersion: tokenInfoToUse?.endpointVersion,
        oftSharedDecimals: tokenInfoToUse?.sharedDecimals,
        // Ensure essential fields
        symbol: base?.symbol ?? tokenInfo?.symbol ?? tokenInfoToUse?.symbol,
        name: base?.name ?? tokenInfo?.name ?? tokenInfo?.symbol ?? tokenInfoToUse?.symbol,
        decimals: base?.decimals != null ? base?.decimals : tokenInfo?.decimals ?? tokenInfoToUse?.decimals,
        extensions
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
    for (const [appId, peers] of Object.entries(oappMap)) {
      if (
        peers.some(
          (p) => p.chainId === token.chainId && p.address === token.address
        )
      ) {
        const other = peers.filter(
          (p) => p.chainId !== token.chainId
        );
        if (other.length) {
          token.extensions = mergeExtensions(token.extensions, {
            peersInfo: Object.fromEntries(
              other.map((p) => [p.chainId, { tokenAddress: p.address }])
            )
          });
        }
      }
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
