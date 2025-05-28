const fs = require('fs');
const { ethers } = require('ethers');

// Supported chains List.
const SUPPORTED_CHAINS = ['ethereum', 'arbitrum', 'base', 'bsc', 'bera', 'optimism', 'metis', 'avalanche', 'sonic', 'polygon'];

// map chainId to key in ofts.json
const CHAIN_KEYS = {
    1: 'ethereum',
    42161: 'arbitrum',
    8453: 'base',
    56: 'bsc',
    80094: 'bera',
    10: 'optimism',
    1088: 'metis',
    43114: 'avalanche',
    146: 'sonic',
    137: 'polygon',
};

// Mapping of chain name to chain ID
const CHAIN_KEY_TO_ID = {
    ethereum: 1,
    arbitrum: 42161,
    base: 8453,
    bsc: 56,
    bera: 80094,
    optimism: 10,
    metis: 1088,
    avalanche: 43114,
    sonic: 146,
    polygon: 137
};

// Override Stargate Peg
const OVERRIDE_PEG = {
    'USD₮0': { chainName: 'arbitrum', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
};

const OVERRIDE_URI = {
    'FRAX': 'https://assets.coingecko.com/coins/images/13423/standard/frax.png?1745921071',
};

const ERC20_MINIMAL_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

const OAPP_ABI = [
    'function endpoint() view returns (address)',
    'function lzEndpoint() view returns (address)',
];

const OFT_V3_ABI = [
    'function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256 nativeFee,uint256 lzTokenFee),(int256,string)[],(uint256 sent,uint256 received))',
    "function sharedDecimals() view returns (uint8)"
];
const OFT_V2_ABI = [
    'function quoteOFTFee(uint16 dstChainId,uint256 amount) view returns (uint256 fee)',
    "function sharedDecimals() view returns (uint8)"
];
const MULTICALL3_ABI = [
    'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool,bytes)[])'
];

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

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

// TODO: Update once non-EVM chains are supported
function cleanAddress(input) {
    if (typeof input !== 'string') return undefined;
    const trimmed = input.trim().toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : undefined;
}

async function multiCallWithFallback(chainKey, calls, batchSize = undefined, delayMs = 250) {
    const chainsMeta = JSON.parse(fs.readFileSync('output/ofts.json', 'utf8'));

    // Build mappings / lookups
    const rpcUrls = {};
    for (const [chainKey, meta] of Object.entries(chainsMeta)) {
        if (Array.isArray(meta.rpcs) && meta.rpcs.length) rpcUrls[chainKey] = meta.rpcs[0].url;
    }

    // Fetch missing RPC URLs
    const allChains = await fetch('https://chainid.network/chains.json').then(r => r.json());
    // build a map: chainId → first RPC URL
    const extraRpcMap = Object.fromEntries(
        allChains.map(c => [c.chainId, c.rpc[0]])
    );

    // build RPC list
    const rpcList = [];
    if (rpcUrls[chainKey]) rpcList.push(rpcUrls[chainKey]);
    const extra = extraRpcMap[CHAIN_KEY_TO_ID[chainKey]];
    if (extra) rpcList.push(extra);
    if (!rpcList.length) throw new Error(`No RPC URLs available for chain ${chainKey}`);

    const BATCH = batchSize || calls.length;

    for (const rpcUrl of rpcList) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);  // specify chainKey to help provider detect network
            const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
            const returnData = [];

            for (let i = 0; i < calls.length; i += BATCH) {
                const slice = calls.slice(i, i + BATCH).map(c => ({ target: c.target, callData: c.callData }));
                const results = await mc.tryAggregate(false, slice);
                for (const [success, data] of results) {
                    if (!success) console.warn(`Multicall sub-call failed on ${chainKey}`);
                    returnData.push(data);
                }
                if (i + BATCH < calls.length) await new Promise(r => setTimeout(r, delayMs));
            }

            return returnData;
        } catch (err) {
            console.warn(`RPC ${rpcUrl} failed for chain ${chainKey}: ${err.message}`);
            // try next rpcUrl
        }
    }

    throw new Error(`All RPC endpoints failed for chain ${chainKey}`);
}


module.exports = { CHAIN_KEYS, CHAIN_KEY_TO_ID, SUPPORTED_CHAINS, OVERRIDE_PEG, OVERRIDE_URI, OAPP_ABI, OFT_V3_ABI, OFT_V2_ABI, MULTICALL3_ABI, MULTICALL3_ADDRESS, multiCallWithFallback, ERC20_MINIMAL_ABI, mergeExtensions, cleanAddress };