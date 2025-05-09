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

module.exports = { CHAIN_KEYS, CHAIN_KEY_TO_ID, SUPPORTED_CHAINS, OVERRIDE_PEG };