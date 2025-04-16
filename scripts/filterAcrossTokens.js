const fs = require('fs').promises;

async function filterAcrossTokens() {
    try {
        // Read across tokens from across.json 
        const data = await fs.readFile('output/across.json', 'utf-8');
        const tokens = JSON.parse(data);

        // Supported chain numbers 
        const supportedChains = [1, 42161, 8453, 56, 80094, 10, 1088, 43114, 146];

        // Create an output object with filtered addresses per token.
        const filteredAcross = {};

        // Iterate over each token in across.json.
        for (const symbol in tokens) {
            if (tokens.hasOwnProperty(symbol)) {
                const token = tokens[symbol];
                // Filter the addresses: only keep keys that are in the supportedChains array.
                const filteredAddresses = {};
                for (const chain in token.addresses) {
                    if (supportedChains.includes(Number(chain))) {
                        filteredAddresses[chain] = token.addresses[chain];
                    }
                }
                // Only include token if it has at least one supported address.
                if (Object.keys(filteredAddresses).length > 0) {
                    filteredAcross[symbol] = {
                        ...token,
                        addresses: filteredAddresses
                    };
                }
            }
        }

        // Write the filtered tokens to filteredAcrossTokens.json.
        await fs.writeFile('output/filteredAcrossTokens.json', JSON.stringify(filteredAcross, null, 2));
        console.log('Filtered across tokens saved to output/filteredAcrossTokens.json');
    } catch (error) {
        console.error('Error:', error);
    }
}

filterAcrossTokens();
