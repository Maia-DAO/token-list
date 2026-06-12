require('dotenv').config()
const fs = require('fs').promises
const { Agent, fetch: undiciFetch } = require('undici')

const ipv4Agent = new Agent({ connect: { family: 4 } }) // force IPv4 (fix connection errors)

// Tracks logo HEAD checks so the end-of-run guard can detect environment-wide network failures
const logoCheckStats = { attempted: 0, networkErrors: 0 }

/**
 * HEAD-check a logo URL using the shared IPv4 undici agent. Never throws.
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function checkLogoUrl(url, timeoutMs = 10_000) {
  logoCheckStats.attempted++
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await undiciFetch(url, { method: 'HEAD', dispatcher: ipv4Agent, signal: ac.signal })
    return res.ok ? { ok: true } : { ok: false, reason: `logoURI returned ${res.status}` }
  } catch (err) {
    logoCheckStats.networkErrors++
    const reason = err.name === 'AbortError'
      ? `logoURI HEAD check timed out after ${timeoutMs}ms`
      : `error fetching logoURI: ${err.message}`
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch token data from a given URL and write it to an output file.
 *
 * @param {string} url - The URL to fetch token data from.
 * @param {string} name - The name used to create the output filename.
 * @param {function} conversionFunction - Optional conversion function to change list output format 
 */
async function fetchList(url, name, conversionFunction, conversionFunctionAdditionalParams, origin) {
  const headers = origin ? { Origin: origin } : undefined;
  const timeoutMs = 15_000;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await undiciFetch(url, { dispatcher: ipv4Agent, signal: ac.signal, headers });

      if (!res.ok) {
        clearTimeout(timer);
        throw new Error(`Error fetching data from ${url}: ${res.status} ${res.statusText}`);
      }

      const tokens = await res.json();
      clearTimeout(timer); // Clear timeout only after body is fully read
      const tokensToOutput = conversionFunction ? await conversionFunction(tokens, conversionFunctionAdditionalParams) : tokens;

      await fs.writeFile(`output/${name}.json`, JSON.stringify(tokensToOutput, null, 2));
      console.log(`✅ Tokens data saved to output/${name}.json`);
      return;
    } catch (error) {
      clearTimeout(timer);

      // If abort due to timeout, show helpful hint
      if (error.name === 'AbortError') {
        console.warn(`⚠️ Fetch attempt ${attempt} aborted after ${timeoutMs}ms (${url})`);
      } else {
        console.warn(`⚠️ Fetch attempt ${attempt} failed: ${error.message}`);
      }

      if (attempt < maxAttempts) {
        // tiny backoff before retry
        await new Promise((r) => setTimeout(r, 500 * attempt));
        console.info(`ℹ️ Retrying fetch (${attempt + 1}/${maxAttempts})...`);
        continue;
      }

      // final failure
      console.error(`❌ Error fetching ${name} list:`, error);
      return; // preserve previous behavior of logging and not throwing
    }
  }
}


async function convertOpenoceanList(list, chainId) {
  return {
    tokens: await Promise.all(list?.data?.map(async (item) => {
      const { address, name, symbol, decimals, icon } = item

      if (icon) {
        const logoCheck = await checkLogoUrl(icon)
        if (!logoCheck.ok) {
          console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – ${logoCheck.reason}`)
          return { chainId, address, name, symbol, decimals }
        }
      } else {
        console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – missing logoURI`)
        return { chainId, address, name, symbol, decimals }
      }

      return {
        chainId,
        address,
        name,
        symbol,
        decimals,
        logoURI: icon,
      }
    }),
    )
  }
}

async function convertCamelotList(list) {
  return {
    tokens: await Promise.all(list?.map(async (item) => {
      const { chainId, address, name, symbol, decimals, logoURI: logoURIRaw } = item

      const logoURI = logoURIRaw?.replace(
        'BASE_URL',
        'https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src'
      )
      
      if (logoURI) {
        const logoCheck = await checkLogoUrl(logoURI)
        if (!logoCheck.ok) {
          console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – ${logoCheck.reason}`)
          return { chainId, address, name, symbol, decimals }
        }
      } else {
        console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – missing logoURI`)
        return { chainId, address, name, symbol, decimals }
      }

      return {
        chainId,
        address,
        name,
        symbol,
        decimals,
        logoURI
      }
    }),
    )
  }
}

