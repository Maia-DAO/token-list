const fs = require("fs").promises;
const { SupportedChainId } = require("maia-core-sdk");
const {
  TOKEN_SYMBOLS_MAP,
  TOKEN_EQUIVALENCE_REMAPPING,
} = require("@across-protocol/constants");

const TESTNET_CHAIN_IDS = [
  SupportedChainId.SEPOLIA,
  SupportedChainId.ARBITRUM_SEPOLIA,
  SupportedChainId.OPTIMISM_SEPOLIA,
  SupportedChainId.BASE_SEPOLIA,
  SupportedChainId.POLYGON_AMOY,
];

const TOKEN_SYMBOLS_TO_IGNORE = {
  ["CAKE"]: true,
  ["BNB"]: true,
  ["WBNB"]: true,
};

function filterAddressMap(allAddresses, supportedChains) {
  return Object.entries(allAddresses).reduce((memo, [chain, address]) => {
    if (supportedChains.includes(Number(chain))) {
      memo[chain] = address;
    }
    return memo;
  }, {});
}

function equivalentTokens(tokens) {
  return TOKEN_SYMBOLS_MAP[TOKEN_EQUIVALENCE_REMAPPING[tokens.symbol]] ?? {};
}

async function filterAcrossTokens() {
  try {
    // Create an output object with filtered addresses per token.
    const filteredAcross = {};

    // Convert SupportedChainId to an array of numbers.
    const supportedChains = Object.values(SupportedChainId)
      .map(Number)
      .filter((value) => !TESTNET_CHAIN_IDS.includes(value));

    // Iterate over each token in across.json.
    for (const symbol in TOKEN_SYMBOLS_MAP) {
      if (TOKEN_SYMBOLS_TO_IGNORE[symbol]) continue;

      const token = TOKEN_SYMBOLS_MAP[symbol];

      // Filter the addresses: only keep keys that are in the supportedChains array.
      const filteredAddresses = {};
      for (const chain in token.addresses) {
        if (
          supportedChains.includes(Number(chain)) &&
          // ! REMOVE THIS TO ACCEPT USDT ON ARBITRUM AS AN ACROSS TOKEN
          (SupportedChainId.ARBITRUM_ONE !== Number(chain) || symbol !== "USDT")
        ) {
          filteredAddresses[chain] = token.addresses[chain];
        }
      }

      const supportedFilteredAddresses = filterAddressMap(
        filteredAddresses,
        supportedChains
      );

      // Only include token if it has at least one supported address.
      if (Object.keys(supportedFilteredAddresses).length > 1) {
        const allAddresses = {
          ...equivalentTokens(token).addresses,
          ...supportedFilteredAddresses,
        };

        const addresses = filterAddressMap(allAddresses, supportedChains);

        filteredAcross[symbol] = {
          ...token,
          addresses,
        };
      }
    }

    // Write the filtered tokens to filteredAcrossTokens.json.
    await fs.writeFile(
      "output/filteredAcrossTokens.json",
      JSON.stringify(filteredAcross, null, 2)
    );
    console.log(
      "✅ Filtered across tokens saved to output/filteredAcrossTokens.json"
    );
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

filterAcrossTokens();
