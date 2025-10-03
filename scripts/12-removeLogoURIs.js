const fs = require('fs').promises
const path = require('path')
const { ZERO_ADDRESS } = require('maia-core-sdk')

const { CHAIN_KEYS, CORE_TOKEN_SYMBOLS } = require('../configs')

const MINIMUM_LIQUIDITY = 10_000
const BATCH_SIZE = 5
const REQUEST_DELAY = 1000

  /**
   * Load token lists from JSON files
   */
  async function loadTokenLists() {
    console.log('Loading token lists...')
    const [tokenList, inactiveTokenList] = await Promise.all([
      JSON.parse(await fs.readFile('token-list.json', 'utf8')),
      JSON.parse(await fs.readFile('inactive-token-list.json', 'utf8')),
    ])

    return { tokenList, inactiveTokenList }
  }

// Main execution function
async function main() {

  // Load token lists
  const { tokenList, inactiveTokenList } = await loadTokenLists()

  // Save backup 
  await Promise.all([
    fs.writeFile('token-list-with-logos.json', JSON.stringify(tokenList, null, 2)),
    fs.writeFile('inactive-token-list-with-logos.json', JSON.stringify(inactiveTokenList, null, 2))
  ])

  // Remove logoURI from each token in the token list
  tokenList.tokens.forEach(token => {
    delete token.logoURI
  })

  // Remove logoURI from each token in the inactive token list
  inactiveTokenList.tokens.forEach(token => {
    delete token.logoURI
  })

  // Save the updated token lists back to their files
  await Promise.all([
    fs.writeFile('token-list.json', JSON.stringify(tokenList, null, 2)),
    fs.writeFile('inactive-token-list.json', JSON.stringify(inactiveTokenList, null, 2))
  ])

  console.log('logoURI fields removed and token lists updated.')

}

main()
