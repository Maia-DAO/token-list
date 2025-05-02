/*
  Script: addOFTAdapters.js
  Description: Reads a JSON file of entries { chainId, address } and an OFT data file,
    determines native vs proxied OFTs, extracts adapter addresses and versions, merges extension data,
    builds bridgeInfo for main tokens, and outputs:
      - output/usableStargateTokens.json: enriched entries with adapter/oftVersion/extensions
      - output/missingAdapters.json: tokens missing adapter info
  Usage:
    node addOFTAdapters.js input.json ofts.json
*/

const fs = require('fs');
const { CHAIN_KEYS, CHAIN_KEY_TO_ID, SUPPORTED_CHAINS } = require('../constants');

function mergeExtensions(ext1 = {}, ext2 = {}) {
    const merged = { ...ext1 };
    for (const key in ext2) {
        if (merged[key] && typeof merged[key] === 'object' && typeof ext2[key] === 'object') {
            merged[key] = { ...merged[key], ...ext2[key] };
        } else {
            merged[key] = ext2[key];
        }
    }
    return merged;
}

async function main() {
    const entries = JSON.parse(fs.readFileSync('output/filteredStargateTokens.json', 'utf8'));
    const ofts = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'));

    const results = [];
    const missingAdapters = [];
    const bridgeMap = {};

    for (const entry of entries) {
        const { chainId, address } = entry;
        const chainKey = CHAIN_KEYS[chainId];
        if (!chainKey || !ofts[chainKey]) {
            console.warn(`no OFT data for chainId=${chainId}`);
            missingAdapters.push(entry);
            continue;
        }

        let tokenInfo = ofts[chainKey].tokens[address.toLowerCase()];
        let adapterAddress;

        // if not found, try ERC20 wrapper fallback
        if (!tokenInfo) {
            tokenInfo = Object.values(ofts[chainKey].tokens).find(t =>
                t.erc20TokenAddress && t.erc20TokenAddress.toLowerCase() === address.toLowerCase()
            );
            if (tokenInfo) {
                // wrapper key is the address used in tokens
                adapterAddress = Object.keys(ofts[chainKey].tokens).find(k => tokens[k] === tokenInfo);
            }
        }

        if (!tokenInfo) {
            console.warn(`token ${address}@${chainId} not found in ofts.json tokens`);
            missingAdapters.push(entry);
            continue;
        }

        // determine adapter vs native
        const proxies = tokenInfo.proxyAddresses;
        if (!adapterAddress) {
            const isNative = tokenInfo.type === 'NativeOFT' || !Array.isArray(proxies) || proxies.length === 0;
            adapterAddress = isNative
                ? address
                : proxies[proxies.length - 1];
        }

        // lookup OApp info
        const appInfo = ofts[chainKey].tokens?.[adapterAddress.toLowerCase()];
        if (!appInfo) {
            console.warn(`token ${address}@${chainId} not found in appInfo`);
            // nothing here, record placeholder
            missingAdapters.push(entry);
            continue;
        }

        // build extensions
        const extensions = mergeExtensions(entry.extensions, {
            coingeckoId: appInfo.cgId,
            coinMarketCapId: appInfo.cmcId
        });

        // record bridge mapping: map main token to list of OFTs
        if (appInfo.peggedTo) {
            const mainAddr = appInfo.peggedTo.address;
            bridgeMap[mainAddr + appInfo.peggedTo.chainName] = bridgeMap[mainAddr + appInfo.peggedTo.chainName] || {};
            bridgeMap[mainAddr + appInfo.peggedTo.chainName][chainId] = { tokenAddress: address };
            // Ensure link to pegged token when possible
            if (SUPPORTED_CHAINS.includes(appInfo.peggedTo.chainName)) {
                extensions.bridgeInfo = { [CHAIN_KEY_TO_ID[appInfo.peggedTo.chainName]]: { tokenAddress: appInfo.peggedTo.address } };
            }
        }

        // assemble result
        const enriched = {
            ...entry,
            oftAdapter: adapterAddress,
            oftVersion: appInfo.oftVersion,
            endpointVersion: appInfo.endpointVersion,
            oftSharedDecimals: appInfo.sharedDecimals,
            extensions
        };

        if (tokenInfo.fee) enriched.fee = tokenInfo.fee;

        results.push(enriched);
    }

    // attach bridgeInfo to main tokens in results
    for (const res of results) {
        const mainExtensions = res.extensions || {};
        const bridgeInfo = bridgeMap[res.address.toLowerCase() + res.chainKey];
        if (Object.keys(bridgeInfo || {}).length > 0) {
            res.extensions = mergeExtensions(mainExtensions, { bridgeInfo });
        }
    }

    // write outputs
    fs.writeFileSync('output/usableStargateTokens.json',
        JSON.stringify(results, null, 2));
    fs.writeFileSync('output/missingAdapters.json',
        JSON.stringify(missingAdapters, null, 2));

    console.log(`Done: ${results.length} enriched, ${missingAdapters.length} missing`);
}

main().catch(e => console.error(e));
