require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');

const { OAPP_ABI, OFT_V3_ABI, OFT_V2_ABI, multiCallWithFallback } = require('../constants');

const TOKENS_FILE = 'output/usableStargateTokens.json';
const OUT_FILE = 'output/usableStargateTokensEnhanced.json';
const CHAINS_METADATA_FILE = 'output/ofts.json';

async function main() {
    // Load input data
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    const chainsMeta = JSON.parse(fs.readFileSync(CHAINS_METADATA_FILE, 'utf8'));

    // Build mappings / lookups
    const endpointIds = {};
    for (const [chainKey, meta] of Object.entries(chainsMeta)) {
        const validEids = (meta.deployments || []).map(d => parseInt(d.eid, 10)).filter(e => !isNaN(e));
        if (validEids.length) endpointIds[chainKey] = validEids;
    }

    // Annotate endpointId on tokens
    tokens.forEach(t => {
        const eids = endpointIds[t.chainKey] || [];
        const eid = eids[eids.length - 1] || 0;
        const base = parseInt(eid.toString().slice(2), 10) || eid;
        t.endpointId = (t.oftVersion === 3 || t.endpointVersion === 2) ? base + 30000 : base;
    });

    // Filter relevant tokens for fee info collection
    const feeInfoTokens = tokens.filter(t =>
        (t.fee || t.oftVersion === 3 || t.endpointVersion === 2 || t.oftVersion === 2) &&
        Array.isArray(endpointIds[t.chainKey])
    );

    // OFT Interface
    const ifaceV3 = new ethers.Interface(OFT_V3_ABI);
    const ifaceV2 = new ethers.Interface(OFT_V2_ABI);

    // Prepare multicall inputs for each relevant src-dst pair's fee info grouped by chain
    const feeInfoCallsByChain = {};
    for (const src of feeInfoTokens) {
        for (const dst of feeInfoTokens) {
            // skip self 
            if (src.address === dst.address && src.chainId === dst.chainId) continue;

            // skip if dst isn’t actually listed as a peer of src
            const peersInfo = src.extensions?.peersInfo || {};
            const peerEntry = peersInfo[dst.chainId];
            // peerEntry should exist and match dst.address
            if (!peerEntry || peerEntry.tokenAddress.toLowerCase() !== dst.address.toLowerCase()) {
                continue;
            }

            const chainKey = src.chainKey;

            let callData;
            if (src.oftVersion === 3 || src.endpointVersion === 2) {
                const sendParam = [
                    dst.endpointId,
                    ethers.zeroPadValue(dst.address, 32),
                    ethers.parseUnits('1', src.decimals),
                    ethers.parseUnits('0', src.decimals),
                    '0x', '0x', '0x'
                ];
                callData = ifaceV3.encodeFunctionData('quoteOFT', [sendParam]);
            } else {
                callData = ifaceV2.encodeFunctionData('quoteOFTFee', [dst.endpointId, ethers.parseUnits('1', src.decimals)]);
            }

            feeInfoCallsByChain[chainKey] ||= [];
            feeInfoCallsByChain[chainKey].push({ src, dst, callData });
        }
    }


    // Prepare minDstGas calls for each src-dst pair grouped by chain
    const minGasCallsByChain = {};
    const minGasIface = new ethers.Interface([
        'function minDstGasLookup(uint16 dstChainId,uint16 type) view returns (uint)'
    ]);
    for (const src of tokens) {
        for (const dst of tokens) {
            // skip self 
            if (src.address === dst.address && src.chainId === dst.chainId) continue;

            // skip if dst isn’t actually listed as a peer of src
            const peersInfo = src.extensions?.peersInfo || {};
            const peerEntry = peersInfo[dst.chainId];
            // peerEntry should exist and match dst.address
            if (!peerEntry || peerEntry?.tokenAddress?.toLowerCase() !== dst.address.toLowerCase()) {
                continue;
            }

            // Only relevant for OFT v1 and v2 (1.2)
            if (src.oftVersion === 3 || src.endpointVersion === 2) continue;

            const chainKey = src.chainKey;

            const callData = minGasIface.encodeFunctionData(
                'minDstGasLookup',
                [dst.endpointId, 0]
            );

            // initialize array if needed
            minGasCallsByChain[chainKey] ||= [];

            // push the new call
            minGasCallsByChain[chainKey].push({
                src,
                dst,
                callData
            });
        }
    }



    // Prepare isOApp calls for each token grouped by chain
    const isOAppCallsByChain = {};
    const oAppInterface = new ethers.Interface(OAPP_ABI);
    for (const src of tokens) {
        const chainKey = src.chainKey;

        const callData = src.oftVersion === 3 || src.endpointVersion === 2 ? oAppInterface.encodeFunctionData('endpoint', []) : oAppInterface.encodeFunctionData('lzEndpoint', []);

        isOAppCallsByChain[chainKey] ||= [];
        isOAppCallsByChain[chainKey].push({ src, callData});
    }

    // Output mapping for all fee related info
    const tokenFeeMap = {};

    // Merge all calls by chain
    const allChainKeys = new Set([
        ...Object.keys(feeInfoCallsByChain),
        ...Object.keys(minGasCallsByChain),
        ...Object.keys(isOAppCallsByChain)
    ]);

    // Multicall on each chain and decode outputs
    for (const chainKey of allChainKeys) {
        const feeCalls = feeInfoCallsByChain[chainKey].map(c => ({ target: c.src.oftAdapter, callData: c.callData }));
        const gasCalls = minGasCallsByChain[chainKey].map(c => ({ target: c.src.oftAdapter, callData: c.callData }));
        const oAppCalls = isOAppCallsByChain[chainKey].map(c => ({ target: c.src.oftAdapter, callData: c.callData }));

        // Batch both fee and gas calls together
        const aggregateCalls = feeCalls.concat(gasCalls).concat(oAppCalls);

        console.log(`==> Aggregating on ${chainKey}…`);
        // Use tryAggregate to allow individual call failures without reverting batch
        const returnData = (await multiCallWithFallback(chainKey, aggregateCalls))

        // Split results
        const feeData = returnData.slice(0, feeCalls.length);
        const gasData = returnData.slice(feeCalls.length, feeCalls.length + gasCalls.length);
        const oAppData = returnData.slice(feeCalls.length + gasCalls.length);

        // Process fee results
        feeData.forEach((hex, idx) => {
            const { src, dst } = feeInfoCallsByChain[chainKey][idx]

            // Skip empty return (call failed)
            if (!hex || hex === '0x') {
                console.warn(`Empty return data for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}, skipping decode.`);
                return;
            }

            tokenFeeMap[src.address + src.chainKey] ||= {};

            if (src.oftVersion === 3 || src.endpointVersion === 2) {
                const [, , receipt] = ifaceV3.decodeFunctionResult('quoteOFT', hex);
                const sent = BigInt(receipt.sent);
                const received = BigInt(receipt.received);
                const fee = sent > 0n ? ((sent - received) * 10000n) / sent : 10000n;
                if (fee > 0n) tokenFeeMap[src.address + src.chainKey][dst.chainId] = { oftFee: parseInt(fee) };
            } else {
                // For v2, quoteOFTFee returns a single uint256
                let feeBn;
                try {
                    [feeBn] = ifaceV2.decodeFunctionResult('quoteOFTFee', hex);
                } catch (err) {
                    console.warn(`Failed to decode v2 quoteOFTFee for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}:`, err.message);
                    return;
                }
                const feeAmount = BigInt(feeBn);
                const sent = ethers.parseUnits('1', src.decimals);
                const received = sent - feeAmount;
                const feeBips = sent > 0n ? ((sent - received) * 10000n) / sent : 10000n;

                if (feeBips > 0n) tokenFeeMap[src.address + src.chainKey][dst.chainId] = { oftFee: parseInt(feeBips) };
            }
        });

        // Process minDstGas results
        gasData.forEach((hex, idx) => {
            const { src, dst } = minGasCallsByChain[chainKey][idx];

            // Skip empty return (call failed)
            if (!hex || hex === '0x') {
                console.warn(`Empty minDstGas return data for ${src.oftAdapter} from ${src.chainKey} to ${dst.chainKey}, default values being used.`);
            }

            let gasValResult;

            try {
                const [gasVal] = minGasIface.decodeFunctionResult('minDstGasLookup', hex);
                gasValResult = gasVal && Number(gasVal) > 0 ? parseInt(gasVal) : dst.chainId === 42161 ? 2000000 : 200000;
            } catch {
                console.warn(`Failed to decode minDstGas for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}, default values being used:`, hex);
            }


            // Attach gas to feeInfo
            tokenFeeMap[src.address + src.chainKey] ||= {};
            tokenFeeMap[src.address + src.chainKey][dst.chainId] = {
                ...tokenFeeMap[src.address + src.chainKey][dst.chainId],
                minDstGas: gasValResult
            };
        });

        // Process isOApp results
        oAppData.forEach((hex, idx) => {
            let isOApp = true;

            const { src } = isOAppCallsByChain[chainKey][idx];

            if (!hex || hex === '0x' || src.symbol === 'USDC' || src.symbol === 'DAI' || src.symbol === 'WETH') {
                console.log("🚀 ~ oAppData.forEach ~ src:", src)
                console.warn(`Empty lzEndpoint return for ${src.chainKey} - ${src.oftAdapter}`);
                isOApp = false;
            }
            try {
                // No need to decode if already set as false due to no return
                if (hex && hex !== '0x') {
                    const [endpointAddr] = oAppInterface.decodeFunctionResult('lzEndpoint', hex);
                    isOApp = endpointAddr && endpointAddr !== '' && endpointAddr !== '0x';
                }
                // If it is not an OApp, remove OFT specific fields
                if (!isOApp) {
                    console.warn(`Not an OApp for ${src.symbol}: ${src.chainKey} - ${src.oftAdapter}`);
                    // Update tokens to reflect it is not an OFT
                    const tokenIndex = tokens.findIndex(t => t.chainKey === src.chainKey && t.address === src.address);
                    if (tokenIndex === -1) {
                        console.warn(`Token not found for ${src.address} on ${src.chainKey}`);
                    } else {
                        console.warn(`Removing OFT specific fields for ${src.symbol}: ${src.chainKey} - ${src.oftAdapter}`);
                        // Remove OFT specific fields
                        if (tokens[tokenIndex]?.oftVersion) delete tokens[tokenIndex].oftVersion;
                        if (tokens[tokenIndex]?.endpointVersion) delete tokens[tokenIndex].endpointVersion;
                        if (tokens[tokenIndex]?.oftAdapter) delete tokens[tokenIndex].oftAdapter;
                        if (tokens[tokenIndex]?.endpointId) delete tokens[tokenIndex].endpointId;
                        if (tokens[tokenIndex]?.oftSharedDecimals) delete tokens[tokenIndex].oftSharedDecimals;
                        if (tokens[tokenIndex]?.extensions) {
                            if (tokens[tokenIndex]?.extensions?.feeInfo) delete tokens[tokenIndex].extensions?.feeInfo;
                            if (tokens[tokenIndex]?.extensions?.peersInfo) delete tokens[tokenIndex].extensions?.peersInfo;
                        }
                        if (tokens[tokenIndex]?.isBridgeable) delete tokens[tokenIndex].isBridgeable;
                        // Set isOFT to false
                        tokens[tokenIndex].isOFT = false;
                    }
                }
            } catch (e) {
                console.warn(`Failed to decode lzEndpoint for ${src.chainKey}:`, e.message);
            }
        });
    }

    // Merge and validate extensions
    const enhanced = tokens.map(t => {

        const existingExt = t.extensions || undefined;
        let bridgeInfo = existingExt.bridgeInfo || undefined;
        let feeInfo = tokenFeeMap[t.address + t.chainKey] || undefined;


        // If no feeInfo and no bridgeInfo, return original token
        if (!bridgeInfo && !feeInfo) {
            return t;
        }

        // Remove self-references: token's own chain
        const selfChain = t.chainId.toString();
        if (bridgeInfo?.[selfChain]) delete bridgeInfo[selfChain];
        if (feeInfo?.[selfChain]) delete feeInfo[selfChain];

        // TODO: Get peers dynamically from contracts instead of relying on layerzero metadata

        // // If only 1 bridgeInfo we go check if that token has useful bridgeInfo since it may be main token
        // if (bridgeInfo && Object.keys(bridgeInfo).length === 1) {
        //     const [[bridgeChainIdStr, { tokenAddress }]] = Object.entries(bridgeInfo);
        //     const bridgeChainId = parseInt(bridgeChainIdStr);

        //     const mainToken = tokens.find(m => m.address.toLowerCase() === tokenAddress.toLowerCase() && m.chainId === bridgeChainId)

        //     if (mainToken) {
        //         const extraBridgeInfo = mainToken.extensions.bridgeInfo || undefined
        //         if (extraBridgeInfo) {
        //             bridgeInfo = { ...bridgeInfo, ...extraBridgeInfo }
        //         }
        //     }
        // }

        // // Make sure we haven't reintroduced self, remove self-references
        // if (bridgeInfo?.[selfChain]) delete bridgeInfo[selfChain];

        // Populate missing OFT fields
        if (t.isOFT !== false) {
            // If endpointVersion === 2 and there is no field for oftVersion we should populate it as version 3
            if (!("oftVersion" in t) && t.endpointVersion === 2) t.oftVersion = 3;
            // If oftVersion === 2 and there is no field for endpointVersion we should populate it as version 1
            if (t.oftVersion === 2 && (!("endpointVersion" in t))) t.endpointVersion = 1;
            // If there is no field for endpointVersion and oftVersion we should populate them as version 1
            if (!("oftVersion" in t) && (!("endpointVersion" in t))) { t.oftVersion = 1; t.endpointVersion = 1; }
        }


        // Update extensions
        if (bridgeInfo) existingExt.bridgeInfo = bridgeInfo;
        if (t.isOFT !== false && feeInfo) existingExt.feeInfo = feeInfo;

        // Fix for error in Layer Zero Metadata
        if (t?.address === '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' && t?.chainId === 42161) t.oftAdapter = '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92'


        return {
            ...t,
            isOFT: t.isOFT === false ? false : true,
            extensions: {
                ...existingExt,
            }
        };
    });


    // Remove empty extensions.feeInfo and extensions.bridgeInfo
    for (const token of enhanced) {
        if (token?.extensions && Object.keys(token.extensions).length === 0) {
            delete token.extensions;
        }
        if (token?.extensions?.feeInfo && Object.keys(token.extensions.feeInfo).length === 0) {
            delete token.extensions.feeInfo;
        }
        if (token?.extensions?.bridgeInfo && Object.keys(token.extensions.bridgeInfo).length === 0) {
            delete token.extensions.bridgeInfo;
        }
    }

    fs.writeFileSync(OUT_FILE, JSON.stringify(enhanced, null, 2));
    console.log(`Enhanced tokens saved to ${OUT_FILE}`);
}

main().catch(console.error);