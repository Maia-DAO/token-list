require('dotenv').config();
const fs = require('fs').promises;
const { TOKEN_SYMBOLS_MAP } = require('@across-protocol/constants')

/**
 * Fetch token data from a given URL and write it to an output file.
 *
 * @param {string} url - The URL to fetch token data from.
 * @param {string} name - The name used to create the output filename.
 */
async function fetchList(url, name) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching data from ${url}: ${response.statusText}`);
    }
    const tokens = await response.json();

    await fs.writeFile(`output/${name}.json`, JSON.stringify(tokens, null, 2));
    console.log(`✅ Tokens data saved to output/${name}.json`);
  } catch (error) {
    console.error(`❌ Error fetching ${name} list:`, error);
  }
}

/**
 * Write the across mapping (TOKEN_SYMBOLS_MAP) to across.json.
 */
async function writeAcrossMapping() {
  try {
    // Write the TOKEN_SYMBOLS_MAP object to across.json with pretty printing.
    await fs.writeFile('output/across.json', JSON.stringify(TOKEN_SYMBOLS_MAP, null, 2));
    console.log('✅ Tokens data saved to output/across.json');
  } catch (error) {
    console.error('❌ Error writing across mapping:', error);
  }
}

/**
 * Main function to fetch token lists and write across mapping.
 */
(async () => {
  // Active Lists
  await fetchList('https://stargate.finance/api/tokens', 'stargate');
  await fetchList(process.env.STARGATE_API, 'ofts');
  await fetchList('https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/default-tokenlist.json', 'ulysses');
  await fetchList('https://tokens.uniswap.org', 'uniswap');
  await writeAcrossMapping();

  // Inactive Lists
  await fetchList('https://extendedtokens.uniswap.org', 'uni_extended');
  await fetchList('https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json', 'compound');
  await fetchList('https://raw.githubusercontent.com/SetProtocol/uniswap-tokenlist/main/set.tokenlist.json', 'set');
  await fetchList('https://raw.githubusercontent.com/The-Blockchain-Association/sec-notice-list/master/ba-sec-list.json', 'ba');

})();