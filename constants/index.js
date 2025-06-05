const fs = require('fs');
const { ethers } = require('ethers');

const {
    networkToEndpointId,
    chainAndStageToNetwork,
    endpointIdToVersion,
    EndpointVersion,
    EndpointId,
    Stage,
} = require('@layerzerolabs/lz-definitions')

// Supported chains List.
const SUPPORTED_CHAINS = ['ethereum', 'arbitrum', 'base', 'bsc', 'bera', 'optimism', 'metis', 'avalanche', 'sonic', 'polygon', 'swell', 'fraxtal'];

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
    1923: 'swell',
    252: 'fraxtal'
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
    polygon: 137,
    swell: 1923,
    fraxtal: 252
};

// Convert chain name to endpoint ID
const CHAIN_KEY_TO_EID = {
    ethereum: { v1: networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V2) },
    arbitrum: { v1: networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V2) },
    base: { v1: networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V2) },
    bsc: { v1: networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V2) },
    bera: { v1: networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V2) },
    optimism: { v1: networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V2) },
    metis: { v1: networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V2) },
    avalanche: { v1: networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V2) },
    sonic: { v1: networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V2) },
    polygon: { v1: networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V2) },
    swell: { v1: networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V2) },
    fraxtal: { v1: networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V1), v2: networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V2) }
};

// Convert eid to version
const EID_TO_VERSION = {
    [networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('ethereum', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('arbitrum', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('base', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('bsc', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('bera', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('optimism', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('metis', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('avalanche', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('sonic', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('polygon', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('swell', Stage.MAINNET), EndpointVersion.V2)]: 2,
    [networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V1)]: 1,
    [networkToEndpointId(chainAndStageToNetwork('fraxtal', Stage.MAINNET), EndpointVersion.V2)]: 2
};

// Override Stargate Peg
const OVERRIDE_PEG = {
    'USD₮0': { chainName: 'arbitrum', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' },
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
    'function send((uint32 dstChainId,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress) payable returns ((bytes32 guid,uint64 nonce,(uint256 nativeFee,uint256 lzTokenFee)),(uint256 amountSentLD,uint256 amountReceivedLD))',
    'function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256 nativeFee,uint256 lzTokenFee),(int256,string)[],(uint256 sent,uint256 received))',
    "function sharedDecimals() view returns (uint8)",
    "function peers(uint32) view returns (bytes32)"
];
const OFT_V2_ABI = [
    'function sendFrom(address from,uint16 dstChainId,bytes32 toAddress,uint256 amount,(address payable refundAddress,address zroPaymentAddress,bytes adapterParams)) payable',
    'function quoteOFTFee(uint16 dstChainId,uint256 amount) view returns (uint256 fee)',
    "function sharedDecimals() view returns (uint8)",
    "function getTrustedRemoteAddress(uint16) view returns (bytes)"
];

const OFT_V1_ABI = [
    'function sendFrom(address from,uint16 dstChainId,bytes toAddress,uint256 amount,address payable refundAddress,address zroPaymentAddress,bytes adapterParams) payable',
]

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
        if (Array.isArray(meta.rpcs) && meta.rpcs.length) rpcUrls[chainKey] = meta.rpcs.map(rpc => rpc.url);
    }

    // Fetch missing RPC URLs
    const allChains = await fetch('https://chainid.network/chains.json').then(r => r.json());
    // build a map: chainId → all RPC URLs
    const extraRpcMap = Object.fromEntries(
        allChains.map(c => [c.chainId, c.rpc])
    );

    // build RPC list
    const rpcList = [];
    if (rpcUrls[chainKey]) rpcList.push(...rpcUrls[chainKey]);
    const extra = extraRpcMap[CHAIN_KEY_TO_ID[chainKey]];
    if (extra) rpcList.push(...extra);
    if (!rpcList.length) throw new Error(`No RPC URLs available for chain ${chainKey}`);

    const BATCH = batchSize || calls.length;

    for (const rpcUrl of rpcList) {
        let provider
        try {
            provider = new ethers.JsonRpcProvider(rpcUrl, null, {
                skipFetchSetup: true,
                batchMaxCount: 1
            });
            const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
            const returnData = [];

            let failedCalls = 0;

            for (let i = 0; i < calls.length; i += BATCH) {
                const slice = calls.slice(i, i + BATCH).map(c => ({ target: c.target, callData: c.callData }));
                const results = await mc.tryAggregate(false, slice);
                for (const [success, data] of results) {
                    if (!success) failedCalls++;
                    returnData.push(data);
                }
                if (i + BATCH < calls.length) await new Promise(r => setTimeout(r, delayMs));
            }

            console.warn(`${failedCalls} of ${calls.length} Multicall sub-calls failed on ${chainKey}`);
            return returnData;
        } catch (err) {
            console.warn(`RPC ${rpcUrl} failed for chain ${chainKey}: ${err.message}`);
            // try next rpcUrl
        } finally {
            if (provider && typeof provider.destroy === 'function') {
                try { provider.destroy(); } catch { }
            }
        }
    }

    throw new Error(`All RPC endpoints failed for chain ${chainKey}`);
}


module.exports = { CHAIN_KEYS, CHAIN_KEY_TO_ID, CHAIN_KEY_TO_EID, EID_TO_VERSION, SUPPORTED_CHAINS, OVERRIDE_PEG, OAPP_ABI, OFT_V3_ABI, OFT_V2_ABI, OFT_V1_ABI, MULTICALL3_ABI, MULTICALL3_ADDRESS, multiCallWithFallback, ERC20_MINIMAL_ABI, mergeExtensions, cleanAddress };