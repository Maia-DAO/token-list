require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');

const OAPP_ABI = [
    'function lzEndpoint() view returns (address)',
];

const OFT_V3_ABI = [
    'function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256 nativeFee,uint256 lzTokenFee),(int256,string)[],(uint256 sent,uint256 received))'
];
const OFT_V2_ABI = [
    'function quoteOFTFee(uint16 dstChainId,uint256 amount) view returns (uint256 fee)'
];
const MULTICALL3_ABI = [
    'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool,bytes)[])'
];

const TOKENS_FILE = 'output/usableStargateTokens.json';
const OUT_FILE = 'output/usableStargateTokensEnhanced.json';
const CHAINS_METADATA_FILE = 'output/ofts.json';
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

async function main() {
    // Load data
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    const chainsMeta = JSON.parse(fs.readFileSync(CHAINS_METADATA_FILE, 'utf8'));

    // Build lookups
    const rpcUrls = {};
    const endpointIds = {};
    for (const [chainKey, meta] of Object.entries(chainsMeta)) {
        if (Array.isArray(meta.rpcs) && meta.rpcs.length) rpcUrls[chainKey] = meta.rpcs[0].url;
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

    // Fetch missing RPC URLs
    const allChains = await fetch('https://chainid.network/chains.json').then(r => r.json());
    // build a map: chainId → first RPC URL
    const extraRpcMap = Object.fromEntries(
        allChains.map(c => [c.chainId, c.rpc[0]])
    );

    // Later, when filling rpcUrls:
    for (const t of tokens) {
        if (rpcUrls[t.chainKey]) continue;
        const nativeId = t.chainId;
        if (nativeId && extraRpcMap[nativeId]) {
            rpcUrls[t.chainKey] = extraRpcMap[nativeId];
        }
    }


    // Filter relevant tokens
    const relevant = tokens.filter(t =>
        (t.fee || t.oftVersion === 3 || t.endpointVersion === 2 || t.oftVersion === 2) &&
        rpcUrls[t.chainKey] &&
        Array.isArray(endpointIds[t.chainKey])
    );

    // Prepare multicall inputs grouped by chainKey
    const callsByChain = {};
    const ifaceV3 = new ethers.Interface(OFT_V3_ABI);
    const ifaceV2 = new ethers.Interface(OFT_V2_ABI);
    for (const src of relevant) {
        for (const dst of relevant) {
            if (src.address === dst.address && src.chainId === dst.chainId) continue;
            if (src.symbol !== dst.symbol) continue;
            const chainKey = src.chainKey;
            const providerUrl = rpcUrls[chainKey];
            if (!providerUrl) continue;

            let callData;
            if (src.oftVersion === 3 || src.endpointVersion === 2) {
                const sendParam = [
                    src.endpointId,
                    ethers.zeroPadValue(dst.address, 32),
                    ethers.parseUnits('1', src.decimals),
                    ethers.parseUnits('0', src.decimals),
                    '0x', '0x', '0x'
                ];
                callData = ifaceV3.encodeFunctionData('quoteOFT', [sendParam]);
            } else {
                callData = ifaceV2.encodeFunctionData('quoteOFTFee', [dst.endpointId, ethers.parseUnits('1', src.decimals)]);
            }

            callsByChain[chainKey] ||= [];
            callsByChain[chainKey].push({ src, dst, callData, providerUrl });
        }
    }

    // Execute multicalls and build fee map
    const tokenFeeMap = {};
    const minGasCallsByChain = {};

    // Also prepare minDstGas calls: for each src-dst pair
    for (const src of tokens) {
        for (const dst of tokens) {
            // skip self and mismatched symbols if you still need that guard
            if (src.address === dst.address && src.chainId === dst.chainId) continue;
            if (src.symbol !== dst.symbol) continue;
            if (src.oftVersion === 3 || src.endpointVersion === 2) continue;

            const chainKey = src.chainKey;
            const providerUrl = rpcUrls[chainKey];
            if (!providerUrl) continue;

            // encode the gas lookup
            const minGasIface = new ethers.Interface([
                'function minDstGasLookup(uint16 dstChainId,uint16 type) view returns (uint)'
            ]);
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
                callData,
                providerUrl
            });
        }
    }

    const isOApp = {};
    const isOAppCallsByChain = {};
    const oAppInterface = new ethers.Interface(OAPP_ABI);

    // Check if the source is an OApp
    for (const src of tokens) {
        const chainKey = src.chainKey;
        const providerUrl = rpcUrls[chainKey];
        if (!providerUrl) continue;

        const callData = oAppInterface.encodeFunctionData('lzEndpoint', []);

        isOAppCallsByChain[chainKey] ||= [];
        isOAppCallsByChain[chainKey].push({ src, callData, providerUrl });
    }

    const mcIface = new ethers.Interface(MULTICALL3_ABI);
    for (const [chainKey, calls] of Object.entries(callsByChain)) {
        const provider = new ethers.JsonRpcProvider(calls[0].providerUrl);
        const mcContract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
        const feeCalls = calls.map(c => ({ target: c.src.oftAdapter, callData: c.callData }));
        const gasCalls = minGasCallsByChain[chainKey].map(c => ({ target: c.src.oftAdapter, callData: c.callData }));

        // batch both fee and gas calls together
        const aggregateCalls = feeCalls.concat(gasCalls);

        console.log(`==> Aggregating on ${chainKey}…`);
        // Use tryAggregate to allow individual call failures without reverting batch
        const returnData = (await mcContract.tryAggregate(false, aggregateCalls))
            .map(res => {
                // res is [success, returnData]
                const success = res[0];
                const data = res[1];
                if (!success) {
                    console.warn(`Multicall sub-call failed for ${chainKey}`);
                }
                return data;
            });

        // split results
        const feeData = returnData.slice(0, feeCalls.length);
        const gasData = returnData.slice(feeCalls.length);

        // process fee results
        feeData.forEach((hex, idx) => {
            const { src, dst } = calls[idx];
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

                if (feeBips > 0) tokenFeeMap[src.address + src.chainKey][dst.chainId] = { oftFee: parseInt(feeBips) };
            }
        });

        // process minDstGas results
        gasData.forEach((hex, idx) => {
            const { src, dst } = minGasCallsByChain[chainKey][idx];

            // Skip empty return (call failed)
            if (!hex || hex === '0x') {
                console.warn(`Empty minDstGas return data for ${src.oftAdapter} from ${src.chainKey} to ${dst.chainKey}, default values being used.`);
            }

            let gasVal = dst.chainId === 42161 ? 2000000 : 200000;
            try {
                [gasVal] = new ethers.Interface([
                    'function minDstGasLookup(uint16 dstChainId,uint16 type) view returns (uint)'
                ]).decodeFunctionResult('minDstGasLookup', hex);
            } catch {
                console.warn(`Failed to decode minDstGas for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}, default values being used:`, hex);
            }
            // attach gas to feeInfo
            tokenFeeMap[src.address + src.chainKey] ||= {};
            tokenFeeMap[src.address + src.chainKey][dst.chainId] = {
                ...tokenFeeMap[src.address + src.chainKey][dst.chainId],
                minDstGas: parseInt(gasVal)
            };
        });

        // process isOApp results
        const oCalls = isOAppCallsByChain[chainKey] || [];
        if (oCalls.length) {
            const calls = oCalls.map(c => ({ target: c.src.oftAdapter, callData: c.callData }));
            console.log(`==> Checking isOApp on ${chainKey}…`);
            const results = (await mcContract.tryAggregate(false, calls))
                .map(r => r[1] || '0x');

            results.forEach((hex, idx) => {
                let isOApp = {}

                const src = oCalls[idx].src;
                if (!hex || hex === '0x') {
                    console.warn(`Empty lzEndpoint return for ${src.chainKey} - ${src.oftAdapter}`);
                    isOApp[src.address] = false;
                }
                try {
                    // No need to decode if already set as false due to no return
                    if (hex && hex !== '0x') {
                        const [endpointAddr] = oAppInterface.decodeFunctionResult('lzEndpoint', hex);
                        isOApp[src.address] = endpointAddr && endpointAddr !== '' && endpointAddr !== '0x';
                    }
                    // If it is not an OApp, remove OFT specific fields
                    if (!isOApp[src.address]) {
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
    }

    // Merge and validate extensions
    const enhanced = tokens.map(t => {

        // Skip tokens that are not OFT
        if (!t.isOFT) {
            return t;
        }

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


        // Update extensions
        if (bridgeInfo) existingExt.bridgeInfo = bridgeInfo;
        if (feeInfo) existingExt.feeInfo = feeInfo;

        return {
            ...t,
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
