const fs = require('fs').promises
const { CHAIN_KEY_TO_ID, SUPPORTED_CHAINS } = require('../configs')

async function filterStargateTokens() {
  try {
    // Read tokens from tokens.json
    const data = await fs.readFile('output/stargate.json', 'utf-8')
    const tokens = JSON.parse(data)

    // Filter tokens: keep only bridgeable tokens that have a chainKey in the supportedChains list.
    // Also remove the "price" property.
    const filteredTokens = tokens
      .filter((token) => SUPPORTED_CHAINS.includes(token.chainKey))
      .filter((token) => token?.isBridgeable)
      .filter((token) => token?.address)
      .map((token) => {
        // Create a new token object without the "price" property
        const { price, isBridgeable, isVerified, ...rest } = token
        rest.chainId = CHAIN_KEY_TO_ID[token.chainKey] // Convert chain name to chain ID
        if (!rest.name) rest.name = token.symbol // Fallback to symbol if name is not available
        return rest
      })

    // Save the filtered tokens.
    await fs.writeFile('output/filteredStargateTokens.json', JSON.stringify(filteredTokens, null, 2))
    console.log('✅ Filtered tokens saved to output/filteredStargateTokens.json')
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

filterStargateTokens()
