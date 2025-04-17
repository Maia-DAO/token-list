const fs = require('fs').promises;

async function filterStargateTokens() {
    try {
        // Read tokens from tokens.json
        const data = await fs.readFile('output/stargate.json', 'utf-8');
        const tokens = JSON.parse(data);

        // Supported chains List.
        const supportedChains = ['ethereum', 'arbitrum', 'base', 'bsc', 'bera', 'optimism', 'metis', 'avalanche', 'sonic']; 

        // Mapping of chain name to chain ID
        const chainKeyToId = {
            ethereum: 1,
            arbitrum: 42161,
            base: 8453,
            bsc: 56,
            bera: 80094,
            optimism: 10,
            metis: 1088,
            avalanche: 43114,
            sonic: 146
        };

        // Filter tokens: keep only bridgeable tokens that have a chainKey in the supportedChains list.
        // Also remove the "price" property.
        const filteredTokens = tokens
            .filter(token => supportedChains.includes(token.chainKey))
            .filter(token => token?.isBridgeable)
            .filter(token => token?.address)
            .map(token => {
                // Create a new token object without the "price" property
                const { price, ...rest } = token;
                rest.chainId = chainKeyToId[token.chainKey]; // Convert chain name to chain ID
                return rest;
            });

        // Save the filtered tokens.
        await fs.writeFile('output/filteredStargateTokens.json', JSON.stringify(filteredTokens, null, 2));
        console.log('Filtered tokens saved to output/filteredStargateTokens.json');
    } catch (error) {
        console.error('Error:', error);
    }
}

filterStargateTokens();
