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
    console.log(`Tokens data saved to output/${name}.json`);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Write the across mapping (TOKEN_SYMBOLS_MAP) to across.json.
 */
async function writeAcrossMapping() {
  try {
    // Write the TOKEN_SYMBOLS_MAP object to across.json with pretty printing.
    await fs.writeFile('output/across.json', JSON.stringify(TOKEN_SYMBOLS_MAP, null, 2));
    console.log('Across mapping saved to output/across.json');
  } catch (error) {
    console.error('Error writing across mapping:', error);
  }
}

/**
 * Main function to fetch token lists and write across mapping.
 */
(async () => {
  await fetchList('https://stargate.finance/api/tokens', 'stargate');
  await fetchList('https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/default-tokenlist.json', 'ulysses');
  await fetchList('https://tokens.uniswap.org', 'uniswap');
  await writeAcrossMapping();
})();