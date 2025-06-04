const fs = require("fs").promises;
const { SupportedChainId } = require("maia-core-sdk");
const {
  TOKEN_SYMBOLS_MAP,
  TOKEN_EQUIVALENCE_REMAPPING,
} = require("@across-protocol/constants");

function mergeRemappings() {
  const tokensMap = Object.entries(TOKEN_SYMBOLS_MAP).reduce(
    (memo, [symbol, tokens]) => {
      memo[symbol] = {
        ...tokens,
        addresses: {
          ...Object.entries(tokens.addresses).reduce(
            (memo, [chain, address]) => {
              if (
                Number(chain) === SupportedChainId.MAINNET &&
                tokens.l1TokenDecimals &&
                tokens.l1TokenDecimals !== tokens.decimals
              ) {
                memo[chain] = { address, decimals: tokens.l1TokenDecimals };
              } else {
                memo[chain] = { address };
              }
              return memo;
            },
            {}
          ),
        },
      };

      return memo;
    },
    {}
  );

  const remappings = Object.keys(TOKEN_EQUIVALENCE_REMAPPING);
  return remappings.reduce((memo, symbolToAdd) => {
    const tokensToAdd = memo[symbolToAdd];
    const mainSymbol = TOKEN_EQUIVALENCE_REMAPPING[symbolToAdd];
    if (tokensToAdd) {
      const tokensMain = memo[mainSymbol];
      const sameDecimals = tokensToAdd.decimals === tokensMain.decimals;

      const addressesToAdd = sameDecimals
        ? tokensToAdd.addresses
        : Object.entries(tokensToAdd.addresses).reduce(
            (memo, [chain, { address }]) => {
              memo[chain] = { address, decimals: tokensToAdd.decimals };
              return memo;
            },
            {}
          );

      memo[mainSymbol].addresses = {
        ...addressesToAdd,
        ...tokensMain.addresses,
      };
    }

    return memo;
  }, tokensMap);
}

const TOKENS_MAP = mergeRemappings();

const TESTNET_CHAIN_IDS = [
  SupportedChainId.SEPOLIA,
  SupportedChainId.ARBITRUM_SEPOLIA,
  SupportedChainId.OPTIMISM_SEPOLIA,
  SupportedChainId.BASE_SEPOLIA,
  SupportedChainId.POLYGON_AMOY,
];

// Convert SupportedChainId to an array of numbers.
const SUPPORTED_CHAINS = Object.values(SupportedChainId)
  .map(Number)
  .filter((value) => !TESTNET_CHAIN_IDS.includes(value));

const TOKEN_SYMBOLS_TO_IGNORE = {
  ["CAKE"]: true,
  ["ETH"]: true,
  ["BNB"]: true,
  ["WBNB"]: true,
};

function filterMap(allAddresses, notUSDT, modifyValueFn) {
  return Object.entries(allAddresses).reduce((memo, [chain, value]) => {
    const chainId = Number(chain);
    if (
      SUPPORTED_CHAINS.includes(chainId) &&
      (notUSDT || SupportedChainId.ARBITRUM_ONE !== chainId)
    ) {
      memo[chainId] = modifyValueFn ? modifyValueFn(value) : value;
    }
    return memo;
  }, {});
}

function equivalentAddresses(tokens, notUSDT) {
  const equivalent = TOKENS_MAP[TOKEN_EQUIVALENCE_REMAPPING[tokens.symbol]];

  if (!equivalent) return {};

  const differentDecimals = tokens.decimals !== equivalent.decimals;

  const createAddressEntryWithDecimals = differentDecimals
    ? ({ address }) => {
        return { address, decimals: equivalent.decimals };
      }
    : undefined;

  return filterMap(
    equivalent.addresses,
    notUSDT,
    createAddressEntryWithDecimals
  );
}

async function filterAcrossTokens() {
  try {
    // Create an output object with filtered addresses per token.
    const filteredAcross = {};

    // Iterate over each token in across.json.
    for (const symbol in TOKENS_MAP) {
      if (TOKEN_SYMBOLS_TO_IGNORE[symbol]) continue;

      const notUSDT = symbol !== "USDT";
      const token = TOKENS_MAP[symbol];

      // Filter the addresses: only keep keys that are in the supportedChains array.
      const filteredAddresses = filterMap(token.addresses, notUSDT);

      // Only include token if it has at least one supported address.
      if (Object.keys(filteredAddresses).length > 1) {
        const addresses = {
          ...equivalentAddresses(token, notUSDT),
          ...filteredAddresses,
        };

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