async function convertStandardList(list) {
  return {
    tokens: await Promise.all(list?.tokens?.map(async (item) => {
      const { chainId, address, name, symbol, decimals, logoURI } = item

      if (logoURI) {
        const logoCheck = await checkLogoUrl(logoURI)
        if (!logoCheck.ok) {
          console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – ${logoCheck.reason}`)
          return { chainId, address, name, symbol, decimals }
        }
      } else {
        console.warn(`⚠️  No logo ${symbol || address} on chain ${chainId} – missing logoURI`)
        return { chainId, address, name, symbol, decimals }
      }

      return {
        chainId,
        address,
        name,
        symbol,
        decimals,
        logoURI,
      }
    }),
    )
  }
}

/**
 * Main function to fetch token lists and write across mapping.
 */
; (async () => {
  // Active Lists
  await fetchList('https://stargate.finance/api/tokens', 'stargate')
  await fetchList(process.env.STARGATE_API, 'ofts')
  await fetchList('https://raw.githubusercontent.com/Maia-DAO/token-list-v2/main/default-tokenlist.json', 'ulysses')
  await fetchList('https://tokens.uniswap.org', 'uniswap', undefined, undefined, 'https://tokens.uniswap.org')

  // Inactive Lists
  await fetchList('https://extendedtokens.uniswap.org', 'uni_extended')
  await fetchList(
    'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
    'compound'
  )
  await fetchList('https://raw.githubusercontent.com/SetProtocol/uniswap-tokenlist/main/set.tokenlist.json', 'set')
  await fetchList(
    'https://raw.githubusercontent.com/The-Blockchain-Association/sec-notice-list/master/ba-sec-list.json',
    'ba'
  )

  // Fetch List for each chain that supports swapping via Hermes
  await fetchList(
    'https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/arbitrum-one.json',
    'TOKEN_LIST_ARBITRUM_ONE',
    convertCamelotList
  ),
    await fetchList('https://static.optimism.io/optimism.tokenlist.json', 'TOKEN_LIST_SUPERCHAIN', convertStandardList),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_BLAST'),
    await fetchList(
      'https://raw.githubusercontent.com/InkySwap/swap-token-list/refs/heads/main/inkyswap-mainnet.tokenlist.json',
      'TOKEN_LIST_INK',
      convertStandardList
    ),
    await fetchList(
      'https://raw.githubusercontent.com/Consensys/linea-token-list/refs/heads/main/json/linea-mainnet-token-shortlist.json',
      'TOKEN_LIST_LINEA',
      convertStandardList
    ),
    await fetchList(
      'https://raw.githubusercontent.com/balancer/tokenlists/refs/heads/main/generated/balancer.tokenlist.json',
      'TOKEN_LIST_BALANCER',
      convertStandardList
    ),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_MODE'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_POLYGON'),
    await fetchList(
      'https://raw.githubusercontent.com/scroll-tech/token-list/refs/heads/main/scroll.tokenlist.json',
      'TOKEN_LIST_SCROLL',
      convertStandardList
    ),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_SONEIUM'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_UNICHAIN'), 
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_WORLDCHAIN'),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_ZORA'),
    await fetchList(
      'https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src/tokens/mainnet.json',
      'TOKEN_LIST_BERA',
      convertStandardList
    ),
    // await fetchList('https://stargate.finance/api/tokens', 'TOKEN_LIST_SWELL'),
    await fetchList(
      'https://open-api.openocean.finance/v3/rootstock/tokenList',
      'TOKEN_LIST_ROOTSTOCK',
      convertOpenoceanList,
      30
    ),
    await fetchList(
      'https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/apechain.json',
      'TOKEN_LIST_APE',
      convertCamelotList
    ),
    await fetchList(
      'https://raw.githubusercontent.com/celo-org/celo-token-list/refs/heads/main/celo.tokenlist.json',
      'TOKEN_LIST_CELO',
      convertStandardList
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/celo/tokenList',
      'TOKEN_LIST_CELO_2',
      convertOpenoceanList,
      42220
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/sei/tokenList',
      'TOKEN_LIST_SEI',
      convertOpenoceanList,
      1329
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/hyperevm/tokenList',
      'TOKEN_LIST_HYPERLIQUID',
      convertOpenoceanList,
      999
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/monad/tokenList',
      'TOKEN_LIST_MONAD',
      convertOpenoceanList,
      143
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/plasma/tokenList',
      'TOKEN_LIST_PLASMA',
      convertOpenoceanList,
      9745
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/opbnb/tokenList',
      'TOKEN_LIST_OPBNB',
      convertOpenoceanList,
      204
    ),
    await fetchList(
      'https://raw.githubusercontent.com/Manta-Network/manta-pacific-token-list/refs/heads/main/json/manta-pacific-mainnet-token-list.json',
      'TOKEN_LIST_MANTA',
      convertStandardList
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/manta/tokenList',
      'TOKEN_LIST_MANTA_2',
      convertOpenoceanList,
      169
    ),
    await fetchList(
      'https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/gravity.json',
      'TOKEN_LIST_GRAVITY',
      convertCamelotList
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/flare/tokenList',
      'TOKEN_LIST_FLARE',
      convertOpenoceanList,
      14
    ),
    await fetchList(
      'https://raw.githubusercontent.com/mantlenetworkio/mantle-token-lists/refs/heads/main/mantle.tokenlist.json',
      'TOKEN_LIST_MANTLE',
      convertStandardList
    ),
    await fetchList(
      'https://raw.githubusercontent.com/CamelotLabs/default-token-list/refs/heads/main/src/tokens/plume.json',
      'TOKEN_LIST_PLUMEPHOENIX',
      convertCamelotList
    ),
    await fetchList(
      'https://open-api.openocean.finance/v3/metis/tokenList',
      'TOKEN_LIST_METIS',
      convertOpenoceanList,
      1088
    )

  // F-8 mass-demotion tripwire: stripped logoURIs cause step 8 to demote tokens to the
  // inactive list, so a network-wide HEAD-check failure must abort the pipeline.
  console.info(`ℹ️ logo HEAD checks: ${logoCheckStats.attempted} attempted, ${logoCheckStats.networkErrors} network errors`)
  if (logoCheckStats.attempted >= 100 && logoCheckStats.networkErrors / logoCheckStats.attempted > 0.5) {
    console.error('❌ >50% of logo HEAD checks failed with network errors — environment problem suspected; stripped logoURIs would mass-demote tokens in step 8. Aborting pipeline; fix connectivity and re-run yarn fetch.')
    process.exitCode = 1
  }
})()
