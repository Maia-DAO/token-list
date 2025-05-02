require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');

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
            if (src.address === dst.address || src.symbol !== dst.symbol) continue;
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
    const mcIface = new ethers.Interface(MULTICALL3_ABI);
    for (const [chainKey, calls] of Object.entries(callsByChain)) {
        const provider = new ethers.JsonRpcProvider(calls[0].providerUrl);
        const mcContract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
        const aggregateCalls = calls.map(c => ({ target: c.src.oftAdapter, callData: c.callData }));

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

        returnData.forEach((hex, idx) => {
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
