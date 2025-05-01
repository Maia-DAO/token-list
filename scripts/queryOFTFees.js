const fs = require('fs');
const { ethers } = require('ethers');

// --- Configuration ---
const TOKENS_FILE = 'output/usableStargateTokens.json';
const OUT_FILE = 'output/usableStargateTokensEnhanced.json';
const CHAINS_METADATA_FILE = 'output/ofts.json';
// ABI definitions
const OFT_ABI = [
    'function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256,uint256),(int256,string)[],(uint256,uint256))'
];
const MULTICALL3_ABI = [
    'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)'
];
// Multicall3 address is the same on all EVM chains
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
        const validEids = (meta.deployments || [])
            .map(d => parseInt(d.eid, 10))
            .filter(e => !isNaN(e));
        if (validEids.length) endpointIds[chainKey] = validEids;
    }

    // Annotate tokens with endpointId
    tokens.forEach(t => {
        const eids = endpointIds[t.chainKey] || [];
        const eid = eids[eids.length - 1] || 0;
        const base = parseInt(eid.toString().slice(2), 10) || eid;
        t.endpointId = (t.oftVersion === 3 || t.endpointVersion === 2)
            ? base + 30000
            : base;
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
        (t.oftVersion === 3 || t.endpointVersion === 2) &&
        rpcUrls[t.chainKey] &&
        Array.isArray(endpointIds[t.chainKey])
    );

    // Group by source chain
    const callsByChain = {};
    const iface = new ethers.Interface(OFT_ABI);

    for (const src of relevant) {
        for (const dst of relevant) {
            if (src.chainId === dst.chainId) continue;
            if (src.symbol !== dst.symbol) continue;

            const chainKey = src.chainKey;
            const providerUrl = rpcUrls[chainKey];
            if (!providerUrl) continue;
            const sendParam = [
                src.endpointId,
                ethers.zeroPadValue(dst.address, 32),
                ethers.parseUnits('1', src.decimals),
                ethers.parseUnits('0', src.decimals),
                '0x', '0x', '0x'
            ];
            const callData = iface.encodeFunctionData('quoteOFT', [sendParam]);
            callsByChain[chainKey] ||= [];
            callsByChain[chainKey].push({ src, dst, callData, providerUrl });
        }
    }

    // Execute multicall per chain
    const tokenFeeMap = {};

    for (const [chainKey, calls] of Object.entries(callsByChain)) {
        const provider = new ethers.JsonRpcProvider(calls[0].providerUrl);
        const mcContract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
        const aggregateCalls = calls.map(c => ({ target: c.src.oftAdapter, callData: c.callData }));

        console.log(`==> Quoting All Routes for ${chainKey}...`);
        const [, returnData] = await mcContract.aggregate(aggregateCalls);
        // Decode and assign
        returnData.forEach((hex, idx) => {
            const { src, dst } = calls[idx];
            console.log(`Decoding quote for ${src.symbol} from ${src.chainKey} to ${dst.chainKey}...`);
            const [limits, , receipt] = iface.decodeFunctionResult('quoteOFT', hex);
            const sent = BigInt(receipt[0]);
            const received = BigInt(receipt[1]);
            const feeBips = sent > 0n ? ((sent - received) * 10000n) / sent : 10000n;
            console.log(`Fee: ${feeBips} bps`);
            tokenFeeMap[src.address + src.chainKey] ||= {};
            tokenFeeMap[src.address + src.chainKey][dst.chainId] = {
                oftFee: parseInt(feeBips.toString()),
                oftMinAmount: limits[0].toString(),
                oftMaxAmount: limits[1].toString()
            };
        });
    }

    // Annotate tokens, ensuring bridgeInfo and feeInfo align
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


    // Write out
    fs.writeFileSync(OUT_FILE, JSON.stringify(enhanced, null, 2));
    console.log(`Enhanced tokens saved to ${OUT_FILE}`);
}

main().catch(console.error);
